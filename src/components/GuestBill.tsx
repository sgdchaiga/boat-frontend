import { useEffect, useState, useRef } from "react";
import { Hotel, Printer } from "lucide-react";
import { APP_SHORT_NAME } from "../constants/branding";
import { supabase } from "../lib/supabase";

interface StayBill {
  id: string;
  hotel_customers: { first_name: string; last_name: string } | null;
  rooms: { room_number: string } | null;
  check_in_time?: string;
}

interface BillingCharge {
  id: string;
  description: string;
  amount: number;
  charge_type: string;
  charged_at: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  paid_at: string;
}

interface GuestBillProps {
  stay: StayBill;
  onClose?: () => void;
}

export function GuestBill({ stay, onClose }: GuestBillProps) {
  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const [chargesRes, paymentsRes] = await Promise.all([
          supabase
            .from("billing")
            .select("id, description, amount, charge_type, charged_at")
            .eq("stay_id", stay.id)
            .order("charged_at", { ascending: true }),
          supabase
            .from("payments")
            .select("id, amount, payment_method, payment_status, paid_at")
            .eq("stay_id", stay.id)
            .order("paid_at", { ascending: true }),
        ]);
        if (chargesRes.data) setCharges(chargesRes.data as BillingCharge[]);
        if (paymentsRes.data) setPayments(paymentsRes.data as PaymentRow[]);
      } catch (err) {
        console.error("Fetch bill error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [stay.id]);

  const totalCharges = charges.reduce((s, c) => s + Number(c.amount), 0);
  const totalPaid = payments
    .filter((p) => p.payment_status === "completed")
    .reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = totalCharges - totalPaid;

  const handlePrint = () => {
    window.print();
  };

  const guestName = stay.hotel_customers
    ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}`
    : "Guest";
  const roomNum = stay.rooms?.room_number ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Guest Bill</h3>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            disabled={loading}
            className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50 print:hidden"
          >
            <Printer className="w-4 h-4" />
            Print Bill
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 print:hidden"
            >
              Close
            </button>
          )}
        </div>
      </div>

      <div
        ref={printRef}
        className="bg-white rounded-xl border p-6 print:border-0 print:shadow-none print:p-0"
      >
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #guest-bill-print, #guest-bill-print * { visibility: visible; }
            #guest-bill-print { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 1rem; }
          }
        `}</style>

        {loading ? (
          <p className="text-slate-500 py-4">Loading bill…</p>
        ) : (
          <div id="guest-bill-print" className="print-bill">
            {/* Hotel header with logo */}
            <div className="flex items-center justify-center gap-3 mb-6 border-b pb-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-brand-700 text-white print:bg-slate-800">
                <Hotel className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{APP_SHORT_NAME}</h1>
                <p className="text-slate-600 text-sm">Guest Bill</p>
              </div>
            </div>
            <p className="text-slate-500 text-sm text-center mb-6">
              {new Date().toLocaleDateString()} – {new Date().toLocaleTimeString()}
            </p>

            <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Guest</p>
                <p className="font-semibold">{guestName}</p>
              </div>
              <div>
                <p className="text-slate-500">Room</p>
                <p className="font-semibold">{roomNum}</p>
              </div>
            </div>

            {/* Bill Details section */}
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Bill Details</h3>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Description</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-slate-500 text-center">
                      No charges
                    </td>
                  </tr>
                ) : (
                  charges.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2">{c.description}</td>
                      <td className="py-2 capitalize">{c.charge_type}</td>
                      <td className="py-2 text-right">{Number(c.amount).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Payments section */}
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Payments</h3>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Method</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.filter((p) => p.payment_status === "completed").length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-slate-500 text-center">
                      No payments
                    </td>
                  </tr>
                ) : (
                  payments
                    .filter((p) => p.payment_status === "completed")
                    .map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2">
                          {new Date(p.paid_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 capitalize">{p.payment_method.replace("_", " ")}</td>
                        <td className="py-2 text-right">${Number(p.amount).toFixed(2)}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>

            <div className="border-t pt-4 space-y-2 text-right">
              <p className="text-slate-700">
                Total Charges: <strong>{totalCharges.toFixed(2)}</strong>
              </p>
              <p className="text-slate-700">
                Total Paid: <strong>{totalPaid.toFixed(2)}</strong>
              </p>
              <p className="text-lg font-bold text-slate-900">
                Balance Due: {balanceDue.toFixed(2)}
              </p>
            </div>

            <p className="text-xs text-slate-500 text-center mt-8">
              Thank you for your stay.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
