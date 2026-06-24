import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { calculateLoanFees, calculateMonthlyPayment, useAppContext } from "@/contexts/AppContext";
import { memberMeetsLoanDisbursePolicy } from "@/lib/saccoLoanEligibility";
import { toast } from "@/components/ui/use-toast";

type Props = { memberId: string; onBack: () => void };

export function SaccoMemberLoanApplication({ memberId, onBack }: Props) {
  const { members, loanProducts, addLoan, formatCurrency, saccoLoanPolicies } = useAppContext();
  const member = members.find((row) => row.id === memberId);
  const products = loanProducts.filter((row) => row.isActive);
  const [productName, setProductName] = useState(products[0]?.name || "");
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("6");
  const [purpose, setPurpose] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const product = products.find((row) => row.name === productName) || products[0];
  const amountNumber = Number(amount || 0);
  const termNumber = Number(term || 0);

  useEffect(() => {
    if (!productName && products[0]) setProductName(products[0].name);
  }, [productName, products]);

  const eligibility = useMemo(() => {
    if (!member || !product) return { ok: false, message: "Loan products are not available." };
    if (amountNumber < product.minAmount || amountNumber > product.maxAmount) return { ok: false, message: `Amount must be between ${formatCurrency(product.minAmount)} and ${formatCurrency(product.maxAmount)}.` };
    if (termNumber < 1 || termNumber > product.maxTerm) return { ok: false, message: `Choose 1 to ${product.maxTerm} months.` };
    const savingsNeeded = amountNumber * product.compulsorySavingsRate / 100;
    if (member.savingsBalance < savingsNeeded) return { ok: false, message: `This product requires savings of at least ${formatCurrency(savingsNeeded)}.` };
    if (member.sharesBalance < product.minimumShares) return { ok: false, message: `This product requires shares of at least ${formatCurrency(product.minimumShares)}.` };
    const tenure = memberMeetsLoanDisbursePolicy(member, saccoLoanPolicies);
    if (!tenure.ok) return { ok: false, message: tenure.reason };
    if (!purpose.trim()) return { ok: false, message: "Briefly tell us what the loan is for." };
    return { ok: true, message: "Eligible to submit for review." };
  }, [amountNumber, formatCurrency, member, product, purpose, saccoLoanPolicies, termNumber]);

  const rate = Number(product?.interestRate || 0);
  const monthly = product ? calculateMonthlyPayment(amountNumber, rate, termNumber || 1, product.interestBasis) : 0;

  const submit = async () => {
    if (!member || !product || !eligibility.ok) return;
    setSaving(true);
    try {
      await addLoan({
        memberId: member.id,
        memberName: member.name,
        loanType: product.name,
        amount: amountNumber,
        interestRate: rate,
        term: termNumber,
        applicationDate: new Date().toISOString().slice(0, 10),
        guarantors: [],
        purpose: purpose.trim(),
        interestBasis: product.interestBasis,
        fees: calculateLoanFees(amountNumber, product, { termMonths: termNumber }),
      });
      toast({ title: "Application submitted", description: "Your SACCO will review it and contact you if more information is needed." });
      onBack();
    } catch (error) {
      toast({ title: "Could not submit", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!member) return <div className="p-8 text-center text-sm text-slate-600">Loading your member account…</div>;

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-slate-50 p-4 sm:py-8">
      <button type="button" onClick={reviewing ? () => setReviewing(false) : onBack} className="mb-4 flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700"><ArrowLeft size={18} /> Back</button>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><CreditCard /></div>
        <h1 className="mt-4 text-2xl font-black text-slate-950">Apply for a loan</h1>
        <p className="mt-1 text-sm text-slate-500">A short request. Your SACCO handles the paperwork and approval.</p>

        {!reviewing ? <div className="mt-6 space-y-5">
          <label className="block text-sm font-bold text-slate-700">Loan type<select value={productName} onChange={(e) => setProductName(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal">{products.map((row) => <option key={row.id}>{row.name}</option>)}</select></label>
          <label className="block text-sm font-bold text-slate-700">How much do you need?<input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg font-bold" placeholder="UGX 0" /></label>
          <label className="block text-sm font-bold text-slate-700">Repayment period<select value={term} onChange={(e) => setTerm(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal">{[3,6,9,12,18,24,36].filter((n) => n <= Number(product?.maxTerm || 0)).map((n) => <option key={n} value={n}>{n} months</option>)}</select></label>
          <label className="block text-sm font-bold text-slate-700">What is the loan for?<textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal" placeholder="For example: school fees" /></label>
          <p className={`rounded-xl p-3 text-sm ${eligibility.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{eligibility.message}</p>
          <button type="button" disabled={!eligibility.ok} onClick={() => setReviewing(true)} className="min-h-12 w-full rounded-xl bg-violet-600 font-bold text-white disabled:opacity-40">Review application</button>
        </div> : <div className="mt-6 space-y-4">
          <div className="rounded-2xl bg-violet-50 p-4"><p className="text-xs font-bold uppercase text-violet-700">Requested amount</p><p className="mt-1 text-2xl font-black text-violet-950">{formatCurrency(amountNumber)}</p></div>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4 text-sm"><p className="flex justify-between py-3"><span>Product</span><strong>{product?.name}</strong></p><p className="flex justify-between py-3"><span>Period</span><strong>{termNumber} months</strong></p><p className="flex justify-between py-3"><span>Estimated monthly payment</span><strong>{formatCurrency(monthly)}</strong></p><p className="py-3"><span className="text-slate-500">Purpose</span><strong className="mt-1 block">{purpose}</strong></p></div>
          <p className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} className="shrink-0" />Submitting does not guarantee approval or move money.</p>
          <button type="button" onClick={() => void submit()} disabled={saving} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" /> : "Submit application"}</button>
        </div>}
      </section>
    </main>
  );
}
