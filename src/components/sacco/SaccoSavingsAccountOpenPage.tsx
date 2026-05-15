import { useCallback, useEffect, useState } from "react";
import { Wallet, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { suggestNextSavingsAccountNumber } from "@/lib/saccoAccountNumberSettings";
import { fetchSaccoBranches, pickDefaultBranchCode, type SaccoBranchRow } from "@/lib/saccoBranches";
import { openSavingsAccountForMember } from "@/lib/saccoOpenMemberSavingsAccount";
import { fetchSavingsProductTypes, type SaccoSavingsProductTypeRow } from "@/lib/saccoSavingsProductTypes";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";
import { toast } from "@/components/ui/use-toast";
import type { SaccoMemberRow } from "./SaccoMembersPage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type SaccoSavingsAccountOpenPageProps = {
  readOnly?: boolean;
  /** From `?memberId=` / navigate state — keep in sync with URL when changing member. */
  memberIdFromNav?: string;
  navigate?: (page: string, state?: Record<string, unknown>) => void;
};

export function SaccoSavingsAccountOpenPage({
  readOnly = false,
  memberIdFromNav,
  navigate,
}: SaccoSavingsAccountOpenPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;

  const [members, setMembers] = useState<SaccoMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [memberId, setMemberId] = useState("");
  const [dateAccountOpened, setDateAccountOpened] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientNo, setClientNo] = useState("");
  const [clientFullName, setClientFullName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [subAccount, setSubAccount] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [savingsProductTypes, setSavingsProductTypes] = useState<SaccoSavingsProductTypeRow[]>([]);
  const [branches, setBranches] = useState<SaccoBranchRow[]>([]);
  const [branchCode, setBranchCode] = useState("");

  const loadMembers = useCallback(async () => {
    if (!orgId) {
      setMembers([]);
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    const { data, error } = await sb.from("sacco_members").select("*").eq("organization_id", orgId).order("member_number");
    if (error) {
      toast({ title: "Could not load members", description: error.message, variant: "destructive" });
      setMembers([]);
    } else {
      setMembers((data || []) as SaccoMemberRow[]);
    }
    setLoadingMembers(false);
  }, [orgId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!orgId) {
      setSavingsProductTypes([]);
      setBranches([]);
      setBranchCode("");
      return;
    }
    void fetchSavingsProductTypes(orgId)
      .then(({ rows }) => setSavingsProductTypes(rows))
      .catch(() => setSavingsProductTypes([]));
    void fetchSaccoBranches(orgId)
      .then(({ rows }) => {
        setBranches(rows.filter((b) => b.is_active));
        setBranchCode((prev) => {
          if (prev && rows.some((b) => b.code === prev && b.is_active)) return prev;
          return pickDefaultBranchCode(rows.filter((b) => b.is_active), "");
        });
      })
      .catch(() => {
        setBranches([]);
        setBranchCode("");
      });
  }, [orgId]);

  useEffect(() => {
    setMemberId(memberIdFromNav ?? "");
  }, [memberIdFromNav]);

  const applyMember = useCallback((m: SaccoMemberRow) => {
    setClientNo(m.member_number);
    setClientFullName(m.full_name);
  }, []);

  useEffect(() => {
    if (!memberId) return;
    const m = members.find((x) => x.id === memberId);
    if (m) applyMember(m);
  }, [memberId, members, applyMember]);

  const regenerateAccountNumber = useCallback(async () => {
    if (!orgId || !productCode.trim()) {
      setAccountNo("");
      return;
    }
    setGenerating(true);
    try {
      const next = await suggestNextSavingsAccountNumber(
        orgId,
        productCode.trim(),
        branchCode.trim() || undefined
      );
      setAccountNo(next);
    } catch (e) {
      toast({
        title: "Could not generate account number",
        description: e instanceof Error ? e.message : "Check migrations and account number settings.",
        variant: "destructive",
      });
      setAccountNo("");
    } finally {
      setGenerating(false);
    }
  }, [orgId, productCode, branchCode]);

  useEffect(() => {
    void regenerateAccountNumber();
  }, [regenerateAccountNumber]);

  const resetForm = () => {
    navigate?.(SACCOPRO_PAGE.savingsAccountOpen, {});
    setMemberId("");
    setDateAccountOpened(new Date().toISOString().slice(0, 10));
    setClientNo("");
    setClientFullName("");
    setProductCode("");
    setSubAccount("");
    setAccountNo("");
    setBranchCode(branches.length > 0 ? pickDefaultBranchCode(branches, "") : "");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || readOnly) return;
    if (!memberId) {
      toast({ title: "Select a member", variant: "destructive" });
      return;
    }
    const m = members.find((x) => x.id === memberId);
    if (!m) {
      toast({ title: "Member not found", description: "Refresh and try again.", variant: "destructive" });
      return;
    }
    if (!m.full_name.trim()) {
      toast({ title: "Member name missing", description: "Edit the member on the Members page.", variant: "destructive" });
      return;
    }
    if (!productCode.trim()) {
      toast({ title: "Product code is required", description: "Used for the account number and sub-ledger.", variant: "destructive" });
      return;
    }
    if (!accountNo.trim()) {
      toast({ title: "Account number missing", description: "Enter a product code and generate the number.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const result = await openSavingsAccountForMember({
        organizationId: orgId,
        member: m,
        productCode: productCode.trim(),
        accountNumber: accountNo.trim(),
        branchCode: branchCode.trim() || null,
        subAccount: subAccount.trim() || null,
        dateAccountOpened,
        postedByStaffId: user?.id ?? null,
        postedByName: user?.full_name || user?.email || null,
      });
      if (result.status === "failed") {
        toast({ title: "Save failed", description: result.message, variant: "destructive" });
        return;
      }
      if (result.basicOnly) {
        toast({
          title: "Savings account opened (basic)",
          description: `Account ${result.accountNumber}. Apply migration 20260426120004 on Supabase to store opening KYC fields.`,
        });
      } else {
        toast({ title: "Savings account opened", description: `Account ${result.accountNumber}` });
      }
      resetForm();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500";
  const label = "block text-xs font-medium text-slate-700 mb-1";

  const selectedMember = memberId ? members.find((x) => x.id === memberId) : undefined;

  if (!orgId) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-slate-600 text-sm">Link your account to an organization to open savings accounts.</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Wallet className="w-7 h-7 shrink-0 text-emerald-700" />
          <h1 className="text-2xl font-bold text-slate-900">Open savings account</h1>
          <PageNotes ariaLabel="Open savings account help">
            <p className="text-sm text-slate-700">
              Register a new savings product account for a member. Client profile (name, contact, next of kin, etc.) is maintained on{" "}
              <strong className="text-slate-800">Members</strong> and copied into this account when you save. Account numbers follow{" "}
              <strong className="font-medium text-slate-800">Savings settings</strong> (branch / product code / serial).
            </p>
          </PageNotes>
        </div>
      </header>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Read-only mode — saving is disabled.</div>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-8">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">Account &amp; product</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={label}>Member</label>
              <select
                required
                disabled={loadingMembers}
                value={memberId}
                onChange={(e) => {
                  const v = e.target.value;
                  setMemberId(v);
                  navigate?.(SACCOPRO_PAGE.savingsAccountOpen, v ? { memberId: v } : {});
                }}
                className={`${field} [color-scheme:light]`}
              >
                <option value="">Select member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.member_number} — {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Date account opened</label>
              <input type="date" required value={dateAccountOpened} onChange={(e) => setDateAccountOpened(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Branch</label>
              {branches.length > 0 ? (
                <select
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  className={`${field} [color-scheme:light]`}
                  required
                >
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.code}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value.replace(/\D/g, ""))}
                    className={field}
                    inputMode="numeric"
                    placeholder="Branch code (from Savings settings)"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Add branches under Savings settings, or enter the branch segment code here.</p>
                </>
              )}
            </div>
            <div>
              <label className={label}>Product code</label>
              {savingsProductTypes.filter((t) => t.is_active).length > 0 ? (
                <select
                  className={`${field} mb-2 text-xs [color-scheme:light]`}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setProductCode(v);
                  }}
                >
                  <option value="">Pick from registered savings types…</option>
                  {savingsProductTypes
                    .filter((t) => t.is_active)
                    .map((t) => (
                      <option key={t.id} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                </select>
              ) : null}
              <input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                className={field}
                placeholder="e.g. 12 (must match a type code from Savings settings)"
                required
              />
              <p className="text-[10px] text-slate-500 mt-0.5">Drives the account-type segment in the structured account number.</p>
            </div>
            <div>
              <label className={label}>SubAccount</label>
              <input value={subAccount} onChange={(e) => setSubAccount(e.target.value)} className={field} placeholder="e.g. Ordinary, Fixed pot" />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Account No.</label>
              <div className="flex gap-2">
                <input readOnly value={accountNo} className={`${field} bg-slate-50 font-mono`} placeholder="Generated from product code" />
                <button
                  type="button"
                  onClick={() => void regenerateAccountNumber()}
                  disabled={generating || !productCode.trim()}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        </section>

        {selectedMember ? (
          <section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-emerald-900 border-b border-emerald-100 pb-2">Member profile (read-only snapshot source)</h2>
            <p className="text-xs text-emerald-900/90">
              These details come from the member register. Edit them under <strong>Members</strong> → Edit member before saving this account if anything
              is out of date.
            </p>
            <dl className="grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Client no. / Name</dt>
                <dd className="font-mono text-xs text-slate-900">
                  {clientNo} — {clientFullName}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Phone / Email</dt>
                <dd className="text-slate-800">{fmtContact(selectedMember.phone, selectedMember.email)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Gender / DOB</dt>
                <dd className="text-slate-800">{fmtText(selectedMember.gender)} · {fmtDob(selectedMember.date_of_birth)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Occupation</dt>
                <dd className="text-slate-800">{fmtText(selectedMember.occupation)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Address</dt>
                <dd className="text-slate-800">{fmtText(selectedMember.address)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[10px] font-semibold uppercase text-emerald-800/80">Next of kin</dt>
                <dd className="text-slate-800">
                  {fmtText(selectedMember.next_of_kin)} {selectedMember.nok_phone ? `· ${selectedMember.nok_phone}` : ""}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">Audit</h2>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-xs font-medium text-slate-500">Posted By</span>
              <p className="mt-0.5 text-slate-900">{user?.full_name || user?.email || "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Edited By</span>
              <p className="mt-0.5 text-slate-400">— (on first save)</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={resetForm} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Clear
          </button>
          <button
            type="submit"
            disabled={readOnly || saving || !accountNo}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save account
          </button>
        </div>
      </form>
    </div>
  );
}

function fmtText(v: string | null | undefined): string {
  const s = v?.trim();
  return s ? s : "—";
}

function fmtDob(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function fmtContact(phone: string | null | undefined, email: string | null | undefined): string {
  const p = phone?.trim();
  const e = email?.trim();
  if (p && e) return `${p} · ${e}`;
  return p || e || "—";
}
