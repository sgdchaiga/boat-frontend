import React, { useEffect, useMemo, useState } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Search } from "lucide-react";
import { SaccoReportToolbar } from "@/components/common/SaccoReportToolbar";
import { downloadMemberSavingsPdf } from "@/lib/saccoReportPdf";

type Props = {
  navigate?: (page: string, state?: Record<string, unknown>) => void;
  /** Sidebar label “Savings reports” uses a board-facing title here. */
  heading?: string;
  intro?: string;
  memberIdFromNav?: string;
};

/** Cashbook-derived view of member-facing savings-oriented lines (no new postings). */
const SaccoSavingsStatementsPage: React.FC<Props> = ({ navigate, heading = "Savings statements", intro, memberIdFromNav }) => {
  const { user } = useAuth();
  const { members, cashbook, formatCurrency } = useAppContext();
  const [memberId, setMemberId] = useState(memberIdFromNav ?? "");
  const [memberSearch, setMemberSearch] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: "date" | "member" | "details" | "debit" | "credit" | "balance"; direction: "asc" | "desc" }>({ key: "date", direction: "desc" });
  const [orgHeader, setOrgHeader] = useState<{ name: string; address: string | null }>({
    name: "SACCO",
    address: null,
  });

  useEffect(() => {
    if (memberIdFromNav) setMemberId(memberIdFromNav);
  }, [memberIdFromNav]);

  useEffect(() => {
    const orgId = user?.organization_id;
    if (!orgId) return;
    let alive = true;
    void supabase
      .from("organizations")
      .select("name,address")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const row = data as { name?: string | null; address?: string | null } | null;
        setOrgHeader({
          name: row?.name?.trim() || "SACCO",
          address: row?.address?.trim() ? row.address.trim() : null,
        });
      });
    return () => {
      alive = false;
    };
  }, [user?.organization_id]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const normalize = (value: unknown) => String(value || "").trim().toLocaleLowerCase();

  const rows = useMemo(() => {
    let list = cashbook.slice();
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((e) => e.description?.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q));
    if (memberId) list = list.filter((e) => e.memberId === memberId);
    const memberQuery = normalize(memberSearch);
    if (memberQuery) {
      list = list.filter((entry) => {
        const member = entry.memberId ? memberById.get(entry.memberId) : undefined;
        return normalize(`${entry.memberName || member?.name || ""} ${member?.accountNumber || ""}`).includes(memberQuery);
      });
    }
    const direction = sort.direction === "asc" ? 1 : -1;
    const compareText = (left: unknown, right: unknown) =>
      String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
    list.sort((a, b) => {
      let result = 0;
      if (sort.key === "date") result = compareText(a.date, b.date);
      else if (sort.key === "member") {
        const memberA = a.memberId ? memberById.get(a.memberId) : undefined;
        const memberB = b.memberId ? memberById.get(b.memberId) : undefined;
        result = compareText(`${a.memberName || memberA?.name || ""} ${memberA?.accountNumber || ""}`, `${b.memberName || memberB?.name || ""} ${memberB?.accountNumber || ""}`);
      } else if (sort.key === "details") result = compareText(`${a.description || ""} ${a.reference || ""}`, `${b.description || ""} ${b.reference || ""}`);
      else result = Number(a[sort.key] || 0) - Number(b[sort.key] || 0);
      return result === 0 ? compareText(a.id, b.id) : result * direction;
    });
    return list;
  }, [cashbook, memberById, memberId, memberSearch, search, sort]);

  const filteredMembers = useMemo(() => {
    const q = normalize(memberSearch);
    return q ? members.filter((member) => normalize(`${member.name || ""} ${member.accountNumber || ""}`).includes(q)) : members;
  }, [memberSearch, members]);
  const toggleSort = (key: typeof sort.key) => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "date" ? "desc" : "asc" });
  const SortIcon = ({ column }: { column: typeof sort.key }) =>
    sort.key !== column ? <ArrowUpDown size={13} /> : sort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />;

  const lastBalance =
    rows.length > 0
      ? rows.reduce((picked, r) => (r.date >= picked.date ? r : picked), rows[rows.length - 1]).balance
      : 0;
  const selectedMember = members.find((m) => m.id === memberId) ?? null;
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);

  return (
    <div className="space-y-6">
      <style>
        {`
          @media print {
            body * { visibility: hidden; }
            #sacco-member-statement-print, #sacco-member-statement-print * { visibility: visible; }
            #sacco-member-statement-print {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              background: white;
              padding: 18mm;
              color: #0f172a;
            }
            #sacco-member-statement-print table { width: 100%; border-collapse: collapse; font-size: 11px; }
            #sacco-member-statement-print .statement-scroll { overflow: visible !important; }
            #sacco-member-statement-print .statement-table {
              min-width: 0 !important;
              table-layout: fixed;
              font-size: 9.5px;
            }
            #sacco-member-statement-print th,
            #sacco-member-statement-print td {
              border-bottom: 1px solid #cbd5e1;
              padding: 4px;
              white-space: normal !important;
              overflow-wrap: anywhere;
            }
            #sacco-member-statement-print .col-date { width: 13%; }
            #sacco-member-statement-print .col-member { width: 18%; }
            #sacco-member-statement-print .col-details { width: 33%; }
            #sacco-member-statement-print .col-money { width: 12%; }
            #sacco-member-statement-print thead { display: table-header-group; }
            #sacco-member-statement-print tr { break-inside: avoid; }
          }
        `}
      </style>
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="text-emerald-600" size={26} />
        <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
        <PageNotes ariaLabel="Statements help">
          <p className="text-sm">
            {intro ??
              "Read-only list from the SACCO workspace cashbook. Deposits and withdrawals are booked through Teller → Receive money / Give money."}
          </p>
        </PageNotes>
      </div>

      <div className="flex flex-wrap gap-3 print:hidden items-center">
        <SaccoReportToolbar
          onPrint={() => window.print()}
          onPdf={() => {
            const today = new Date().toISOString().slice(0, 10);
            void downloadMemberSavingsPdf(members, today, today, user?.organization_id);
          }}
          printLabel="Print statement"
          pdfLabel="Download PDF"
        />
        <button
          type="button"
          onClick={() => navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "receive", tellerTask: "deposit" })}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Go to Teller (deposit)
        </button>
        <button
          type="button"
          onClick={() => navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "give", tellerTask: "withdraw" })}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Go to Teller (withdraw)
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm print:hidden">
        <label className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
          <input
            type="search"
            placeholder="Search member or account number…"
            value={memberSearch}
            onChange={(e) => {
              setMemberSearch(e.target.value);
              setMemberId("");
            }}
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[200px]"
          value={memberId}
          onChange={(e) => {
            setMemberId(e.target.value);
            setMemberSearch("");
          }}
        >
          <option value="">All members</option>
          {filteredMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.accountNumber})
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Filter description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm flex-1 min-w-[160px]"
        />
        <span className="text-sm text-slate-600 self-center">
          Latest rolling balance hint: <strong className="tabular-nums">{formatCurrency(lastBalance)}</strong>
        </span>
      </div>

      <div id="sacco-member-statement-print" className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        <div className="hidden border-b border-slate-200 p-4 print:block">
          <p className="text-xl font-bold text-slate-900">{orgHeader.name}</p>
          {orgHeader.address ? <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{orgHeader.address}</p> : null}
          <p className="mt-3 text-base font-bold text-slate-900">Member Statement</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <p><strong>Member:</strong> {selectedMember ? selectedMember.name : "All members"}</p>
            <p><strong>Account:</strong> {selectedMember?.accountNumber ?? "All"}</p>
            <p><strong>Rows:</strong> {rows.length}</p>
            <p><strong>Printed:</strong> {new Date().toLocaleString()}</p>
            <p><strong>Total debit:</strong> {formatCurrency(totalDebit)}</p>
            <p><strong>Total credit:</strong> {formatCurrency(totalCredit)}</p>
            <p><strong>Latest balance:</strong> {formatCurrency(lastBalance)}</p>
          </div>
        </div>
        <div className="statement-scroll overflow-x-auto">
          <table className="statement-table w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase border-b border-slate-100">
                {([["date","Date","col-date"],["member","Member","col-member"],["details","Details","col-details"],["debit","Debit","col-money"],["credit","Credit","col-money"],["balance","Balance","col-money"]] as const).map(([key,label,width]) => {
                  const numeric = ["debit","credit","balance"].includes(key);
                  return <th key={key} className={`${width} px-4 py-3 ${numeric ? "text-right" : ""}`}>
                    <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 hover:text-emerald-700 print:pointer-events-none ${numeric ? "ml-auto" : ""}`} title={`Sort by ${label}`}>
                      {label}<span className="print:hidden"><SortIcon column={key}/></span>
                    </button>
                  </th>;
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No cashbook lines loaded for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{e.date}</td>
                    <td className="px-4 py-2">{e.memberName ?? "—"}</td>
                    <td className="px-4 py-2 max-w-[320px]">
                      <span className="line-clamp-2">{e.description}</span>
                      {e.reference && (
                        <span className="block text-[11px] text-slate-400">Ref {e.reference}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.credit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(e.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SaccoSavingsStatementsPage;
