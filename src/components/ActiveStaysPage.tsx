import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, LogOut, Printer, Edit } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { GuestBill } from './GuestBill';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/database.types';
import { PageNotes } from './common/PageNotes';
import { filterByOrganizationId } from '../lib/supabaseOrgFilter';
import { fetchAllPages } from '../lib/supabasePagination';

type Stay = Database['public']['Tables']['stays']['Row'] & {
  /** Returned from `select('*')` on stays; used for printed guest bill header. */
  organization_id?: string | null;
  property_customer_id?: string | null;
  hotel_customers: { first_name: string; last_name: string; email: string | null } | null;
  rooms: { id: string; room_number: string } | null;
};

type ActiveStaysPageProps = {
  /** Scroll / ring the stay card for this guest (property customer id) after Money In */
  highlightGuestId?: string;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
};

export function ActiveStaysPage({ highlightGuestId, onNavigate }: ActiveStaysPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [stays, setStays] = useState<Stay[]>([]);
  const [checkedOutStays, setCheckedOutStays] = useState<Stay[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [billStay, setBillStay] = useState<Stay | null>(null);
  const [editStay, setEditStay] = useState<Stay | null>(null);
  const [editCustomerId, setEditCustomerId] = useState("");
  const [discountStay, setDiscountStay] = useState<Stay | null>(null);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [checkoutStay, setCheckoutStay] = useState<Stay | null>(null);
  const [checkoutDate, setCheckoutDate] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "checked_out">("all");
  const [filterRoom, setFilterRoom] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const matchesFilters = (stay: Stay) => {
    const q = filterSearch.trim().toLowerCase();
    const label = `${stay.hotel_customers?.first_name || ""} ${stay.hotel_customers?.last_name || ""} ${stay.hotel_customers?.email || ""} ${stay.rooms?.room_number || ""}`.toLowerCase();
    if (q && !label.includes(q)) return false;
    if (filterRoom !== "all" && stay.room_id !== filterRoom) return false;
    const arrival = stay.actual_check_in?.slice(0, 10) || "";
    const departure = stay.actual_check_out?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (filterFrom && departure < filterFrom) return false;
    if (filterTo && arrival > filterTo) return false;
    return true;
  };
  const filteredActiveStays = useMemo(() => filterStatus === "checked_out" ? [] : stays.filter(matchesFilters), [stays, filterSearch, filterStatus, filterRoom, filterFrom, filterTo]);
  const filteredCheckedOutStays = useMemo(() => filterStatus === "active" ? [] : checkedOutStays.filter(matchesFilters), [checkedOutStays, filterSearch, filterStatus, filterRoom, filterFrom, filterTo]);
  const stayRooms = useMemo(() => {
    const map = new Map<string, string>();
    [...stays, ...checkedOutStays].forEach((stay) => { if (stay.room_id && stay.rooms?.room_number) map.set(stay.room_id, stay.rooms.room_number); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [stays, checkedOutStays]);

  useEffect(() => {
    fetchActiveStays();
  }, [orgId, superAdmin]);

  useEffect(() => {
    if (!highlightGuestId || loading) return;
    const el = document.getElementById(`stay-guest-${highlightGuestId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-brand-500", "rounded-xl");
    const t = window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-brand-500", "rounded-xl");
    }, 4500);
    return () => window.clearTimeout(t);
  }, [highlightGuestId, loading, stays]);

  const fetchActiveStays = async () => {
  try {
    if (!orgId && !superAdmin) {
      setStays([]);
      return;
    }
    const [activeRows, checkedOutRows, customerRows] = await Promise.all([
      fetchAllPages((from,to) => filterByOrganizationId(
        supabase
          .from("stays")
          .select("*, hotel_customers(first_name,last_name,email), rooms(id,room_number)")
          .is("actual_check_out", null)
          .order("actual_check_in", { ascending: false }).order("id", { ascending: false }).range(from,to),
        orgId,
        superAdmin
      )),
      fetchAllPages((from,to) => filterByOrganizationId(
        supabase
          .from("stays")
          .select("*, hotel_customers(first_name,last_name,email), rooms(id,room_number)")
          .not("actual_check_out", "is", null)
          .order("actual_check_out", { ascending: false }).order("id", { ascending: false }).range(from,to),
        orgId,
        superAdmin
      )),
      fetchAllPages((from,to) => filterByOrganizationId(
        supabase.from("hotel_customers").select("id, first_name, last_name").order("first_name", { ascending: true }).order("id").range(from,to),
        orgId,
        superAdmin
      )),
    ]);
    setStays(activeRows as Stay[]);
    setCheckedOutStays(checkedOutRows as Stay[]);
    setCustomers(customerRows as Array<{ id: string; first_name: string; last_name: string }>);
  } catch (error) {
    console.error("Error fetching stays:", error);
  } finally {
    setLoading(false);
  }
};
  const openEditCustomer = (stay: Stay) => {
    setEditStay(stay);
    setEditCustomerId(stay.property_customer_id ?? "");
  };

  const openDiscountEdit = (stay: Stay) => {
    setDiscountStay(stay);
    setDiscountAmount(stay.room_discount_amount ? String(stay.room_discount_amount) : "");
    setDiscountReason(stay.room_discount_reason ?? "");
  };

  const saveRoomDiscount = async () => {
    if (!discountStay || savingEdit) return;
    setSavingEdit(true);
    try {
      const nextAmount = Math.max(0, Number(discountAmount || 0) || 0);
      const patch = {
        room_discount_amount: nextAmount,
        room_discount_reason: discountReason.trim() || null,
      };
      const { error } = await filterByOrganizationId(
        supabase.from("stays").update(patch).eq("id", discountStay.id),
        orgId,
        superAdmin
      );
      if (error) throw error;
      if (discountStay.reservation_id) {
        await filterByOrganizationId(
          supabase.from("reservations").update(patch).eq("id", discountStay.reservation_id),
          orgId,
          superAdmin
        );
      }
      setDiscountStay(null);
      setDiscountAmount("");
      setDiscountReason("");
      await fetchActiveStays();
    } catch (error: unknown) {
      const msg = error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : "Failed to update room discount";
      alert(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const saveCustomerCorrection = async () => {
    if (!editStay || !editCustomerId || savingEdit) return;
    setSavingEdit(true);
    try {
      const { error } = await filterByOrganizationId(
        supabase
          .from("stays")
          .update({ property_customer_id: editCustomerId })
          .eq("id", editStay.id),
        orgId,
        superAdmin
      );
      if (error) throw error;
      if (editStay.reservation_id) {
        await filterByOrganizationId(
          supabase
            .from("reservations")
            .update({ property_customer_id: editCustomerId })
            .eq("id", editStay.reservation_id),
          orgId,
          superAdmin
        );
      }
      setEditStay(null);
      setEditCustomerId("");
      await fetchActiveStays();
    } catch (error: unknown) {
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Failed to update customer';
      alert(msg);
    } finally {
      setSavingEdit(false);
    }
  };
  const openCheckout = (stay: Stay) => {
    setCheckoutStay(stay);
    setCheckoutDate(new Date().toISOString().slice(0, 10));
  };

  const handleCheckOut = async (stay: Stay, date = checkoutDate) => {
    if (!stay.rooms || !user) return;
    if (!date) return alert("Select the actual checkout date.");
    const checkInDate = new Date(stay.actual_check_in).toISOString().slice(0, 10);
    if (date < checkInDate) return alert("Checkout date cannot be before check-in date.");

    setProcessingId(stay.id);
    try {
      const { error } = await supabase.rpc("hotel_check_out_stay", {
        p_stay_id: stay.id,
        p_checkout_date: date,
      });
      if (error) throw error;

      setCheckoutStay(null);
      await fetchActiveStays();
    } catch (error: unknown) {
      const msg = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Failed to check out guest';
      console.error('Error checking out:', error);
      alert(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const calculateNights = (checkInDate: string): number => {
    const checkIn = new Date(checkInDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - checkIn.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-48 mb-8"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Active Stays</h1>
          <PageNotes ariaLabel="Active stays help">
            <p>Monitor current guests and check-outs.</p>
          </PageNotes>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="min-w-52 flex-1 text-xs font-medium text-slate-600">Guest, email or room<input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search guest, email or room" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">Stay status<select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="all">Active and checked out</option><option value="active">Active only</option><option value="checked_out">Checked out only</option></select></label>
        <label className="text-xs font-medium text-slate-600">Room<select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="all">All rooms</option>{stayRooms.map(([id, number]) => <option key={id} value={id}>{number}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Stay from<input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">Stay to<input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <button type="button" onClick={() => { setFilterSearch(""); setFilterStatus("all"); setFilterRoom("all"); setFilterFrom(""); setFilterTo(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Clear</button>
        <p className="w-full text-xs text-slate-500">Showing {filteredActiveStays.length} active and {filteredCheckedOutStays.length} checked-out stays</p>
      </div>

      <div className="space-y-4">
        {filteredActiveStays.map((stay) => (
          <div
            key={stay.id}
            id={stay.property_customer_id ? `stay-guest-${stay.property_customer_id}` : undefined}
            className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-green-100 p-2 rounded-lg">
                    <DoorOpen className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      {stay.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}` : 'Unknown customer'}
                    </h3>
                    <p className="text-sm text-slate-500">{stay.hotel_customers?.email || 'No email'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Room</p>
                    <p className="font-medium text-slate-900">{stay.rooms?.room_number || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Checked In</p>
                    <p className="font-medium text-slate-900">
                      {new Date(stay.actual_check_in).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Nights</p>
                    <p className="font-medium text-slate-900">{calculateNights(stay.actual_check_in)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Status</p>
                    <p className="font-medium text-green-600">Active</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Room discount/night</p>
                    <p className="font-medium text-slate-900">
                      {Number(stay.room_discount_amount || 0) > 0
                        ? Number(stay.room_discount_amount || 0).toFixed(2)
                        : "None"}
                    </p>
                  </div>
                </div>
                {Number(stay.room_discount_amount || 0) > 0 && stay.room_discount_reason ? (
                  <p className="mt-3 text-sm text-emerald-700">{stay.room_discount_reason}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openDiscountEdit(stay)}
                  className="flex items-center gap-2 px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition whitespace-nowrap"
                >
                  <Edit className="w-5 h-5" />
                  Discount
                </button>
                <button
                  onClick={() => setBillStay(stay)}
                  className="flex items-center gap-2 px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition whitespace-nowrap"
                >
                  <Printer className="w-5 h-5" />
                  Print Bill
                </button>
                <button
                  onClick={() => openCheckout(stay)}
                  disabled={processingId === stay.id}
                  className="app-btn-primary px-6 py-3 whitespace-nowrap disabled:cursor-not-allowed"
                >
                  <LogOut className="w-5 h-5" />
                  {processingId === stay.id ? 'Processing...' : 'Check Out'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {billStay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <GuestBill stay={billStay} onClose={() => setBillStay(null)} onNavigate={onNavigate} />
          </div>
        </div>
      )}

      {filteredActiveStays.length === 0 && filterStatus !== "checked_out" && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <DoorOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-lg">No active stays</p>
          <p className="text-slate-400 text-sm mt-2">All rooms are currently vacant</p>
        </div>
      )}

      {filterStatus !== "active" && <div className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-3">Recently Checked Out</h2>
        {filteredCheckedOutStays.length === 0 ? (
          <p className="text-slate-500 text-sm">No checked-out entries yet.</p>
        ) : (
          <div className="space-y-3">
            {filteredCheckedOutStays.map((stay) => (
              <div key={stay.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {stay.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}` : "Unknown customer"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Room {stay.rooms?.room_number || "N/A"} · Checked out {stay.actual_check_out ? new Date(stay.actual_check_out).toLocaleString() : "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditCustomer(stay)}
                  className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  Edit customer
                </button>
                <button type="button" onClick={() => { setCheckoutStay(stay); setCheckoutDate(stay.actual_check_out?.slice(0,10) || ""); }} className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">Correct checkout date</button>
                {onNavigate ? <button type="button" onClick={() => onNavigate("billing", { focusStayId: stay.id })} className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">Edit bill</button> : null}
              </div>
            ))}
          </div>
        )}
      </div>}

      {checkoutStay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">{checkoutStay.actual_check_out ? "Correct checkout date" : "Check out guest"}</h3>
            <p className="mt-1 text-sm text-slate-600">Room {checkoutStay.rooms?.room_number || "N/A"}. Enter the date the guest actually left.</p>
            <input type="date" value={checkoutDate} min={new Date(checkoutStay.actual_check_in).toISOString().slice(0,10)} max={new Date().toISOString().slice(0,10)} onChange={(e) => setCheckoutDate(e.target.value)} className="mt-4 w-full rounded-lg border px-3 py-2" />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setCheckoutStay(null)} className="rounded-lg border px-4 py-2">Cancel</button><button onClick={() => void handleCheckOut(checkoutStay)} disabled={processingId===checkoutStay.id} className="app-btn-primary rounded-lg">Save checkout</button></div>
          </div>
        </div>
      )}

      {editStay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3">Correct checked-out customer</h3>
            <p className="text-sm text-slate-600 mb-3">Select the correct customer for this stay entry.</p>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={editCustomerId}
              onChange={(e) => setEditCustomerId(e.target.value)}
              disabled={savingEdit}
            >
              <option value="">Select customer...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !savingEdit && setEditStay(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg"
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCustomerCorrection()}
                disabled={savingEdit || !editCustomerId}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50"
              >
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {discountStay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3">Room discount</h3>
            <p className="text-sm text-slate-600 mb-3">Set a per-night discount for future automatic room charges on this stay.</p>
            <div className="space-y-3">
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="Discount per night"
                disabled={savingEdit}
              />
              <input
                type="text"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="Reason"
                disabled={savingEdit}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !savingEdit && setDiscountStay(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg"
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRoomDiscount()}
                disabled={savingEdit}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50"
              >
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
