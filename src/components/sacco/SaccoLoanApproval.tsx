import React, { useMemo, useState } from "react";
import { useAppContext, Loan } from "@/contexts/AppContext";
import { toast } from "@/components/ui/use-toast";
import { CheckCircle, XCircle, Clock, Eye, X, ChevronRight, Shield } from "lucide-react";

export type LoanApprovalPipeline = "approval_gates" | "disbursement_final";

type Props = {
  pipeline?: LoanApprovalPipeline;
};

const LoanApproval: React.FC<Props> = ({ pipeline = "approval_gates" }) => {
  const { loans, approveLoan, rejectLoan, formatCurrency, members } = useAppContext();
  const [viewLoan, setViewLoan] = useState<Loan | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");

  const stages = ["Credit Officer Review", "Manager Approval", "Board Approval"];

  const pendingLoans = useMemo(() => {
    return loans.filter((l) => {
      if (l.status !== "pending") return false;
      if (pipeline === "approval_gates") return l.approvalStage < 2;
      return l.approvalStage >= 2;
    });
  }, [loans, pipeline]);

  const filtered =
    pipeline === "disbursement_final"
      ? pendingLoans
      : stageFilter === "all"
        ? pendingLoans
        : pendingLoans.filter((l) => l.approvalStage === parseInt(stageFilter));

  const heading =
    pipeline === "disbursement_final" ? "Loan disbursement" : "Loan approvals";

  const subtitle =
    pipeline === "disbursement_final"
      ? `${pendingLoans.length} application(s) cleared for funds release`
      : `${pendingLoans.length} application(s) in the approval pipeline`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
          <p className="text-slate-500 text-sm">{subtitle}</p>
        </div>
      </div>

      {pipeline === "approval_gates" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stages.slice(0, 2).map((s, i) => {
            const count = pendingLoans.filter((l) => l.approvalStage === i).length;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setStageFilter(stageFilter === String(i) ? "all" : String(i))}
                className={`bg-white rounded-xl p-4 shadow-sm border transition-all text-left ${
                  stageFilter === String(i) ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-100 hover:border-slate-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${count > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}
                  >
                    {count}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Stage {i + 1}</p>
                    <p className="text-sm font-medium text-slate-900">{s}</p>
                  </div>
                </div>
              </button>
            );
          })}
          <div className="bg-slate-50 rounded-xl p-4 border border-dashed border-slate-200 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Board-cleared</p>
            <p className="text-xs mt-1">After stage 2 passes, applications move to Loans → Disbursement for cash release.</p>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <CheckCircle size={48} className="mx-auto text-emerald-300 mb-3" />
          <p className="text-lg font-medium text-slate-900">All caught up!</p>
          <p className="text-sm text-slate-500">
            {pipeline === "disbursement_final"
              ? "Nothing waiting for disbursement right now."
              : "No applications at this gate."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((loan) => {
            const member = members.find((m) => m.id === loan.memberId);
            const disburseClick = pipeline === "disbursement_final" || loan.approvalStage >= 2;
            return (
              <div key={loan.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold">
                        {loan.memberName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{loan.memberName}</h3>
                        <p className="text-sm text-slate-500">
                          {loan.loanType} | {loan.id}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-slate-900">{formatCurrency(loan.amount)}</p>
                      <p className="text-xs text-slate-500">
                        {loan.interestRate}% p.a. | {loan.term} months
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    {stages.map((s, i) => (
                      <React.Fragment key={i}>
                        <div
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                          ${i < loan.approvalStage ? "bg-emerald-100 text-emerald-700" : i === loan.approvalStage ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}
                        >
                          {i < loan.approvalStage ? (
                            <CheckCircle size={12} />
                          ) : i === loan.approvalStage ? (
                            <Clock size={12} />
                          ) : (
                            <Shield size={12} />
                          )}
                          {s}
                        </div>
                        {i < stages.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-400">Monthly Payment</p>
                      <p className="text-sm font-medium">{formatCurrency(loan.monthlyPayment)}</p>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-400">Purpose</p>
                      <p className="text-sm font-medium truncate">{loan.purpose}</p>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-400">Guarantors</p>
                      <p className="text-sm font-medium">{loan.guarantors.join(", ")}</p>
                    </div>
                    <div className="p-2 bg-slate-50 rounded-lg">
                      <p className="text-xs text-slate-400">Savings Balance</p>
                      <p className="text-sm font-medium">{member ? formatCurrency(member.savingsBalance) : "N/A"}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3 pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await approveLoan(loan.id);
                          toast({
                            title: disburseClick ? "Disbursement posted" : "Stage advanced",
                            description: disburseClick
                              ? "Funds released subject to treasury balance."
                              : "Moved to the next approval gate.",
                          });
                        } catch (e) {
                          toast({
                            title: disburseClick ? "Disbursement blocked" : "Approval blocked",
                            description: e instanceof Error ? e.message : "Unable to complete this step.",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700"
                    >
                      <CheckCircle size={14} />{" "}
                      {disburseClick ? "Disburse loan" : `Approve Stage ${loan.approvalStage + 1}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectLoan(loan.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 border border-red-200"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewLoan(loan)}
                      className="flex items-center gap-2 px-4 py-2 text-slate-600 text-sm rounded-lg hover:bg-slate-100"
                    >
                      <Eye size={14} /> Full Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Recently Processed</h3>
        <div className="space-y-2">
          {loans
            .filter((l) => l.status === "approved" || l.status === "rejected")
            .slice(-5)
            .reverse()
            .map((l) => (
              <div key={l.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${l.status === "approved" ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}
                  >
                    {l.status === "approved" ? <CheckCircle size={12} /> : <XCircle size={12} />}
                  </div>
                  <div>
                    <p className="text-sm text-slate-900">{l.memberName}</p>
                    <p className="text-xs text-slate-400">
                      {l.loanType} - {formatCurrency(l.amount)}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
                >
                  {l.status}
                </span>
              </div>
            ))}
        </div>
      </div>

      {viewLoan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewLoan(null)}>
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold">Loan Details - {viewLoan.id}</h2>
              <button type="button" onClick={() => setViewLoan(null)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-3">
              {[
                ["Member", viewLoan.memberName],
                ["Loan Type", viewLoan.loanType],
                ["Amount", formatCurrency(viewLoan.amount)],
                ["Interest Rate", `${viewLoan.interestRate}% p.a.`],
                ["Term", `${viewLoan.term} months`],
                ["Monthly Payment", formatCurrency(viewLoan.monthlyPayment)],
                ["Purpose", viewLoan.purpose],
                ["Guarantors", viewLoan.guarantors.join(", ")],
                ["Application Date", viewLoan.applicationDate],
                ["Current Stage", stages[viewLoan.approvalStage] || "Completed"],
              ].map(([l, v]) => (
                <div key={String(l)} className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-sm text-slate-500">{l}</span>
                  <span className="text-sm font-medium text-slate-900">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanApproval;
