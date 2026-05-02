import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext, calculateLoanFees, calculateMonthlyPayment } from '@/contexts/AppContext';
import type { LoanProduct, Member } from '@/types/saccoWorkspace';
import { toast } from '@/components/ui/use-toast';
import { tierBandsDescription, tierDefaultDecliningRatePa, tierLabel, sharesToTier } from '@/lib/saccoMemberTier';
import { calendarDaysElapsedSince, memberMeetsLoanDisbursePolicy } from '@/lib/saccoLoanEligibility';
import {
  FileText,
  Calculator,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Info,
  Landmark,
  ListChecks,
  MinusCircle,
  PiggyBank,
} from 'lucide-react';
import { PageNotes } from '@/components/common/PageNotes';

/** Native <select> options inherit OS theme; force light scheme + explicit colors so lists stay readable. */
const SELECT_FIELD =
  'w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900 [color-scheme:light]';

function suggestedAnnualRatePct(m: Member | undefined, lt: LoanProduct | undefined): string {
  if (!lt) return '12';
  if (lt.interestBasis !== 'declining') return String(lt.interestRate ?? 12);
  return String(tierDefaultDecliningRatePa(sharesToTier(m?.sharesBalance ?? 0)));
}

const LoanInput: React.FC = () => {
  const { members, addLoan, formatCurrency, loanProducts, refreshSaccoWorkspace, saccoLoanPolicies } = useAppContext();

  useEffect(() => {
    void refreshSaccoWorkspace();
  }, [refreshSaccoWorkspace]);
  const activeMembers = members.filter(m => m.status === 'active');
  /** If none are active in the register, still list members so the field is usable. */
  const memberChoices = activeMembers.length > 0 ? activeMembers : members;
  const activeProducts = loanProducts.filter(p => p.isActive);

  const [form, setForm] = useState({
    memberId: '', memberName: '', loanType: activeProducts[0]?.name || '',
    amount: '', interestRate: String(activeProducts[0]?.interestRate || 12),
    term: '12', guarantors: [''], purpose: '',
    applicationDate: new Date().toISOString().split('T')[0],
    collateralDescription: '',
    lc1ChairmanName: '',
    lc1ChairmanPhone: '',
  });

  const guarantorCandidates = memberChoices.filter(m => m.id !== form.memberId);

  // Get selected product
  const selectedProduct = activeProducts.find(p => p.name === form.loanType);
  const selectedMember = memberChoices.find(m => m.id === form.memberId);

  // Calculate fees
  const feeBreakdown = useMemo(() => {
    const amount = parseFloat(form.amount) || 0;
    if (!selectedProduct || amount === 0) return null;
    return calculateLoanFees(amount, selectedProduct);
  }, [form.amount, selectedProduct]);

  // Calculate monthly payment
  const calc = useMemo(() => {
    const P = parseFloat(form.amount) || 0;
    const rate = parseFloat(form.interestRate) || 0;
    const n = parseInt(form.term) || 1;
    const basis = selectedProduct?.interestBasis || 'declining';
    if (P === 0 || rate === 0) return { monthly: 0, total: 0, interest: 0, basis };

    const monthly = calculateMonthlyPayment(P, rate, n, basis);
    const total = monthly * n;
    const interest = total - P;
    return { monthly, total, interest, basis };
  }, [form.amount, form.interestRate, form.term, selectedProduct]);

  // Eligibility checks (compulsory savings & amount range apply only after a positive amount is entered)
  const eligibility = useMemo(() => {
    if (!selectedProduct || !selectedMember) return null;
    const amount = parseFloat(form.amount) || 0;
    const term = parseInt(form.term) || 0;
    const hasAmount = amount > 0;
    const requiredSavings = amount * selectedProduct.compulsorySavingsRate / 100;
    const hasSavings = hasAmount && selectedMember.savingsBalance >= requiredSavings;
    const savingsPending = !hasAmount;
    const hasShares = selectedMember.sharesBalance >= selectedProduct.minimumShares;
    const withinRange =
      hasAmount && amount >= selectedProduct.minAmount && amount <= selectedProduct.maxAmount;
    const amountRangePending = !hasAmount;
    const termOk = term >= 1 && term <= selectedProduct.maxTerm;
    const disbursePolicy = memberMeetsLoanDisbursePolicy(selectedMember, saccoLoanPolicies);
    const coolingMet = disbursePolicy.ok;
    const daysSince =
      selectedMember.firstOrdinarySavingsOpenedAt != null
        ? calendarDaysElapsedSince(selectedMember.firstOrdinarySavingsOpenedAt)
        : -1;
    const allMet =
      hasSavings && hasShares && withinRange && termOk && hasAmount && coolingMet;
    type CheckStatus = 'fulfilled' | 'not_fulfilled' | 'pending';
    const checklist: { key: string; label: string; status: CheckStatus; detail: string }[] = [
      {
        key: 'savings',
        label: `Compulsory savings (${selectedProduct.compulsorySavingsRate}% of loan amount)`,
        status: savingsPending ? 'pending' : hasSavings ? 'fulfilled' : 'not_fulfilled',
        detail: savingsPending
          ? 'Enter a loan amount to evaluate required savings vs member savings balance.'
          : `Required ${formatCurrency(requiredSavings)} · Member has ${formatCurrency(selectedMember.savingsBalance)} (ordinary savings accounts + register)`,
      },
      {
        key: 'shares',
        label: 'Minimum share capital',
        status: hasShares ? 'fulfilled' : 'not_fulfilled',
        detail: `Required ${formatCurrency(selectedProduct.minimumShares)} · Member has ${formatCurrency(selectedMember.sharesBalance)} (share-type accounts + register)`,
      },
      {
        key: 'amount',
        label: 'Loan amount within product limits',
        status: amountRangePending ? 'pending' : withinRange ? 'fulfilled' : 'not_fulfilled',
        detail: amountRangePending
          ? 'Enter a loan amount to check against this product’s minimum and maximum.'
          : `Allowed ${formatCurrency(selectedProduct.minAmount)} – ${formatCurrency(selectedProduct.maxAmount)} · Requested ${formatCurrency(amount)}`,
      },
      {
        key: 'term',
        label: 'Repayment term within product maximum',
        status: termOk ? 'fulfilled' : 'not_fulfilled',
        detail: `Maximum ${selectedProduct.maxTerm} months · Requested ${term || '—'} months`,
      },
      {
        key: 'cooling',
        label: `Savings tenure (org rule: ≥ ${saccoLoanPolicies.minSavingsDaysBeforeLoan} full days after first ordinary account)`,
        status: coolingMet ? 'fulfilled' : 'not_fulfilled',
        detail: coolingMet
          ? `Opened ${selectedMember.firstOrdinarySavingsOpenedAt ?? '—'} · elapsed ${daysSince >= 0 ? daysSince : '—'} full day(s)`
          : !disbursePolicy.ok
            ? disbursePolicy.reason
            : '—',
      },
    ];
    const fulfilledCount = checklist.filter((c) => c.status === 'fulfilled').length;
    const notFulfilledCount = checklist.filter((c) => c.status === 'not_fulfilled').length;
    const pendingCount = checklist.filter((c) => c.status === 'pending').length;
    return {
      requiredSavings,
      hasSavings,
      savingsPending,
      hasShares,
      withinRange,
      amountRangePending,
      termOk,
      hasAmount,
      allMet,
      checklist,
      fulfilledCount,
      notFulfilledCount,
      pendingCount,
    };
  }, [selectedProduct, selectedMember, form.amount, form.term, formatCurrency, saccoLoanPolicies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.memberId) return;
    if (!eligibility?.allMet) {
      return;
    }
    try {
      await addLoan({
      memberId: form.memberId, memberName: form.memberName, loanType: form.loanType,
      amount: parseFloat(form.amount), interestRate: parseFloat(form.interestRate),
      term: parseInt(form.term), applicationDate: form.applicationDate,
      guarantors: form.guarantors.filter(g => g), purpose: form.purpose,
      interestBasis: selectedProduct?.interestBasis || 'declining',
      fees: feeBreakdown || undefined,
      collateralDescription: form.collateralDescription.trim() || undefined,
      lc1ChairmanName: form.lc1ChairmanName.trim() || undefined,
      lc1ChairmanPhone: form.lc1ChairmanPhone.trim() || undefined,
    });
    toast({ title: 'Application submitted', description: 'Loan queued for approval.' });
    setForm({
      memberId: '', memberName: '', loanType: activeProducts[0]?.name || '',
      amount: '', interestRate: String(activeProducts[0]?.interestRate || 12),
      term: '12', guarantors: [''], purpose: '',
      applicationDate: new Date().toISOString().split('T')[0],
      collateralDescription: '',
      lc1ChairmanName: '',
      lc1ChairmanPhone: '',
    });
    } catch (err) {
      toast({
        title: 'Cannot apply',
        description: err instanceof Error ? err.message : 'Application failed.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Loan Application</h1>
        <PageNotes ariaLabel="Loan application help">
          <p>Submit a new loan application for processing.</p>
        </PageNotes>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><FileText size={16} /> Application Form</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Member</label>
                  <select required value={form.memberId} onChange={e => {
                    const m = memberChoices.find(x => x.id === e.target.value);
                    const lt = activeProducts.find(p => p.name === form.loanType);
                    setForm(p => ({
                      ...p,
                      memberId: e.target.value,
                      memberName: m?.name || '',
                      interestRate: suggestedAnnualRatePct(m, lt ?? selectedProduct ?? undefined),
                    }));
                  }} className={SELECT_FIELD}>
                    <option value="">Select Member</option>
                    {memberChoices.map(m => (
                      <option key={m.id} value={m.id} className="bg-white text-slate-900">
                        {m.name} ({m.accountNumber}){m.status === 'inactive' ? ' — inactive' : ''}
                      </option>
                    ))}
                  </select>
                  {selectedMember && (
                    <p className="text-[11px] text-slate-600 mt-1.5">
                      Membership tier: <span className="font-semibold text-slate-800">{tierLabel(sharesToTier(selectedMember.sharesBalance))}</span>
                      {' · '}
                      {tierBandsDescription()} Declining products use the ladder rate (% p.a.) automatically.
                    </p>
                  )}
                  {memberChoices.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">No members loaded. Open Members and ensure your register has members, then refresh.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Loan Product</label>
                  <select value={form.loanType} onChange={e => {
                    const lt = activeProducts.find(l => l.name === e.target.value);
                    const m = memberChoices.find(x => x.id === form.memberId);
                    const rateStr = suggestedAnnualRatePct(m, lt ?? undefined);
                    setForm(p => ({ ...p, loanType: e.target.value, interestRate: rateStr }));
                  }} className={SELECT_FIELD}>
                    {activeProducts.map(lt => (
                      <option key={lt.id} value={lt.name}>
                        {lt.name} ({lt.interestRate}% - {lt.interestBasis === 'flat' ? 'Flat' : 'Declining'})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Loan Amount (UGX)</label>
                  <input type="number" required min={selectedProduct?.minAmount || 1000}
                    max={selectedProduct?.maxAmount || 999999999}
                    value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder={selectedProduct ? `${formatCurrency(selectedProduct.minAmount)} - ${formatCurrency(selectedProduct.maxAmount)}` : 'Enter amount'} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Term (Months)</label>
                  <input type="number" required min="1" max={selectedProduct?.maxTerm || 48}
                    value={form.term} onChange={e => setForm(p => ({ ...p, term: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                  {selectedProduct && <p className="text-[10px] text-slate-400 mt-0.5">Max: {selectedProduct.maxTerm} months</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Interest Rate (% p.a.)</label>
                  <input type="number" required step="0.5" value={form.interestRate} onChange={e => setForm(p => ({ ...p, interestRate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                  {selectedProduct && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Basis: {selectedProduct.interestBasis === 'flat' ? 'Flat Rate' : 'Declining Balance'}
                    </p>
                  )}
                  {selectedMember &&
                    selectedProduct?.interestBasis === 'declining' &&
                    sharesToTier(selectedMember.sharesBalance) === 'silver' && (
                      <p className="text-[10px] text-amber-700 mt-0.5">
                        Silver ladder rate defaults to 21% p.a. declining—confirm board-approved rate matches before disbursement.
                      </p>
                    )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Application Date</label>
                  <input type="date" required value={form.applicationDate} onChange={e => setForm(p => ({ ...p, applicationDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Purpose</label>
                <textarea required value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none" placeholder="Describe the loan purpose..." />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <Landmark size={14} className="text-emerald-600" />
                  Collateral & LC1 verification
                </h4>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Collateral (description)</label>
                  <textarea value={form.collateralDescription} onChange={e => setForm(p => ({ ...p, collateralDescription: e.target.value }))} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none bg-white"
                    placeholder="e.g. land title, vehicle, livestock…" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">LC1 chairperson name</label>
                    <input type="text" value={form.lc1ChairmanName} onChange={e => setForm(p => ({ ...p, lc1ChairmanName: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      placeholder="Local Council I chairperson" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">LC1 chairperson phone</label>
                    <input type="tel" value={form.lc1ChairmanPhone} onChange={e => setForm(p => ({ ...p, lc1ChairmanPhone: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      placeholder="+256 …" />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">Guarantors</label>
                  <button type="button" onClick={() => setForm(p => ({ ...p, guarantors: [...p.guarantors, ''] }))} className="text-xs text-emerald-600 font-medium">+ Add</button>
                </div>
                {form.guarantors.map((g, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <select value={g} onChange={e => {
                      const newG = [...form.guarantors]; newG[i] = e.target.value;
                      setForm(p => ({ ...p, guarantors: newG }));
                    }} className={`flex-1 min-w-0 ${SELECT_FIELD}`}>
                      <option value="">Select Guarantor</option>
                      {guarantorCandidates.map(m => (
                        <option key={m.id} value={m.name} className="bg-white text-slate-900">
                          {m.name}{m.status === 'inactive' ? ' — inactive' : ''}
                        </option>
                      ))}
                    </select>
                    {form.guarantors.length > 1 && (
                      <button type="button" onClick={() => setForm(p => ({ ...p, guarantors: p.guarantors.filter((_, idx) => idx !== i) }))}
                        className="px-2 text-red-500 hover:text-red-700 text-sm">Remove</button>
                    )}
                  </div>
                ))}
              </div>

              {/* Conditions checklist — above submit so the button’s state matches what you see */}
              {eligibility && selectedMember && selectedProduct && (
                <div
                  className={`rounded-xl p-5 border ${
                    eligibility.allMet
                      ? 'bg-emerald-50 border-emerald-200'
                      : eligibility.pendingCount > 0
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                      <ListChecks size={16} className="text-emerald-600 shrink-0" />
                      Conditions to fulfil
                    </h3>
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-medium">
                      <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
                        Fulfilled {eligibility.fulfilledCount}
                      </span>
                      <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5">
                        Not fulfilled {eligibility.notFulfilledCount}
                      </span>
                      {eligibility.pendingCount > 0 && (
                        <span className="rounded-full bg-slate-200 text-slate-700 px-2 py-0.5">
                          Pending {eligibility.pendingCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 mb-4 leading-relaxed">
                    Savings and shares “have” values roll up from savings product accounts (ordinary savings vs share-type codes) and the member register —{" "}
                    <strong className="font-medium text-slate-700">refresh</strong> after teller postings so balances stay current.
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {eligibility.checklist.map((row) => {
                      const isOk = row.status === 'fulfilled';
                      const isNo = row.status === 'not_fulfilled';
                      const isWait = row.status === 'pending';
                      const rowBg =
                        isWait
                          ? 'bg-slate-100/80 border-slate-200'
                          : isOk
                            ? 'bg-emerald-100/50 border-emerald-200'
                            : 'bg-red-100/50 border-red-200';
                      const iconTone =
                        isWait ? 'text-slate-500' : isOk ? 'text-emerald-600' : 'text-red-600';
                      let LeadIcon: typeof PiggyBank;
                      if (row.key === 'savings') LeadIcon = PiggyBank;
                      else if (row.key === 'shares') LeadIcon = CreditCard;
                      else if (isWait) LeadIcon = MinusCircle;
                      else if (isOk) LeadIcon = CheckCircle;
                      else LeadIcon = AlertTriangle;
                      return (
                        <li
                          key={row.key}
                          className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${rowBg}`}
                        >
                          <span className="mt-0.5 shrink-0" aria-hidden>
                            <LeadIcon size={14} className={iconTone} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <span className="text-xs font-medium text-slate-900">{row.label}</span>
                              <span
                                className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                                  isOk ? 'text-emerald-800' : isWait ? 'text-slate-600' : 'text-red-800'
                                }`}
                              >
                                {isOk ? 'Fulfilled' : isWait ? 'Pending' : 'Not fulfilled'}
                              </span>
                            </div>
                            <p
                              className={`text-[11px] mt-0.5 leading-snug ${
                                isOk ? 'text-emerald-800/90' : isNo ? 'text-red-800/90' : 'text-slate-600'
                              }`}
                            >
                              {row.detail}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {eligibility.allMet ? (
                    <p className="mt-3 text-xs font-medium text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle size={14} className="shrink-0" />
                      All conditions are fulfilled — you can submit this application.
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-amber-900 flex items-start gap-1.5">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        {eligibility.pendingCount > 0
                          ? 'Complete amount (and any pending checks) so every row can be evaluated. '
                          : 'Resolve the items marked not fulfilled before submitting. '}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-4 border-t border-slate-100">
                {eligibility && selectedMember && selectedProduct && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 text-xs ${
                      eligibility.allMet
                        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                        : 'border-amber-200 bg-amber-50/80 text-amber-950'
                    }`}
                  >
                    {eligibility.allMet ? (
                      <span className="font-medium flex items-center gap-2">
                        <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                        Submit is enabled because all {eligibility.checklist.length} conditions in the checklist above are fulfilled (savings, shares, amount range, term).
                      </span>
                    ) : (
                      <span className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                        <span>
                          <span className="font-medium">Submit is disabled: </span>
                          {eligibility.pendingCount > 0 && (
                            <span>
                              {eligibility.pendingCount} still pending (enter loan amount where needed).{' '}
                            </span>
                          )}
                          {eligibility.notFulfilledCount > 0 && (
                            <span>
                              {eligibility.notFulfilledCount} not fulfilled — fix the red tiles in the checklist above.{' '}
                            </span>
                          )}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!eligibility?.allMet}
                    title={
                      !eligibility?.allMet
                        ? 'Fulfil every condition in the checklist (green tiles). Hover this button for status text above.'
                        : 'All checklist conditions are met — submit this application.'
                    }
                    className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg ${
                      !eligibility?.allMet
                        ? 'bg-slate-400 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    Submit Application
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Calculator */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><Calculator size={16} /> Loan Calculator</h3>
            <div className="space-y-4">
              {/* Interest Basis Badge */}
              {selectedProduct && (
                <div className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 ${
                  selectedProduct.interestBasis === 'flat' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-violet-50 text-violet-700 border border-violet-100'
                }`}>
                  <Info size={14} />
                  {selectedProduct.interestBasis === 'flat' ? 'Flat Rate Interest' : 'Declining Balance Interest'}
                </div>
              )}

              <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                <p className="text-xs text-emerald-600 mb-1">Monthly Payment</p>
                <p className="text-2xl font-bold text-emerald-700">{formatCurrency(calc.monthly)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Total Repayment</p>
                  <p className="text-sm font-bold text-slate-900">{formatCurrency(calc.total)}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Total Interest</p>
                  <p className="text-sm font-bold text-amber-600">{formatCurrency(calc.interest)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Fee Breakdown */}
          {feeBreakdown && selectedProduct && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><CreditCard size={16} /> Fee Breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-xs text-slate-500">Loan Form Fee</span>
                  <span className="text-xs font-medium">{formatCurrency(feeBreakdown.formFee)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-xs text-slate-500">Monitoring fee (upfront)</span>
                  <span className="text-xs font-medium">{formatCurrency(feeBreakdown.monitoringFee)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-xs text-slate-500">Processing Fee ({selectedProduct.fees.processingFeeRate}%)</span>
                  <span className="text-xs font-medium">{formatCurrency(feeBreakdown.processingFee)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-xs text-slate-500">Insurance ({selectedProduct.fees.insuranceFeeRate}%)</span>
                  <span className="text-xs font-medium">{formatCurrency(feeBreakdown.insuranceFee)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-xs text-slate-500">Application Fee ({selectedProduct.fees.applicationFeeRate}%)</span>
                  <span className="text-xs font-medium">{formatCurrency(feeBreakdown.applicationFee)}</span>
                </div>
                <div className="flex justify-between py-2 border-t-2 border-slate-200 mt-2">
                  <span className="text-xs font-bold text-red-600">Total Fees</span>
                  <span className="text-xs font-bold text-red-600">{formatCurrency(feeBreakdown.totalFees)}</span>
                </div>
                <div className="flex justify-between py-2 bg-emerald-50 px-3 rounded-lg -mx-1">
                  <span className="text-xs font-bold text-emerald-700">Net Disbursement</span>
                  <span className="text-xs font-bold text-emerald-700">{formatCurrency(feeBreakdown.netDisbursement)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Loan Products Info */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><CreditCard size={16} /> Loan Products</h3>
            <div className="space-y-3">
              {activeProducts.map(lt => (
                <div key={lt.id} className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  form.loanType === lt.name ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                }`} onClick={() => {
                  setForm(p => ({ ...p, loanType: lt.name, interestRate: String(lt.interestRate) }));
                }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-900">{lt.name}</p>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      lt.interestBasis === 'flat' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                    }`}>
                      {lt.interestBasis === 'flat' ? 'Flat' : 'Declining'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>Rate: {lt.interestRate}% p.a.</span>
                    <span>Max: {lt.maxTerm} months</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>Savings: {lt.compulsorySavingsRate}%</span>
                    <span>Shares: {formatCurrency(lt.minimumShares)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoanInput;
