import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Eye, FileSpreadsheet, Landmark, MessageSquarePlus, Printer, RefreshCw, Settings2, Sparkles, Trash2, Unlink, Upload, Users, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import {
  autoMatchBankLines,
  mapStatementFileRows,
  parseStatementFile,
  suggestStatementColumnMapping,
  type LedgerBankLine,
  type StatementColumnMapping,
  type StatementFileRow,
  type StatementLine,
  type ReconciliationSourceType,
} from "../../lib/bankReconciliation";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";
import { filterGlAccountsForBusinessType } from "../../lib/glAccountBusinessScope";
import { nextReconciliationStatus, reconciliationProgress, RECONCILIATION_STATUS_LABELS, type CollaboratorRole, type ReconciliationStatus, type ReconciliationWorkMode } from "../../lib/collaborativeReconciliation";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

// Complex PostgREST embeds can make the generated Supabase type graph prohibitively expensive.
const reconciliationDb = supabase as any;

type BankAccount = { id: string; account_code: string; account_name: string; category?: string | null };
type MatchRow = { id: string; reconciliation_run_id: string; match_method: "auto" | "manual"; notes: string | null; matched_at: string };
type MatchItem = {
  match_id: string;
  side: "statement" | "ledger";
  statement_line_id: string | null;
  journal_entry_line_id: string | null;
  amount: number;
};
type HistoryColumn = "method" | "lines" | "notes" | "amount";
type LineColumn = "date" | "details" | "amount";
type SortDirection = "asc" | "desc";
type HistorySortKey = "reconciliation" | HistoryColumn;
type LineSortKey = LineColumn;
type SessionRow = { id: string; work_mode: ReconciliationWorkMode; status: ReconciliationStatus; period_start: string; period_end: string; cashbook_ready: boolean; statement_verified: boolean; version: number };
type MemberRow = { user_id: string; full_name: string; role: string };
type CollaboratorRow = { id: string; user_id: string; role: CollaboratorRole };
type ExceptionRow = { id: string; statement_line_id: string | null; journal_entry_line_id: string | null; title: string; status: "open" | "resolved" | "kept"; resolution: string | null };
type ActivityRow = { id: number; action: string; actor_id: string | null; created_at: string };

const money = new Intl.NumberFormat("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (amount: number) => `${amount >= 0 ? "+" : ""}${money.format(amount)}`;
const SOURCE_OPTIONS: Array<{ value: ReconciliationSourceType; label: string }> = [
  { value: "bank", label: "Bank statement" },
  { value: "cash_count", label: "Physical cash count" },
  { value: "till_float", label: "Till / cashier float" },
  { value: "vault", label: "Vault / safe count" },
  { value: "mobile_money", label: "Mobile money statement" },
  { value: "wallet", label: "Wallet statement" },
  { value: "other", label: "Other control balance" },
];

function schemaHelp(message: string): string {
  if (/bank_statement_lines|bank_reconciliation/i.test(message)) {
    return "Bank reconciliation tables are unavailable. Apply migration 20260614120000_bank_reconciliation.sql.";
  }
  return message;
}

export function BankReconciliationPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [statements, setStatements] = useState<StatementLine[]>([]);
  const [ledgerLines, setLedgerLines] = useState<LedgerBankLine[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [items, setItems] = useState<MatchItem[]>([]);
  const [selectedStatements, setSelectedStatements] = useState<string[]>([]);
  const [selectedLedger, setSelectedLedger] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<StatementFileRow[]>([]);
  const [importMapping, setImportMapping] = useState<StatementColumnMapping>({
    date: "",
    description: "",
    reference: "",
    amount: "",
    debit: "",
    credit: "",
  });
  const [sourceType, setSourceType] = useState<ReconciliationSourceType>("bank");
  const [sourceLabel, setSourceLabel] = useState("");
  const [bankClosingBalance, setBankClosingBalance] = useState("");
  const [cashbookClosingBalance, setCashbookClosingBalance] = useState("");
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10));
  const [countAmount, setCountAmount] = useState("");
  const [countDescription, setCountDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [historyColumns, setHistoryColumns] = useState<HistoryColumn[]>(["method", "lines", "notes", "amount"]);
  const [historySort, setHistorySort] = useState<{ key: HistorySortKey; direction: SortDirection }>({ key: "reconciliation", direction: "desc" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 8)}01`);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [workMode, setWorkMode] = useState<ReconciliationWorkMode>("individual");
  const [session, setSession] = useState<SessionRow | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<CollaboratorRole, string>>({ cashbook_owner: "", statement_owner: "", reviewer: "" });
  const [commentTarget, setCommentTarget] = useState<{ side: "statement" | "ledger"; id: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");

  const loadAccounts = useCallback(async () => {
    if (!orgId) {
      setAccounts([]);
      setAccountId("");
      return;
    }
    const { data, error } = await reconciliationDb
      .from("gl_accounts")
      .select("id,account_code,account_name,account_type,category,is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("account_code");
    if (error) throw error;
    const rows = filterGlAccountsForBusinessType(
      normalizeGlAccountRows((data || []) as unknown[]),
      user?.business_type
    )
      .filter((account) => {
        const text = `${account.account_name} ${account.category || ""}`.toLowerCase();
        return account.account_type === "asset" && (/bank|cash|mobile money|wallet/.test(text) || account.category === "cash");
      })
      .map((account) => ({
        id: account.id,
        account_code: account.account_code,
        account_name: account.account_name,
        category: account.category,
      }));
    setAccounts(rows);
    setAccountId((current) => current || rows[0]?.id || "");
  }, [orgId, user?.business_type]);

  const loadWorkspace = useCallback(async () => {
    if (!accountId || !orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const [statementRes, ledgerRes, matchRes] = await Promise.all([
        reconciliationDb
          .from("bank_statement_lines")
          .select("id,statement_date,description,reference,amount,source_type,source_label")
          .eq("organization_id", orgId)
          .eq("bank_gl_account_id", accountId)
          .order("statement_date", { ascending: false }),
        reconciliationDb
          .from("journal_entry_lines")
          .select(
            "id,debit,credit,line_description,journal_entries!inner(entry_date,description,transaction_id,organization_id,is_posted,is_deleted)"
          )
          .eq("gl_account_id", accountId)
          .eq("journal_entries.organization_id", orgId)
          .eq("journal_entries.is_posted", true)
          .eq("journal_entries.is_deleted", false),
        reconciliationDb
          .from("bank_reconciliation_matches")
          .select("id,reconciliation_run_id,match_method,notes,matched_at")
          .eq("organization_id", orgId)
          .eq("bank_gl_account_id", accountId)
          .order("matched_at", { ascending: false }),
      ]);
      if (statementRes.error) throw statementRes.error;
      if (ledgerRes.error) throw ledgerRes.error;
      if (matchRes.error) throw matchRes.error;

      const matchRows = (matchRes.data || []) as MatchRow[];
      const matchIds = matchRows.map((row) => row.id);
      const itemRes = matchIds.length
        ? await reconciliationDb
            .from("bank_reconciliation_match_items")
            .select("match_id,side,statement_line_id,journal_entry_line_id,amount")
            .in("match_id", matchIds)
        : { data: [], error: null };
      if (itemRes.error) throw itemRes.error;

      setStatements(
        ((statementRes.data || []) as Array<StatementLine & { amount: number | string }>).map((row) => ({
          ...row,
          amount: Number(row.amount),
        }))
      );
      setLedgerLines(
        (ledgerRes.data || []).map((row: {
          id: string;
          debit: number;
          credit: number;
          line_description: string | null;
          journal_entries: {
            entry_date: string;
            description: string;
            transaction_id: string | null;
          } | null;
        }) => ({
          id: row.id,
          entry_date: row.journal_entries?.entry_date || "",
          description: row.journal_entries?.description || "",
          transaction_id: row.journal_entries?.transaction_id || null,
          line_description: row.line_description,
          amount: Number(row.debit || 0) - Number(row.credit || 0),
        }))
      );
      setMatches(matchRows);
      setItems(
        ((itemRes.data || []) as Array<MatchItem & { amount: number | string }>).map((row) => ({
          ...row,
          amount: Number(row.amount),
        }))
      );
      setSelectedStatements([]);
      setSelectedLedger([]);
    } catch (error) {
      setMessage(schemaHelp(error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [accountId, orgId]);

  const loadCollaboration = useCallback(async () => {
    if (!orgId || !accountId) return;
    const [memberRes, sessionRes] = await Promise.all([
      reconciliationDb.from("organization_members").select("user_id,full_name,role").eq("organization_id", orgId).eq("is_active", true).order("full_name"),
      reconciliationDb.from("reconciliation_sessions").select("id,work_mode,status,period_start,period_end,cashbook_ready,statement_verified,version").eq("organization_id", orgId).eq("control_gl_account_id", accountId).eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle(),
    ]);
    if (memberRes.error) throw memberRes.error;
    setMembers((memberRes.data || []) as MemberRow[]);
    const active = (sessionRes.data || null) as SessionRow | null;
    setSession(active);
    if (!active) { setCollaborators([]); setExceptions([]); setActivity([]); return; }
    setWorkMode(active.work_mode);
    const [collabRes, exceptionRes, activityRes] = await Promise.all([
      reconciliationDb.from("reconciliation_collaborators").select("id,user_id,role").eq("session_id", active.id),
      reconciliationDb.from("reconciliation_exceptions").select("id,statement_line_id,journal_entry_line_id,title,status,resolution").eq("session_id", active.id).order("created_at", { ascending: false }),
      reconciliationDb.from("reconciliation_activity").select("id,action,actor_id,created_at").eq("session_id", active.id).order("created_at", { ascending: false }).limit(20),
    ]);
    if (collabRes.error) throw collabRes.error;
    if (exceptionRes.error) throw exceptionRes.error;
    setCollaborators((collabRes.data || []) as CollaboratorRow[]);
    setExceptions((exceptionRes.data || []) as ExceptionRow[]);
    setActivity((activityRes.data || []) as ActivityRow[]);
  }, [accountId, orgId, periodEnd, periodStart]);

  useEffect(() => {
    void loadAccounts().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [loadAccounts]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => { void loadCollaboration().catch((error) => setMessage(schemaHelp(error.message))); }, [loadCollaboration]);

  useEffect(() => {
    if (!session) return;
    const channel = reconciliationDb.channel(`reconciliation:${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_sessions", filter: `id=eq.${session.id}` }, () => void loadCollaboration())
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_exceptions", filter: `session_id=eq.${session.id}` }, () => void loadCollaboration())
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_comments", filter: `session_id=eq.${session.id}` }, () => void loadCollaboration())
      .subscribe();
    return () => { void reconciliationDb.removeChannel(channel); };
  }, [loadCollaboration, session?.id]);

  const matchedStatementIds = useMemo(
    () => new Set(items.flatMap((item) => (item.statement_line_id ? [item.statement_line_id] : []))),
    [items]
  );
  const matchedLedgerIds = useMemo(
    () => new Set(items.flatMap((item) => (item.journal_entry_line_id ? [item.journal_entry_line_id] : []))),
    [items]
  );
  const unmatchedStatements = statements.filter((row) => !matchedStatementIds.has(row.id));
  const unmatchedLedger = ledgerLines.filter((row) => !matchedLedgerIds.has(row.id));
  const statementTotal = unmatchedStatements
    .filter((row) => selectedStatements.includes(row.id))
    .reduce((sum, row) => sum + row.amount, 0);
  const ledgerTotal = unmatchedLedger
    .filter((row) => selectedLedger.includes(row.id))
    .reduce((sum, row) => sum + row.amount, 0);
  const difference = statementTotal - ledgerTotal;
  const depositsInTransit = unmatchedLedger.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const unpresentedPayments = Math.abs(unmatchedLedger.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0));
  const bankCreditsNotInCashbook = unmatchedStatements.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const bankChargesNotInCashbook = Math.abs(unmatchedStatements.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0));
  const adjustedBankBalance = Number(bankClosingBalance || 0) + depositsInTransit - unpresentedPayments;
  const adjustedCashbookBalance = Number(cashbookClosingBalance || 0) + bankCreditsNotInCashbook - bankChargesNotInCashbook;

  const saveMatch = async (
    statementIds: string[],
    ledgerIds: string[],
    method: "auto" | "manual",
    matchNotes?: string
  ) => {
    if (!orgId || !accountId) return;
    const selectedStatementRows = statements.filter((row) => statementIds.includes(row.id));
    const selectedLedgerRows = ledgerLines.filter((row) => ledgerIds.includes(row.id));
    const { data, error } = await reconciliationDb
      .from("bank_reconciliation_matches")
      .insert({
        organization_id: orgId,
        bank_gl_account_id: accountId,
        session_id: session?.id || null,
        match_method: method,
        notes: matchNotes || null,
        matched_by: user?.id || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const matchId = (data as { id: string }).id;
    const matchItems = [
      ...selectedStatementRows.map((row) => ({
        match_id: matchId,
        side: "statement",
        statement_line_id: row.id,
        journal_entry_line_id: null,
        amount: row.amount,
      })),
      ...selectedLedgerRows.map((row) => ({
        match_id: matchId,
        side: "ledger",
        statement_line_id: null,
        journal_entry_line_id: row.id,
        amount: row.amount,
      })),
    ];
    const itemInsert = await reconciliationDb.from("bank_reconciliation_match_items").insert(matchItems);
    if (itemInsert.error) {
      await reconciliationDb.from("bank_reconciliation_matches").delete().eq("id", matchId);
      throw itemInsert.error;
    }
  };

  const mappedImport = useMemo(() => mapStatementFileRows(importRows, importMapping), [importRows, importMapping]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseStatementFile(file);
      setImportFileName(file.name);
      setImportHeaders(parsed.headers);
      setImportRows(parsed.rows);
      setImportMapping(suggestStatementColumnMapping(parsed.headers));
      setMessage(parsed.rows.length ? null : "No data rows were found in the selected file.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the selected statement file.");
    }
  };

  const clearImport = () => {
    setImportFileName("");
    setImportHeaders([]);
    setImportRows([]);
    setImportMapping({ date: "", description: "", reference: "", amount: "", debit: "", credit: "" });
  };

  const handleImport = async () => {
    if (readOnly || !orgId || !accountId) return;
    if (!importMapping.date || (!importMapping.amount && (!importMapping.debit || !importMapping.credit))) {
      setMessage("Map the date column and either a signed amount column or both debit and credit columns.");
      return;
    }
    if (mappedImport.valid.length === 0) {
      setMessage("No valid statement rows remain after mapping.");
      return;
    }
    setSaving(true);
    const { error } = await reconciliationDb.from("bank_statement_lines").insert(
      mappedImport.valid.map((row) => ({
        ...row,
        organization_id: orgId,
        bank_gl_account_id: accountId,
        source_type: sourceType,
        source_label: sourceLabel.trim() || null,
        imported_by: user?.id || null,
        reconciliation_session_id: session?.id || null,
      }))
    );
    setSaving(false);
    if (error) setMessage(schemaHelp(error.message));
    else {
      clearImport();
      setMessage(`${mappedImport.valid.length} statement line(s) imported.`);
      await loadWorkspace();
    }
  };

  const handleAddControlBalance = async () => {
    if (readOnly || !orgId || !accountId) return;
    const amount = Number(countAmount);
    if (!countDate || !Number.isFinite(amount) || Math.abs(amount) < 0.005) {
      setMessage("Enter a valid date and non-zero counted/control balance.");
      return;
    }
    setSaving(true);
    const { error } = await reconciliationDb.from("bank_statement_lines").insert({
      organization_id: orgId,
      bank_gl_account_id: accountId,
      statement_date: countDate,
      description: countDescription.trim() || SOURCE_OPTIONS.find((option) => option.value === sourceType)?.label || "Control balance",
      reference: null,
      amount,
      source_type: sourceType,
      source_label: sourceLabel.trim() || null,
      imported_by: user?.id || null,
      reconciliation_session_id: session?.id || null,
    });
    setSaving(false);
    if (error) setMessage(schemaHelp(error.message));
    else {
      setCountAmount("");
      setCountDescription("");
      setMessage("Control balance added.");
      await loadWorkspace();
    }
  };

  const handleAutoMatch = async () => {
    if (readOnly) return;
    const pairs = autoMatchBankLines(unmatchedStatements, unmatchedLedger);
    if (pairs.length === 0) {
      setMessage("No exact-amount matches were found within three days.");
      return;
    }
    setSaving(true);
    try {
      await saveMatch(
        pairs.map((pair) => pair.statementId),
        pairs.map((pair) => pair.ledgerId),
        "auto",
        `Automatic reconciliation of ${pairs.length} transaction pair(s)`
      );
      setMessage(`${pairs.length} transaction pair(s) reconciled automatically.`);
      await loadWorkspace();
    } catch (error) {
      setMessage(schemaHelp(error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const handleManualMatch = async () => {
    if (readOnly || selectedStatements.length === 0 || selectedLedger.length === 0) return;
    if (Math.abs(difference) >= 0.005) {
      setMessage(`Selected totals must agree. Difference: ${signed(difference)}.`);
      return;
    }
    setSaving(true);
    try {
      await saveMatch(selectedStatements, selectedLedger, "manual", notes.trim());
      setNotes("");
      setMessage("Manual reconciliation saved.");
      await loadWorkspace();
    } catch (error) {
      setMessage(schemaHelp(error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const removeRun = async (runId: string) => {
    if (readOnly || !confirm("Undo this reconciliation? Its control and ledger lines will become unmatched.")) return;
    const { error } = await reconciliationDb.from("bank_reconciliation_matches").delete().eq("reconciliation_run_id", runId);
    if (error) setMessage(error.message);
    else await loadWorkspace();
  };

  const deleteStatement = async (id: string) => {
    if (readOnly || !confirm("Delete this imported statement line?")) return;
    const { error } = await reconciliationDb.from("bank_statement_lines").delete().eq("id", id);
    if (error) setMessage(error.message);
    else await loadWorkspace();
  };

  const matchedTotal = items.filter((item) => item.side === "statement").reduce((sum, item) => sum + item.amount, 0);
  const openExceptions = exceptions.filter((row) => row.status === "open");
  const progress = reconciliationProgress({ totalLines: statements.length + ledgerLines.length, matchedLines: items.length, openExceptions: openExceptions.length });
  const myRoles = new Set(collaborators.filter((row) => row.user_id === user?.id).map((row) => row.role));
  const canCashbook = workMode === "individual" || myRoles.has("cashbook_owner") || user?.role === "admin" || user?.role === "super_admin";
  const canStatement = workMode === "individual" || myRoles.has("statement_owner") || user?.role === "admin" || user?.role === "super_admin";
  const canReview = workMode === "individual" || myRoles.has("reviewer") || user?.role === "admin" || user?.role === "super_admin";

  const createSession = async () => {
    if (!orgId || !accountId || readOnly) return;
    setSaving(true);
    const { data, error } = await reconciliationDb.from("reconciliation_sessions").insert({ organization_id: orgId, control_gl_account_id: accountId, source_type: sourceType, source_label: sourceLabel.trim() || null, period_start: periodStart, period_end: periodEnd, work_mode: workMode, created_by: user?.id || null }).select("id,work_mode,status,period_start,period_end,cashbook_ready,statement_verified,version").single();
    setSaving(false);
    if (error) setMessage(schemaHelp(error.message));
    else { setSession(data as SessionRow); setMessage(`${workMode === "collaborative" ? "Collaborative" : "Individual"} reconciliation started.`); await loadCollaboration(); }
  };

  const saveCollaborators = async () => {
    if (!session || !orgId || readOnly) return;
    const rows = (Object.entries(roleDrafts) as Array<[CollaboratorRole, string]>).filter(([, id]) => id).map(([role, userId]) => ({ session_id: session.id, organization_id: orgId, user_id: userId, role, created_by: user?.id || null }));
    setSaving(true);
    const removed = await reconciliationDb.from("reconciliation_collaborators").delete().eq("session_id", session.id);
    const inserted = !removed.error && rows.length ? await reconciliationDb.from("reconciliation_collaborators").insert(rows) : { error: null };
    setSaving(false);
    const error = removed.error || inserted.error;
    if (error) setMessage(error.message); else { setMessage("Collaborators updated."); await loadCollaboration(); }
  };

  const saveSessionState = async (patch: { cashbookReady?: boolean; statementVerified?: boolean; approve?: boolean }) => {
    if (!session || readOnly) return;
    const cashbookReady = patch.cashbookReady ?? session.cashbook_ready;
    const statementVerified = patch.statementVerified ?? session.statement_verified;
    const status = patch.approve ? "approved" : nextReconciliationStatus(cashbookReady, statementVerified, openExceptions.length);
    if (patch.approve && (!cashbookReady || !statementVerified || openExceptions.length)) { setMessage("Both owners must confirm their sections and resolve every exception before approval."); return; }
    setSaving(true);
    const { error } = await reconciliationDb.rpc("save_reconciliation_session_state", { p_session_id: session.id, p_expected_version: session.version, p_cashbook_ready: cashbookReady, p_statement_verified: statementVerified, p_status: status });
    setSaving(false);
    if (error) setMessage(error.message); else { setMessage(patch.approve ? "Reconciliation approved and closed." : "Section confirmation saved."); await loadCollaboration(); }
  };

  const askTeammate = async () => {
    if (!session || !orgId || !commentTarget || !commentBody.trim() || readOnly) return;
    const line = commentTarget.side === "statement" ? statements.find((row) => row.id === commentTarget.id) : ledgerLines.find((row) => row.id === commentTarget.id);
    const exceptionInsert = await reconciliationDb.from("reconciliation_exceptions").insert({ session_id: session.id, organization_id: orgId, statement_line_id: commentTarget.side === "statement" ? commentTarget.id : null, journal_entry_line_id: commentTarget.side === "ledger" ? commentTarget.id : null, title: commentBody.trim(), created_by: user?.id || null }).select("id").single();
    if (exceptionInsert.error) { setMessage(exceptionInsert.error.message); return; }
    const { error } = await reconciliationDb.from("reconciliation_comments").insert({ session_id: session.id, organization_id: orgId, exception_id: exceptionInsert.data.id, statement_line_id: commentTarget.side === "statement" ? commentTarget.id : null, journal_entry_line_id: commentTarget.side === "ledger" ? commentTarget.id : null, body: commentBody.trim(), created_by: user?.id || null });
    if (error) setMessage(error.message); else { setMessage(`Exception raised against ${line?.description || "transaction"}.`); setCommentTarget(null); setCommentBody(""); await loadCollaboration(); }
  };

  const resolveException = async (id: string, status: "resolved" | "kept") => {
    const { error } = await reconciliationDb.from("reconciliation_exceptions").update({ status, resolution: status === "kept" ? "Kept as an explained outstanding item" : "Resolved", resolved_by: user?.id || null, resolved_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    if (error) setMessage(error.message); else await loadCollaboration();
  };
  const reconciliationRuns = useMemo(() => {
    const grouped = new Map<string, MatchRow[]>();
    matches.forEach((match) => {
      const rows = grouped.get(match.reconciliation_run_id) || [];
      rows.push(match);
      grouped.set(match.reconciliation_run_id, rows);
    });
    return Array.from(grouped.entries()).map(([id, runMatches]) => ({
      id,
      matches: runMatches,
      latest: runMatches.reduce((latest, match) => match.matched_at > latest.matched_at ? match : latest),
    }));
  }, [matches]);
  const selectedRun = reconciliationRuns.find((run) => run.id === selectedRunId) || null;
  const selectedRunMatchIds = new Set(selectedRun?.matches.map((match) => match.id) || []);
  const selectedMatchItems = selectedRun ? items.filter((item) => selectedRunMatchIds.has(item.match_id)) : [];
  const selectedMatchStatements = selectedMatchItems
    .filter((item) => item.statement_line_id)
    .map((item) => ({
      item,
      line: statements.find((statement) => statement.id === item.statement_line_id),
    }));
  const selectedMatchLedger = selectedMatchItems
    .filter((item) => item.journal_entry_line_id)
    .map((item) => ({
      item,
      line: ledgerLines.find((ledger) => ledger.id === item.journal_entry_line_id),
    }));
  const historyRows = useMemo(() => reconciliationRuns.map((run) => {
    const runMatchIds = new Set(run.matches.map((match) => match.id));
    const groupItems = items.filter((item) => runMatchIds.has(item.match_id));
    const controlItems = groupItems.filter((item) => item.side === "statement");
    const ledgerItems = groupItems.filter((item) => item.side === "ledger");
    return {
      run,
      controlCount: controlItems.length,
      ledgerCount: ledgerItems.length,
      lineCount: controlItems.length + ledgerItems.length,
      total: controlItems.reduce((sum, item) => sum + item.amount, 0),
      method: run.matches.some((match) => match.match_method === "manual") ? "manual" : "auto",
    };
  }).sort((left, right) => {
    const values: Record<HistorySortKey, [string | number, string | number]> = {
      reconciliation: [left.run.latest.matched_at, right.run.latest.matched_at],
      method: [left.method, right.method],
      lines: [left.lineCount, right.lineCount],
      notes: [left.run.latest.notes || "", right.run.latest.notes || ""],
      amount: [left.total, right.total],
    };
    return compareSortValues(values[historySort.key][0], values[historySort.key][1], historySort.direction);
  }), [historySort, items, reconciliationRuns]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-7 w-7 text-brand-700" />
            <h1 className="text-3xl font-bold text-slate-900">Cash & float reconciliation</h1>
            <PageNotes ariaLabel="Cash and float reconciliation help">
              <p>Compare bank, cash-count, till-float, vault, mobile-money, and wallet control lines against posted BOAT ledger activity.</p>
              <p>Control-side amounts use signed values: receipts/balances are positive and payments/withdrawals are negative.</p>
            </PageNotes>
          </div>
          <p className="mt-1 text-sm text-slate-500">Unified two-way reconciliation with automatic and manual matching.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadWorkspace()} className="app-btn-secondary">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={() => void handleAutoMatch()} disabled={readOnly || saving} className="app-btn-primary">
            <Sparkles className="h-4 w-4" /> Auto reconcile
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <label className="md:col-span-2 text-sm font-medium text-slate-700">
          Reconciliation GL account
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.account_code} - {account.account_name}</option>
            ))}
          </select>
        </label>
        <Metric label="Unmatched control side" value={signed(unmatchedStatements.reduce((sum, row) => sum + row.amount, 0))} />
        <Metric label="Reconciled control total" value={signed(matchedTotal)} />
      </div>

      <section className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><Users className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Shared reconciliation workspace</h2></div><p className="mt-1 text-xs text-slate-600">One account and period, shared live. Individual mode keeps the usual simple workflow.</p></div>
          {session && <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-800 shadow-sm">{RECONCILIATION_STATUS_LABELS[session.status]}</span>}
        </div>
        {!session ? (
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <label className="text-xs font-medium text-slate-600">Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-medium text-slate-600">Period end<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-medium text-slate-600 md:col-span-2">Work mode<select value={workMode} onChange={(event) => setWorkMode(event.target.value as ReconciliationWorkMode)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="individual">Individual mode</option><option value="collaborative">Collaborative mode</option></select></label>
            <button type="button" onClick={() => void createSession()} disabled={readOnly || saving || !periodStart || !periodEnd} className="app-btn-primary self-end">Start workspace</button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-5">
              <WorkspaceStatus label="Cashbook" done={session.cashbook_ready} />
              <WorkspaceStatus label="Statement" done={session.statement_verified} />
              <WorkspaceStatus label="Matched" value={`${progress.percentage}%`} />
              <WorkspaceStatus label="Exceptions" value={String(progress.exceptionCount)} alert={progress.exceptionCount > 0} />
              <WorkspaceStatus label="Approval" value={session.status === "approved" ? "Closed" : "Pending"} />
            </div>
            {session.work_mode === "collaborative" && (
              <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Responsibilities</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {([['cashbook_owner','Cashbook owner'],['statement_owner','Statement owner'],['reviewer','Reviewer / approver']] as Array<[CollaboratorRole,string]>).map(([role,label]) => <label key={role} className="text-xs font-medium text-slate-600">{label}<select value={roleDrafts[role] || collaborators.find((row) => row.role === role)?.user_id || ""} onChange={(event) => setRoleDrafts((current) => ({ ...current, [role]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} ({member.role})</option>)}</select></label>)}
                </div>
                <button type="button" onClick={() => void saveCollaborators()} disabled={readOnly || saving} className="app-btn-secondary mt-3">Save responsibilities</button>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!canCashbook || session.cashbook_ready || saving} onClick={() => void saveSessionState({ cashbookReady: true })} className="app-btn-secondary"><CheckCircle2 className="h-4 w-4" /> Mark cashbook ready</button>
              <button type="button" disabled={!canStatement || session.statement_verified || saving} onClick={() => void saveSessionState({ statementVerified: true })} className="app-btn-secondary"><CheckCircle2 className="h-4 w-4" /> Mark statement verified</button>
              <button type="button" disabled={!canReview || session.status === "approved" || saving} onClick={() => void saveSessionState({ approve: true })} className="app-btn-primary">Approve and close</button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">Standard bank reconciliation statement</h2><p className="text-xs text-slate-500">Enter the statement and cashbook closing balances; unmatched lines supply the reconciling items.</p></div>
          <button type="button" onClick={() => window.print()} className="app-btn-secondary print:hidden"><Printer className="h-4 w-4" /> Print statement</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 print:hidden">
          <label className="text-xs font-medium text-slate-600">Balance as per bank statement<input type="number" value={bankClosingBalance} onChange={(e) => setBankClosingBalance(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs font-medium text-slate-600">Balance as per cashbook<input type="number" value={cashbookClosingBalance} onChange={(e) => setCashbookClosingBalance(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        </div>
        <table className="mt-4 w-full text-sm"><tbody className="divide-y divide-slate-100">
          <StatementRow label="Balance as per bank statement" amount={Number(bankClosingBalance || 0)} strong />
          <StatementRow label="Add: deposits in transit" amount={depositsInTransit} />
          <StatementRow label="Less: unpresented payments" amount={-unpresentedPayments} />
          <StatementRow label="Adjusted bank balance" amount={adjustedBankBalance} strong />
          <StatementRow label="Balance as per cashbook" amount={Number(cashbookClosingBalance || 0)} strong />
          <StatementRow label="Add: bank credits not recorded in cashbook" amount={bankCreditsNotInCashbook} />
          <StatementRow label="Less: bank charges/debits not recorded in cashbook" amount={-bankChargesNotInCashbook} />
          <StatementRow label="Adjusted cashbook balance" amount={adjustedCashbookBalance} strong />
          <StatementRow label="Unreconciled difference" amount={adjustedBankBalance - adjustedCashbookBalance} strong alert={Math.abs(adjustedBankBalance - adjustedCashbookBalance) >= 0.005} />
        </tbody></table>
      </section>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Import bank statement</h2>
            <p className="text-xs text-slate-500">Upload bank, mobile-money, or wallet CSV/Excel, then map columns before importing.</p>
          </div>
          <button type="button" onClick={() => void handleImport()} disabled={readOnly || saving || mappedImport.valid.length === 0} className="app-btn-primary">
            <Upload className="h-4 w-4" /> Import lines
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">Control source type
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as ReconciliationSourceType)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Source label / location
            <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="e.g. Main bank, Till 2, Front desk safe" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <FileSpreadsheet className="h-4 w-4" /> Choose CSV or Excel
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              disabled={readOnly}
              onChange={(event) => void handleFile(event.target.files?.[0] || null)}
            />
          </label>
          {importFileName && (
            <span className="ml-3 inline-flex items-center gap-2 text-sm text-slate-600">
              {importFileName} · {importRows.length} row(s)
              <button type="button" onClick={clearImport} className="text-slate-400 hover:text-rose-700"><X className="h-4 w-4" /></button>
            </span>
          )}
        </div>

        {importHeaders.length > 0 && (
          <>
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-800">Match statement columns</h3>
              <p className="text-xs text-slate-500">Choose signed Amount, or leave it blank and choose separate Debit and Credit columns.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ColumnMap label="Date *" value={importMapping.date} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, date: value }))} />
                <ColumnMap label="Description" value={importMapping.description} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, description: value }))} />
                <ColumnMap label="Reference" value={importMapping.reference} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, reference: value }))} />
                <ColumnMap label="Signed amount" value={importMapping.amount} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, amount: value }))} />
                <ColumnMap label="Debit / withdrawal" value={importMapping.debit} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, debit: value }))} />
                <ColumnMap label="Credit / deposit" value={importMapping.credit} headers={importHeaders} onChange={(value) => setImportMapping((current) => ({ ...current, credit: value }))} />
              </div>
            </div>

            <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
              <div className="flex justify-between bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>Import preview</span>
                <span>{mappedImport.valid.length} valid · {mappedImport.invalidCount} skipped</span>
              </div>
              <table className="w-full text-sm">
                <thead><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Description</th><th className="p-2 text-left">Reference</th><th className="p-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {mappedImport.valid.slice(0, 8).map((row, index) => (
                    <tr key={`${row.statement_date}-${index}`} className="border-t">
                      <td className="p-2">{row.statement_date}</td>
                      <td className="p-2">{row.description}</td>
                      <td className="p-2">{row.reference || "—"}</td>
                      <td className="p-2 text-right font-medium tabular-nums">{signed(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mappedImport.valid.length === 0 && <p className="p-4 text-center text-sm text-slate-500">Map columns to preview valid rows.</p>}
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="font-semibold text-slate-900">Record cash, float, or control balance</h2>
          <p className="text-xs text-slate-500">Capture a physical cash count, till float, vault count, or channel balance without uploading a file.</p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input type="date" value={countDate} onChange={(event) => setCountDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="number" value={countAmount} onChange={(event) => setCountAmount(event.target.value)} placeholder="Counted / control amount" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={countDescription} onChange={(event) => setCountDescription(event.target.value)} placeholder="Count notes or shift reference" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="button" onClick={() => void handleAddControlBalance()} disabled={readOnly || saving} className="app-btn-primary">Add control balance</button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SideTable
          title="Control side"
          subtitle={`${unmatchedStatements.length} unmatched line(s)`}
          rows={unmatchedStatements.map((row) => ({
            id: row.id,
            date: row.statement_date,
            primary: row.description,
            secondary: `${SOURCE_OPTIONS.find((option) => option.value === row.source_type)?.label || "Control"}${row.source_label ? ` · ${row.source_label}` : ""}${row.reference ? ` · ${row.reference}` : ""}`,
            amount: row.amount,
          }))}
          selected={selectedStatements}
          setSelected={setSelectedStatements}
          onDelete={deleteStatement}
          onAsk={session ? (id) => setCommentTarget({ side: "statement", id }) : undefined}
          readOnly={readOnly}
        />
        <SideTable
          title="BOAT ledger"
          subtitle={`${unmatchedLedger.length} unmatched posted line(s)`}
          rows={unmatchedLedger.map((row) => ({
            id: row.id,
            date: row.entry_date,
            primary: row.description,
            secondary: row.transaction_id || row.line_description || "No reference",
            amount: row.amount,
          }))}
          selected={selectedLedger}
          setSelected={setSelectedLedger}
          onAsk={session ? (id) => setCommentTarget({ side: "ledger", id }) : undefined}
          readOnly={readOnly}
        />
      </div>

      {session && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">Exceptions and questions</h2><p className="text-xs text-slate-500">Collaborators investigate these without changing accounting records silently.</p></div><span className="text-sm font-semibold text-amber-700">{openExceptions.length} open</span></div><div className="mt-3 space-y-2">{exceptions.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><p className="text-sm font-medium text-slate-900">{row.title}</p><p className="text-xs capitalize text-slate-500">{row.status}{row.resolution ? ` · ${row.resolution}` : ""}</p></div>{row.status === "open" && <div className="flex gap-2"><button type="button" onClick={() => void resolveException(row.id, "kept")} className="app-btn-secondary text-xs">Keep as exception</button><button type="button" onClick={() => void resolveException(row.id, "resolved")} className="app-btn-primary text-xs">Resolve</button></div>}</div>)}{exceptions.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">No exceptions raised.</p>}</div></section>
          <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Recent activity</h2><div className="mt-3 space-y-3">{activity.map((row) => <div key={row.id} className="border-l-2 border-indigo-200 pl-3"><p className="text-sm text-slate-700">{row.action.replaceAll("_", " ")}</p><p className="text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</p></div>)}{activity.length === 0 && <p className="text-sm text-slate-500">Activity appears here as the team works.</p>}</div></section>
        </div>
      )}

      <div className="sticky bottom-3 rounded-xl border border-brand-200 bg-white p-4 shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid grid-cols-3 gap-5 text-sm">
            <Metric label="Selected control" value={signed(statementTotal)} compact />
            <Metric label="Selected ledger" value={signed(ledgerTotal)} compact />
            <Metric label="Difference" value={signed(difference)} compact alert={Math.abs(difference) >= 0.005} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Match notes (optional)" className="border rounded-lg px-3 py-2 text-sm" />
            <button
              type="button"
              onClick={() => void handleManualMatch()}
              disabled={readOnly || saving || selectedStatements.length === 0 || selectedLedger.length === 0 || Math.abs(difference) >= 0.005}
              className="app-btn-primary"
            >
              Reconcile selected
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div><h2 className="font-semibold text-slate-900">Unified reconciliation history</h2><p className="text-xs text-slate-500">{reconciliationRuns.length} reconciliation(s)</p></div>
          <ColumnToggle
            columns={[
              { key: "method", label: "Method" },
              { key: "lines", label: "Matched lines" },
              { key: "notes", label: "Notes" },
              { key: "amount", label: "Amount" },
            ]}
            visible={historyColumns}
            setVisible={setHistoryColumns}
          />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><SortableHeader label="Reconciliation" sortKey="reconciliation" sort={historySort} setSort={setHistorySort} />{historyColumns.includes("method") && <SortableHeader label="Method" sortKey="method" sort={historySort} setSort={setHistorySort} />}{historyColumns.includes("lines") && <SortableHeader label="Matched lines" sortKey="lines" sort={historySort} setSort={setHistorySort} />}{historyColumns.includes("notes") && <SortableHeader label="Notes" sortKey="notes" sort={historySort} setSort={setHistorySort} />}{historyColumns.includes("amount") && <SortableHeader label="Amount" sortKey="amount" sort={historySort} setSort={setHistorySort} align="right" />}<th className="p-3" /></tr></thead>
          <tbody>
            {historyRows.map(({ run, controlCount, ledgerCount, total, method }) => {
              return (
                <tr key={run.id} onClick={() => setSelectedRunId(run.id)} className="cursor-pointer border-t hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-900">{new Date(run.latest.matched_at).toLocaleString()}</td>
                  {historyColumns.includes("method") && <td className="p-3 capitalize">{method}</td>}
                  {historyColumns.includes("lines") && <td className="p-3">{controlCount} control / {ledgerCount} ledger</td>}
                  {historyColumns.includes("notes") && <td className="max-w-md truncate p-3 text-slate-600">{run.latest.notes || "No notes"}</td>}
                  {historyColumns.includes("amount") && <td className="p-3 text-right font-semibold tabular-nums">{signed(total)}</td>}
                  <td className="p-3 text-right"><Eye className="inline h-4 w-4 text-slate-500" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && reconciliationRuns.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No reconciliations saved yet.</p>}
      </div>

      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setSelectedRunId(null)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Reconciliation details</h2>
                <p className="text-sm text-slate-500">{new Date(selectedRun.latest.matched_at).toLocaleString()} · <span className="capitalize">{selectedRun.matches.some((match) => match.match_method === "manual") ? "manual" : "auto"}</span></p>
                {selectedRun.latest.notes && <p className="mt-1 text-sm text-slate-700">{selectedRun.latest.notes}</p>}
              </div>
              <button type="button" onClick={() => setSelectedRunId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close reconciliation details"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 p-5 xl:grid-cols-2">
              <ReconciliationDetailTable
                title="Control side"
                rows={selectedMatchStatements.map(({ item, line }) => ({
                  id: item.statement_line_id || `${selectedRun.id}-control`,
                  date: line?.statement_date || "",
                  primary: line?.description || "Control line",
                  secondary: line ? `${SOURCE_OPTIONS.find((option) => option.value === line.source_type)?.label || "Control"}${line.source_label ? ` · ${line.source_label}` : ""}${line.reference ? ` · ${line.reference}` : ""}` : "Source line unavailable",
                  amount: item.amount,
                }))}
              />
              <ReconciliationDetailTable
                title="BOAT ledger"
                rows={selectedMatchLedger.map(({ item, line }) => ({
                  id: item.journal_entry_line_id || `${selectedRun.id}-ledger`,
                  date: line?.entry_date || "",
                  primary: line?.description || "Ledger line",
                  secondary: line?.transaction_id || line?.line_description || "No reference",
                  amount: item.amount,
                }))}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setSelectedRunId(null)} className="app-btn-secondary">Close</button>
              <button type="button" onClick={() => { setSelectedRunId(null); void removeRun(selectedRun.id); }} disabled={readOnly} className="app-btn-secondary text-rose-700 disabled:opacity-40">
                <Unlink className="h-4 w-4" /> Undo reconciliation
              </button>
            </div>
          </div>
        </div>
      )}
      {commentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setCommentTarget(null)}><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><h2 className="font-semibold text-slate-900">Ask teammate</h2><p className="mt-1 text-sm text-slate-500">Raise a transaction-level exception and leave the first comment.</p><textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={4} placeholder="What needs investigation?" className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCommentTarget(null)} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void askTeammate()} disabled={!commentBody.trim()} className="app-btn-primary">Ask teammate</button></div></div></div>
      )}
    </div>
  );
}

function Metric({ label, value, compact = false, alert = false }: { label: string; value: string; compact?: boolean; alert?: boolean }) {
  return <div className={compact ? "" : "rounded-xl border border-slate-200 bg-white p-4"}><p className="text-xs text-slate-500">{label}</p><p className={`${compact ? "text-base" : "text-xl"} font-bold tabular-nums ${alert ? "text-rose-700" : "text-slate-900"}`}>{value}</p></div>;
}

function WorkspaceStatus({ label, done, value, alert = false }: { label: string; done?: boolean; value?: string; alert?: boolean }) {
  return <div className="rounded-lg border border-indigo-100 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 font-semibold ${alert ? "text-amber-700" : done ? "text-emerald-700" : "text-slate-900"}`}>{value || (done ? "Ready ✓" : "Pending")}</p></div>;
}

function StatementRow({ label, amount, strong = false, alert = false }: { label: string; amount: number; strong?: boolean; alert?: boolean }) {
  return <tr className={strong ? "bg-slate-50" : ""}><td className={`px-3 py-2 ${strong ? "font-semibold" : ""}`}>{label}</td><td className={`px-3 py-2 text-right tabular-nums ${strong ? "font-bold" : ""} ${alert ? "text-rose-700" : ""}`}>{signed(amount)}</td></tr>;
}

function ColumnMap({
  label,
  value,
  headers,
  onChange,
}: {
  label: string;
  value: string;
  headers: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
        <option value="">Not mapped</option>
        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select>
    </label>
  );
}

function SideTable({
  title,
  subtitle,
  rows,
  selected,
  setSelected,
  onDelete,
  onAsk,
  readOnly,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ id: string; date: string; primary: string; secondary: string; amount: number }>;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onDelete?: (id: string) => void;
  onAsk?: (id: string) => void;
  readOnly: boolean;
}) {
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const [visibleColumns, setVisibleColumns] = useState<LineColumn[]>(["date", "details", "amount"]);
  const [sort, setSort] = useState<{ key: LineSortKey; direction: SortDirection }>({ key: "date", direction: "desc" });
  const sortedRows = useMemo(() => [...rows].sort((left, right) => compareSortValues(
    sort.key === "amount" ? left.amount : sort.key === "date" ? left.date : `${left.primary} ${left.secondary}`,
    sort.key === "amount" ? right.amount : sort.key === "date" ? right.date : `${right.primary} ${right.secondary}`,
    sort.direction
  )), [rows, sort]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 className="font-semibold text-slate-900">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div><ColumnToggle columns={[{ key: "date", label: "Date" }, { key: "details", label: "Details" }, { key: "amount", label: "Amount" }]} visible={visibleColumns} setVisible={setVisibleColumns} /></div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50"><tr><th className="p-3 text-left w-10" />{visibleColumns.includes("date") && <SortableHeader label="Date" sortKey="date" sort={sort} setSort={setSort} />}{visibleColumns.includes("details") && <SortableHeader label="Details" sortKey="details" sort={sort} setSort={setSort} />}{visibleColumns.includes("amount") && <SortableHeader label="Amount" sortKey="amount" sort={sort} setSort={setSort} align="right" />}<th className="p-3 w-10" /></tr></thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className={`border-t ${selected.includes(row.id) ? "bg-blue-50" : ""}`}>
                <td className="p-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></td>
                {visibleColumns.includes("date") && <td className="whitespace-nowrap p-3">{row.date}</td>}
                {visibleColumns.includes("details") && <td className="p-3"><p>{row.primary}</p><p className="text-xs text-slate-500">{row.secondary}</p></td>}
                {visibleColumns.includes("amount") && <td className={`p-3 text-right font-semibold tabular-nums ${row.amount < 0 ? "text-rose-700" : "text-emerald-700"}`}>{signed(row.amount)}</td>}
                <td className="p-3"><div className="flex gap-2">{onAsk && <button type="button" title="Ask teammate" onClick={() => onAsk(row.id)} disabled={readOnly} className="text-slate-400 hover:text-indigo-700 disabled:opacity-30"><MessageSquarePlus className="h-4 w-4" /></button>}{onDelete && <button type="button" title="Delete imported line" onClick={() => onDelete(row.id)} disabled={readOnly} className="text-slate-400 hover:text-rose-700 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No unmatched lines.</p>}
      </div>
    </div>
  );
}

function ReconciliationDetailTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; date: string; primary: string; secondary: string; amount: number }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const [visibleColumns, setVisibleColumns] = useState<LineColumn[]>(["date", "details", "amount"]);
  const [sort, setSort] = useState<{ key: LineSortKey; direction: SortDirection }>({ key: "date", direction: "desc" });
  const sortedRows = useMemo(() => [...rows].sort((left, right) => compareSortValues(
    sort.key === "amount" ? left.amount : sort.key === "date" ? left.date : `${left.primary} ${left.secondary}`,
    sort.key === "amount" ? right.amount : sort.key === "date" ? right.date : `${right.primary} ${right.secondary}`,
    sort.direction
  )), [rows, sort]);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div><h3 className="font-semibold text-slate-900">{title}</h3><p className="text-xs text-slate-500">{rows.length} matched line(s)</p></div>
        <div className="flex items-center gap-3"><p className="font-semibold tabular-nums text-slate-900">{signed(total)}</p><ColumnToggle columns={[{ key: "date", label: "Date" }, { key: "details", label: "Details" }, { key: "amount", label: "Amount" }]} visible={visibleColumns} setVisible={setVisibleColumns} /></div>
      </div>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white"><tr>{visibleColumns.includes("date") && <SortableHeader label="Date" sortKey="date" sort={sort} setSort={setSort} />}{visibleColumns.includes("details") && <SortableHeader label="Details" sortKey="details" sort={sort} setSort={setSort} />}{visibleColumns.includes("amount") && <SortableHeader label="Amount" sortKey="amount" sort={sort} setSort={setSort} align="right" />}</tr></thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className="border-t">
                {visibleColumns.includes("date") && <td className="whitespace-nowrap p-3">{row.date}</td>}
                {visibleColumns.includes("details") && <td className="p-3"><p>{row.primary}</p><p className="text-xs text-slate-500">{row.secondary}</p></td>}
                {visibleColumns.includes("amount") && <td className={`p-3 text-right font-semibold tabular-nums ${row.amount < 0 ? "text-rose-700" : "text-emerald-700"}`}>{signed(row.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No lines found.</p>}
      </div>
    </div>
  );
}

function ColumnToggle<T extends string>({
  columns,
  visible,
  setVisible,
}: {
  columns: Array<{ key: T; label: string }>;
  visible: T[];
  setVisible: (columns: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
        <Settings2 className="h-4 w-4" /> Columns
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {columns.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={visible.includes(column.key)}
                onChange={(event) => setVisible(event.target.checked ? [...visible, column.key] : visible.filter((key) => key !== column.key))}
              />
              {column.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableHeader<T extends string>({
  label,
  sortKey,
  sort,
  setSort,
  align = "left",
}: {
  label: string;
  sortKey: T;
  sort: { key: T; direction: SortDirection };
  setSort: (sort: { key: T; direction: SortDirection }) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`p-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort({ key: sortKey, direction: active && sort.direction === "asc" ? "desc" : "asc" })}
        className={`inline-flex items-center gap-1 font-semibold hover:text-brand-700 ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}<Icon className={`h-3.5 w-3.5 ${active ? "text-brand-700" : "text-slate-400"}`} />
      </button>
    </th>
  );
}

function compareSortValues(left: string | number, right: string | number, direction: SortDirection): number {
  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}
