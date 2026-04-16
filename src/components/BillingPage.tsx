import { useEffect, useMemo, useState } from "react";
import { Receipt, Plus, X, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { createJournalForRoomCharge } from "../lib/journal";
import {
  type ActiveStayOption,
  type BillingWithCustomer,
  type BillingRangePreset,
  billingRangeToDates,
  guestDisplayName,
} from "../lib/billingShared";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";

interface BillingPageProps {
  onNavigate?: (page: string) => void;
  readOnly?: boolean;
}

type BillingSortKey = "id" | "customer" | "charge_type" | "description" | "amount" | "charged_at";

export function BillingPage({ onNavigate, readOnly = false }: BillingPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [billings, setBillings] = useState<BillingWithCustomer[]>([]);
  const [activeStays, setActiveStays] = useState<ActiveStayOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddCharge, setShowAddCharge] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [description, setDescription] = useState("");
  const [chargeType, setChargeType] = useState("room");
  const [amount, setAmount] = useState("");
  const [chargeStayId, setChargeStayId] = useState<string>("");

  const [billingSort, setBillingSort] = useState<{ key: BillingSortKey; dir: "asc" | "desc" } | null>(null);
  const [billingRange, setBillingRange] = useState<BillingRangePreset>("all");
  const { from: billingDateFrom, to: billingDateTo } = useMemo(
    () => billingRangeToDates(billingRange),
    [billingRange]
  );

  const filteredBillings = useMemo(() => {
    if (!billingDateFrom && !billingDateTo) return billings;
    return billings.filter((b) => {
      const t = new Date(b.charged_at).getTime();
      if (billingDateFrom) {
        const start = new Date(`${billingDateFrom}T00:00:00`).getTime();
        if (t < start) return false;
      }
      if (billingDateTo) {
        const end = new Date(`${billingDateTo}T23:59:59.999`).getTime();
        if (t > end) return false;
      }
      return true;
    });
  }, [billings, billingDateFrom, billingDateTo]);

  const sortedBillings = useMemo(() => {
    if (!billingSort) return filteredBillings;
    const { key, dir } = billingSort;
    const m = dir === "asc" ? 1 : -1;
    return [...filteredBillings].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "id":
          cmp = a.id.localeCompare(b.id);
          break;
        case "customer": {
          const na = guestDisplayName(a.stays?.hotel_customers ?? null) || (a.stay_id ? "\uffff" : "");
          const nb = guestDisplayName(b.stays?.hotel_customers ?? null) || (b.stay_id ? "\uffff" : "");
          cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
          break;
        }
        case "charge_type":
          cmp = (a.charge_type || "").localeCompare(b.charge_type || "");
          break;
        case "description":
          cmp = (a.description || "").localeCompare(b.description || "", undefined, { sensitivity: "base" });
          break;
        case "amount":
          cmp = Number(a.amount) - Number(b.amount);
          break;
        case "charged_at":
          cmp = new Date(a.charged_at).getTime() - new Date(b.charged_at).getTime();
          break;
        default:
          cmp = 0;
      }
      return cmp * m;
    });
  }, [filteredBillings, billingSort]);

  const toggleBillingSort = (key: BillingSortKey) => {
    setBillingSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDesc = key === "amount" || key === "charged_at";
      return { key, dir: defaultDesc ? "desc" : "asc" };
    });
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: "asc" | "desc" }) => {
    if (!active) return <ArrowUpDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />;
    return dir === "asc" ? (
      <ArrowUp className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    ) : (
      <ArrowDown className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    );
  };

  const billTh = (key: BillingSortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`${align === "right" ? "text-right" : "text-left"} p-0`}>
      <button
        type="button"
        onClick={() => toggleBillingSort(key)}
        className={`w-full flex items-center gap-1.5 p-3 font-semibold text-slate-700 hover:bg-slate-100 transition ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
      >
        {label}
        <SortIcon active={billingSort?.key === key} dir={billingSort?.dir ?? "asc"} />
      </button>
    </th>
  );

  useEffect(() => {
    void fetchData();
  }, [orgId, superAdmin]);

  const fetchData = async () => {
    try {
      setLoadError(null);
      const billingsQuery = filterByOrganizationId(
        supabase
          .from("billing")
          .select("*, stays(rooms(room_number), hotel_customers(first_name, last_name))")
          .order("charged_at", { ascending: false }),
        orgId,
        superAdmin
      );
      const staysQuery = filterByOrganizationId(
        supabase
          .from("stays")
          .select("id, room_id, actual_check_in, rooms(room_number), hotel_customers(first_name, last_name)")
          .is("actual_check_out", null),
        orgId,
        superAdmin
      );
      const [billingsResult, staysResult] = await Promise.all([billingsQuery, staysQuery]);

      if (billingsResult.error) throw billingsResult.error;

      setBillings((billingsResult.data || []) as BillingWithCustomer[]);
      setActiveStays((staysResult.data || []) as unknown as ActiveStayOption[]);
    } catch (error) {
      console.error("Error fetching billing:", error);
      setLoadError(error instanceof Error ? error.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleAddCharge = async () => {
    if (savingCharge) return;
    if (readOnly) return;
    if (!description || !amount) {
      alert("Please fill description and amount.");
      return;
    }
    if (!chargeStayId) {
      alert("Please select a customer (stay) for this charge.");
      return;
    }

    setSavingCharge(true);
    try {
      const payload = {
        organization_id: orgId ?? null,
        description,
        charge_type: chargeType,
        amount: Number(amount),
        stay_id: chargeStayId,
      };

      const { data: inserted, error } = await supabase.from("billing").insert(payload).select("id, charged_at").single();
      if (error) throw error;
      if (inserted) {
        const chargedAt = (inserted as { charged_at?: string }).charged_at ?? new Date().toISOString();
        const jr = await createJournalForRoomCharge(
          (inserted as { id: string }).id,
          Number(amount),
          description,
          chargedAt,
          user?.id ?? null
        );
        if (!jr.ok) {
          alert(`Charge saved but journal was not posted: ${jr.error}`);
        }
      }

      setDescription("");
      setChargeType("room");
      setAmount("");
      setChargeStayId("");
      setShowAddCharge(false);
      fetchData();
    } catch (error) {
      console.error("Error adding charge:", error);
      alert("Failed to add charge: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSavingCharge(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  const billingDateFilterActive = billingRange !== "all";
  const totalBilling = filteredBillings.reduce((sum, b) => sum + Number(b.amount), 0);
  const totalBillingAllTime = billings.reduce((sum, b) => sum + Number(b.amount), 0);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">Billing</h1>
            <PageNotes ariaLabel="Billing help">
              <p>Guest folio charges for active stays (hotel).</p>
            </PageNotes>
          </div>
        </div>

        <button
          onClick={() => !readOnly && setShowAddCharge(true)}
          disabled={readOnly}
          className="bg-brand-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" />
          Add Charge
        </button>
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{loadError}</div>
      )}

      <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-sm flex items-center justify-between gap-4">
        <span>Hotel POS bill-to-room charges appear here. Counter sales are in Transactions.</span>
        {onNavigate && (
          <button
            onClick={() => onNavigate("transactions")}
            className="text-slate-800 font-medium underline hover:no-underline shrink-0"
          >
            View Transactions →
          </button>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl border mb-4 max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <Receipt className="w-5 h-5 text-blue-600" />
          <p>Total Charges</p>
        </div>
        <p className="text-2xl font-bold">{totalBilling.toFixed(2)}</p>
        {billingDateFilterActive && (
          <p className="text-xs text-slate-500 mt-1">In range · All time: {totalBillingAllTime.toFixed(2)}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 mb-4 pb-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="whitespace-nowrap">Date range</span>
          <select
            value={billingRange}
            onChange={(e) => setBillingRange(e.target.value as BillingRangePreset)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white max-w-[11rem]"
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
          </select>
        </label>
      </div>

      {sortedBillings.length === 0 ? (
        <p className="text-slate-500 py-8 text-center border rounded-lg bg-slate-50">
          {billings.length === 0
            ? "No charges yet."
            : "No charges in this range. Change the date range or choose All dates."}
        </p>
      ) : (
        <table className="w-full border">
          <thead className="bg-slate-50">
            <tr>
              {billTh("id", "Order #")}
              {billTh("customer", "Customer")}
              {billTh("charge_type", "Department")}
              {billTh("description", "Description")}
              {billTh("amount", "Amount", "right")}
              {billTh("charged_at", "Date")}
            </tr>
          </thead>
          <tbody>
            {sortedBillings.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-3 font-mono text-sm">{b.id.slice(0, 8)}</td>
                <td className="p-3">
                  {b.stays?.hotel_customers
                    ? `${b.stays.hotel_customers.first_name} ${b.stays.hotel_customers.last_name}`
                    : b.stay_id
                      ? "—"
                      : "Walk-in / No stay"}
                </td>
                <td className="p-3 capitalize">{b.charge_type}</td>
                <td className="p-3">{b.description}</td>
                <td className="p-3 text-right">{Number(b.amount).toFixed(2)}</td>
                <td className="p-3">{new Date(b.charged_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAddCharge && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-10">
          <div className="bg-white rounded-xl p-6 w-96">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Charge</h2>
              <X className={`cursor-pointer ${savingCharge ? "opacity-40 pointer-events-none" : ""}`} onClick={() => !savingCharge && setShowAddCharge(false)} />
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Description"
                className="w-full border p-2 rounded"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              <select
                className="w-full border p-2 rounded"
                value={chargeType}
                onChange={(e) => setChargeType(e.target.value)}
              >
                <option value="room">Room</option>
                <option value="food">Food</option>
                <option value="service">Service</option>
                <option value="other">Other</option>
              </select>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Customer (required)</label>
                <select
                  className="w-full border p-2 rounded"
                  value={chargeStayId}
                  onChange={(e) => setChargeStayId(e.target.value)}
                  required
                >
                  <option value="">Select customer / room</option>
                  {activeStays.map((s) => (
                    <option key={s.id} value={s.id}>
                      Room {s.rooms?.room_number} – {s.hotel_customers?.first_name} {s.hotel_customers?.last_name}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="number"
                placeholder="Amount"
                className="w-full border p-2 rounded"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />

              <button
                onClick={handleAddCharge}
                disabled={readOnly || savingCharge}
                className="bg-brand-700 text-white w-full py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingCharge ? "Saving..." : "Save Charge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
