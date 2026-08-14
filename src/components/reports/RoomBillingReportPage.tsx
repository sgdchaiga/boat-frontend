import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

type ReconciliationStay = {
  id: string;
  actual_check_in: string | null;
  actual_check_out: string | null;
  rooms: { room_number: string } | null;
  hotel_customers: { first_name: string; last_name: string } | null;
};
type FolioAmount = {
  stay_id: string | null;
  amount: number;
  charge_type?: string;
  stay_night_date?: string | null;
  charged_at?: string;
};

function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RoomBillingReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stays, setStays] = useState<ReconciliationStay[]>([]);
  const [billings, setBillings] = useState<FolioAmount[]>([]);
  const [payments, setPayments] = useState<FolioAmount[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!orgId && !superAdmin) throw new Error("Missing organization on your staff profile.");
      const staysQuery = filterByOrganizationId(
        supabase.from("stays").select("id,actual_check_in,actual_check_out,rooms(room_number),hotel_customers(first_name,last_name)").order("actual_check_in", { ascending: false }).limit(1000),
        orgId,
        superAdmin
      );
      const staysResult = await staysQuery;
      if (staysResult.error) throw staysResult.error;
      const stayRows = (staysResult.data || []) as unknown as ReconciliationStay[];
      const stayIds = stayRows.map((stay) => stay.id);
      if (stayIds.length === 0) {
        setStays([]);
        setBillings([]);
        setPayments([]);
        return;
      }
      // A stay is the authoritative tenant link for room folio activity. Querying
      // by its IDs also keeps this report aligned with the rows shown on Guest Billing.
      const stayIdBatches = Array.from({ length: Math.ceil(stayIds.length / 100) }, (_, index) => stayIds.slice(index * 100, index * 100 + 100));
      const [billingResults, paymentResults] = await Promise.all([
        Promise.all(stayIdBatches.map((ids) => supabase.from("billing").select("stay_id,amount,charge_type,stay_night_date,charged_at").in("stay_id", ids).limit(10000))),
        Promise.all(stayIdBatches.map((ids) => supabase.from("payments").select("stay_id,amount").eq("payment_status", "completed").in("stay_id", ids).limit(10000))),
      ]);
      const billingError = billingResults.find((result) => result.error)?.error;
      const paymentError = paymentResults.find((result) => result.error)?.error;
      if (billingError) throw billingError;
      if (paymentError) throw paymentError;
      setStays(stayRows);
      setBillings(billingResults.flatMap((result) => result.data || []) as unknown as FolioAmount[]);
      setPayments(paymentResults.flatMap((result) => result.data || []) as unknown as FolioAmount[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load room reconciliation.");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => { void load(); }, [load]);

  const reconciliations = useMemo(() => stays.map((stay) => {
    const stayBillings = billings.filter((row) => row.stay_id === stay.id);
    const roomCharges = stayBillings.filter((row) => row.charge_type === "room");
    const start = stay.actual_check_in ? new Date(stay.actual_check_in) : null;
    const end = stay.actual_check_out ? new Date(stay.actual_check_out) : new Date();
    const expectedNights = start ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)) : 0;
    const chargedNights = new Set(roomCharges.map((row) => row.stay_night_date || row.charged_at?.slice(0, 10))).size;
    const billed = stayBillings.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paid = payments.filter((row) => row.stay_id === stay.id).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { stay, expectedNights, chargedNights, nightDifference: chargedNights - expectedNights, billed, paid, balance: billed - paid };
  }).filter((row) => row.billed !== 0 || row.paid !== 0 || row.nightDifference !== 0), [stays, billings, payments]);

  const exceptions = reconciliations.filter((row) => row.nightDifference !== 0 || Math.abs(row.balance) > 0.01).length;
  const totalBilled = reconciliations.reduce((sum, row) => sum + row.billed, 0);
  const totalPaid = reconciliations.reduce((sum, row) => sum + row.paid, 0);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold text-slate-900">Room billing &amp; cash-in reconciliation</h1>
        <PageNotes ariaLabel="Room reconciliation help">
          <p>Compare expected room nights with posted nights, and each guest folio with completed payments.</p>
          <p className="mt-2">Open Guest Billing to review or edit individual charge entries.</p>
        </PageNotes>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? <p className="py-4 text-slate-500">Loading reconciliation...</p> : <>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="app-card p-4"><p className="text-xs text-slate-500">Total billed</p><p className="text-2xl font-bold">{formatMoney(totalBilled)}</p></div>
          <div className="app-card p-4"><p className="text-xs text-slate-500">Total paid</p><p className="text-2xl font-bold">{formatMoney(totalPaid)}</p></div>
          <div className="app-card p-4"><p className="text-xs text-slate-500">Stays requiring review</p><p className={`text-2xl font-bold ${exceptions ? "text-amber-700" : "text-emerald-700"}`}>{exceptions}</p></div>
        </div>
        <div className="app-card overflow-x-auto">
          <div className="border-b border-slate-100 p-4"><h2 className="font-semibold">Combined reconciliation</h2><p className="text-xs text-slate-500">One row per stay. Individual room charge entries remain on Guest Billing.</p></div>
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-slate-50"><tr><th className="p-3 text-left">Guest / room</th><th className="p-3 text-right">Expected nights</th><th className="p-3 text-right">Charged nights</th><th className="p-3 text-right">Billed</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3 text-left">Result</th></tr></thead>
            <tbody>{reconciliations.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-emerald-700">All room stays are reconciled.</td></tr> : reconciliations.map(({stay,expectedNights,chargedNights,nightDifference,billed,paid,balance}) => {
              const needsReview = nightDifference !== 0 || Math.abs(balance) > 0.01;
              const guest = stay.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}`.trim() : "Guest";
              return <tr key={stay.id} className="border-t border-slate-100"><td className="p-3 font-medium">{guest} · Room {stay.rooms?.room_number || "—"}{stay.actual_check_out ? " · checked out" : ""}</td><td className="p-3 text-right">{expectedNights}</td><td className={`p-3 text-right ${nightDifference ? "font-semibold text-amber-700" : ""}`}>{chargedNights}{nightDifference ? ` (${nightDifference > 0 ? "+" : ""}${nightDifference})` : ""}</td><td className="p-3 text-right tabular-nums">{formatMoney(billed)}</td><td className="p-3 text-right tabular-nums">{formatMoney(paid)}</td><td className={`p-3 text-right font-semibold tabular-nums ${balance > 0.01 ? "text-amber-700" : balance < -0.01 ? "text-blue-700" : "text-emerald-700"}`}>{formatMoney(balance)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${needsReview ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{needsReview ? "Review" : "Reconciled"}</span></td></tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
