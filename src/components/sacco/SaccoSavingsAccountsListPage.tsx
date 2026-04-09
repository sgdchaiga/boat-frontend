import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardList, Loader2, Pencil, RefreshCw, Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";
import {
  fetchSavingsAccountsList,
  type SaccoSavingsAccountListRow,
} from "@/lib/saccoSavingsAccountsList";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function fmtUgx(n: number): string {
  return `UGX ${Math.round(Number(n) || 0).toLocaleString("en-UG")}`;
}

function fmtText(v: string | null | undefined): string {
  const s = v?.trim();
  return s ? s : "—";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

const fieldLabel = "text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const fieldVal = "text-sm text-slate-900 break-words";

type SaccoSavingsAccountsListPageProps = {
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
};

export function SaccoSavingsAccountsListPage({ onNavigate }: SaccoSavingsAccountsListPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;

  const [rows, setRows] = useState<SaccoSavingsAccountListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountNumberDraft, setAccountNumberDraft] = useState("");
  const [savingAcctNo, setSavingAcctNo] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSavingsAccountsList(orgId);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load savings accounts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (editingAccountId && expandedId !== editingAccountId) {
      setEditingAccountId(null);
      setAccountNumberDraft("");
    }
  }, [expandedId, editingAccountId]);

  const startEditAccountNumber = (r: SaccoSavingsAccountListRow) => {
    setEditingAccountId(r.id);
    setAccountNumberDraft(r.account_number);
  };

  const cancelEditAccountNumber = () => {
    setEditingAccountId(null);
    setAccountNumberDraft("");
  };

  const saveAccountNumber = async () => {
    if (!orgId || !editingAccountId) return;
    const next = accountNumberDraft.trim();
    if (!next) {
      alert("Account number is required.");
      return;
    }
    setSavingAcctNo(true);
    try {
      const { error } = await sb
        .from("sacco_member_savings_accounts")
        .update({ account_number: next })
        .eq("id", editingAccountId)
        .eq("organization_id", orgId);
      if (error) throw error;
      cancelEditAccountNumber();
      await load();
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "Could not update account number. It must be unique within your organization."
      );
    } finally {
      setSavingAcctNo(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const mem = r.sacco_members;
      const hay = [
        r.account_number,
        r.savings_product_code,
        r.sub_account,
        mem?.member_number,
        mem?.full_name,
        r.client_no,
        r.client_full_name,
        r.telephone,
        r.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  if (!orgId) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-slate-600 text-sm">Link your account to an organization to view savings accounts.</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-16">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ClipboardList className="w-8 h-8 shrink-0 text-emerald-700" />
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Savings accounts</h1>
            <PageNotes ariaLabel="Savings accounts help">
              <p className="text-sm text-slate-700">
                All savings product accounts opened for members — balances, product codes, opening snapshot (KYC), and audit. You can correct an account
                number under row details if it was entered wrong (must stay unique per organization).
              </p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate?.(SACCOPRO_PAGE.savingsAccountOpen, {})}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
          >
            Open new account
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search account #, member, product, phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="p-3 w-10" aria-hidden />
                <th className="p-3">Account number</th>
                <th className="p-3">Product</th>
                <th className="p-3">Member (current)</th>
                <th className="p-3 text-right">Balance</th>
                <th className="p-3">Status</th>
                <th className="p-3">Opened</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline-block" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-500">
                    {rows.length === 0 ? "No savings accounts yet — open one from Members or use “Open new account”." : "No matches for your search."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const mem = r.sacco_members;
                  const open = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className={`border-b border-slate-100 hover:bg-slate-50/80 ${open ? "bg-emerald-50/40" : ""}`}>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(open ? null : r.id)}
                            className="p-1 rounded text-slate-600 hover:bg-slate-200/80"
                            aria-expanded={open}
                            title={open ? "Hide details" : "Show all account details"}
                          >
                            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="p-3 font-mono text-xs font-medium text-slate-900">{r.account_number}</td>
                        <td className="p-3">
                          <span className="font-mono text-xs">{r.savings_product_code}</span>
                          {r.sub_account ? (
                            <span className="block text-[10px] text-slate-500">Sub: {r.sub_account}</span>
                          ) : null}
                        </td>
                        <td className="p-3">
                          {mem ? (
                            <>
                              <span className="font-medium text-slate-900">{mem.full_name}</span>
                              <span className="block text-xs text-slate-500 font-mono">{mem.member_number}</span>
                            </>
                          ) : (
                            <span className="text-slate-500 text-xs">Member {r.sacco_member_id.slice(0, 8)}…</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums font-medium text-slate-900">{fmtUgx(r.balance)}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.is_active ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {r.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-600 whitespace-nowrap">{fmtDate(r.date_account_opened ?? r.created_at)}</td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-slate-100 bg-slate-50/90">
                          <td colSpan={7} className="p-4 md:p-6">
                            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
                              <section className="space-y-2">
                                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Identifiers</h3>
                                <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2">
                                  <dt className={fieldLabel}>Row ID</dt>
                                  <dd className={`${fieldVal} font-mono text-xs`}>{r.id}</dd>
                                  <dt className={fieldLabel}>Member ID</dt>
                                  <dd className={`${fieldVal} font-mono text-xs`}>{r.sacco_member_id}</dd>
                                  <dt className={fieldLabel}>Account number</dt>
                                  <dd className={`${fieldVal} font-mono`}>
                                    {editingAccountId === r.id ? (
                                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                        <input
                                          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-mono text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                                          value={accountNumberDraft}
                                          onChange={(e) => setAccountNumberDraft(e.target.value)}
                                          disabled={savingAcctNo}
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          onClick={() => void saveAccountNumber()}
                                          disabled={savingAcctNo}
                                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                          {savingAcctNo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditAccountNumber}
                                          disabled={savingAcctNo}
                                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="inline-flex flex-wrap items-center gap-2">
                                        {r.account_number}
                                        <button
                                          type="button"
                                          onClick={() => startEditAccountNumber(r)}
                                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                                          title="Edit account number"
                                        >
                                          <Pencil className="w-3 h-3" />
                                          Edit
                                        </button>
                                      </span>
                                    )}
                                  </dd>
                                  <dt className={fieldLabel}>Product code</dt>
                                  <dd className={`${fieldVal} font-mono`}>{r.savings_product_code}</dd>
                                  <dt className={fieldLabel}>Sub-account</dt>
                                  <dd className={fieldVal}>{fmtText(r.sub_account)}</dd>
                                </dl>
                              </section>
                              <section className="space-y-2">
                                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Balances &amp; status</h3>
                                <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2">
                                  <dt className={fieldLabel}>Balance</dt>
                                  <dd className={`${fieldVal} tabular-nums`}>{fmtUgx(r.balance)}</dd>
                                  <dt className={fieldLabel}>Active</dt>
                                  <dd className={fieldVal}>{r.is_active ? "Yes" : "No"}</dd>
                                  <dt className={fieldLabel}>Date opened</dt>
                                  <dd className={fieldVal}>{fmtDate(r.date_account_opened)}</dd>
                                  <dt className={fieldLabel}>Created</dt>
                                  <dd className={fieldVal}>{fmtDateTime(r.created_at)}</dd>
                                  <dt className={fieldLabel}>Updated</dt>
                                  <dd className={fieldVal}>{fmtDateTime(r.updated_at)}</dd>
                                </dl>
                              </section>
                              <section className="space-y-2">
                                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Opening snapshot (KYC)</h3>
                                <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2">
                                  <dt className={fieldLabel}>Client no.</dt>
                                  <dd className={fieldVal}>{fmtText(r.client_no)}</dd>
                                  <dt className={fieldLabel}>Name (at opening)</dt>
                                  <dd className={fieldVal}>{fmtText(r.client_full_name)}</dd>
                                  <dt className={fieldLabel}>Gender</dt>
                                  <dd className={fieldVal}>{fmtText(r.gender)}</dd>
                                  <dt className={fieldLabel}>Date of birth</dt>
                                  <dd className={fieldVal}>{fmtDate(r.date_of_birth)}</dd>
                                  <dt className={fieldLabel}>Marital status</dt>
                                  <dd className={fieldVal}>{fmtText(r.marital_status)}</dd>
                                  <dt className={fieldLabel}>Address</dt>
                                  <dd className={fieldVal}>{fmtText(r.address)}</dd>
                                  <dt className={fieldLabel}>Telephone</dt>
                                  <dd className={fieldVal}>{fmtText(r.telephone)}</dd>
                                  <dt className={fieldLabel}>Email</dt>
                                  <dd className={fieldVal}>{fmtText(r.email)}</dd>
                                  <dt className={fieldLabel}>Occupation</dt>
                                  <dd className={fieldVal}>{fmtText(r.occupation)}</dd>
                                  <dt className={fieldLabel}>Next of kin</dt>
                                  <dd className={fieldVal}>{fmtText(r.next_of_kin)}</dd>
                                  <dt className={fieldLabel}>NOK phone</dt>
                                  <dd className={fieldVal}>{fmtText(r.nok_phone)}</dd>
                                </dl>
                              </section>
                              <section className="space-y-2 lg:col-span-2 xl:col-span-3">
                                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Audit</h3>
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                                  <div>
                                    <dt className={fieldLabel}>Posted by</dt>
                                    <dd className={fieldVal}>{fmtText(r.posted_by_name)}</dd>
                                    <dd className="text-xs text-slate-500 font-mono">{r.posted_by_staff_id ?? "—"}</dd>
                                  </div>
                                  <div>
                                    <dt className={fieldLabel}>Last edited by</dt>
                                    <dd className={fieldVal}>{fmtText(r.edited_by_name)}</dd>
                                    <dd className="text-xs text-slate-500 font-mono">{r.edited_by_staff_id ?? "—"}</dd>
                                  </div>
                                </dl>
                              </section>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {filtered.length} of {rows.length} account{rows.length === 1 ? "" : "s"} shown
        {query.trim() ? " (filtered)" : ""}.
      </p>
    </div>
  );
}
