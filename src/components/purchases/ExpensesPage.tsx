import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  createJournalForExpenseWithLines,
  deleteJournalEntryByReference,
  type ExpenseJournalLineInput,
} from "../../lib/journal";
import { useAuth } from "../../contexts/AuthContext";
import { GlAccountPicker } from "../common/GlAccountPicker";
import { SourceDocumentsCell } from "../common/SourceDocumentsCell";
import { SearchableCombobox } from "../common/SearchableCombobox";
import { buildStoragePath, uploadSourceDocument, type SourceDocumentRef } from "../../lib/sourceDocuments";
import { loadJournalAccountSettings, resolveJournalAccountSettings } from "../../lib/journalAccountSettings";
import { randomUuid } from "../../lib/randomUuid";
import { loadHotelConfig } from "../../lib/hotelConfig";

const SIMPLE_EXPENSE_MODE_KEY = "boat.expenses.simple_mode";

/** Human-facing groups only — GL codes are resolved in code, never shown in Simple mode. */
const SIMPLE_EXPENSE_CATEGORIES = ["Staff", "Marketing", "Transport", "Utilities", "Office", "Other"] as const;
type SimpleCategory = (typeof SIMPLE_EXPENSE_CATEGORIES)[number];

const SIMPLE_EXPENSE_TYPE_LABELS: Record<SimpleCategory, string> = {
  Staff: "👨‍💼 Staff & Salaries",
  Marketing: "📢 Marketing",
  Transport: "🚗 Transport & Fuel",
  Utilities: "🏠 Rent & Utilities",
  Office: "🏢 Office & Admin",
  Other: "📦 Other",
};

/**
 * Default GL codes per simple type (preference order). Item text refines Transport & Utilities.
 * Aligns with typical 61xx / 62xx / 63xx / 64xx hotel charts.
 */
const SIMPLE_TYPE_GL_CODES: Record<SimpleCategory, string[]> = {
  Staff: ["6120", "6130", "6110", "6140", "6150", "6160", "6170", "6100"],
  Marketing: ["6210", "6220"],
  Transport: ["6413", "6411"],
  Utilities: ["6419", "6331", "6332", "6414", "6415"],
  Office: ["6400", "6412", "6410", "6340", "6420"],
  Other: ["6300"],
};

const SIMPLE_TYPE_NAME_FALLBACK: Record<SimpleCategory, string[]> = {
  Staff: ["staff salar", "nssf", "personnel", "payroll", "welfare", "medical", "bonus", "training"],
  Marketing: ["advert", "marketing", "publicity", "commission"],
  Transport: ["fuel", "transport", "vehicle", "freight"],
  Utilities: ["rent", "electric", "water", "telephone", "internet", "airtime"],
  Office: ["administrative", "office", "stationery", "legal", "insurance", "security"],
  Other: ["general", "misc", "sundry"],
};

function normalizeExpenseAccountCode(account: GlAccount): string {
  const raw = String(account.account_code ?? "")
    .trim()
    .replace(/\s+/g, "");
  const head = raw.split(/[.\-/]/)[0] ?? raw;
  return head.replace(/^0+(?=\d)/, "") || head;
}

function findExpenseGlByCodes(expenseAccounts: GlAccount[], codes: string[]): GlAccount | null {
  const want = codes.map((c) => String(c).trim());
  for (const code of want) {
    const hit = expenseAccounts.find((a) => normalizeExpenseAccountCode(a) === code);
    if (hit) return hit;
  }
  return null;
}

function findExpenseGlByNameSubs(expenseAccounts: GlAccount[], subs: string[]): GlAccount | null {
  const onlyExpense = expenseAccounts.filter((a) => a.account_type === "expense");
  const blob = (a: GlAccount) =>
    `${a.account_name} ${a.account_code}`.toLowerCase();
  for (const sub of subs) {
    const hit = onlyExpense.find((a) => blob(a).includes(sub));
    if (hit) return hit;
  }
  return null;
}

function buildGlCodeToSimpleCategoryMap(): Map<string, SimpleCategory> {
  const m = new Map<string, SimpleCategory>();
  for (const cat of SIMPLE_EXPENSE_CATEGORIES) {
    for (const code of SIMPLE_TYPE_GL_CODES[cat]) {
      const n = String(code).trim().replace(/^0+(?=\d)/, "");
      if (!m.has(n)) m.set(n, cat);
    }
  }
  return m;
}

const SIMPLE_GL_CODE_TO_CATEGORY = buildGlCodeToSimpleCategoryMap();

type PaymentMethodSimple = "cash" | "bank" | "mobile";

type SimpleExpenseLine = {
  key: string;
  item: string;
  amount: string;
  payment_method: PaymentMethodSimple;
  /** Simple group only — GL is resolved at save from category + item text */
  category: SimpleCategory;
  /** After user picks a type, stop auto-overwriting from “What” text */
  typeLocked: boolean;
};

function readSimpleExpenseModeDefault(): boolean {
  try {
    return localStorage.getItem(SIMPLE_EXPENSE_MODE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Match cash / bank / mobile GL account names for “Paid using” mapping and list labels. */
const GL_NAME_MOBILE =
  /mtn|airtel|momo|mpesa|safaricom|vodacom|vodafone|tigo|orange|wave money|wave\b|flutterwave|paystack|ecocash|equitel|africell|cellpay|e-?wallet|mobile money|digital wallet|m-?pesa/i;
const GL_NAME_BANK =
  /bank\b|banking|current acc|checking|overdraft|savings\b|nostro|vostro|clearing|stanbic|absa|equity bank|dfc|crdb|centenary|diamond trust|exim|kcb\b|barclays|standard chartered/i;
const GL_NAME_CASH = /cash\b|petty cash|till|imprest|cash drawer|cash on hand|float\b|safe\b/i;

function inferPaymentLabelFromGlName(name: string): string {
  const n = (name || "").toLowerCase();
  if (GL_NAME_MOBILE.test(n)) return "Mobile money";
  if (GL_NAME_BANK.test(n)) return "Bank";
  if (GL_NAME_CASH.test(n)) return "Cash";
  return "Cash";
}

function mapPaymentMethodToGlId(
  method: PaymentMethodSimple,
  cashSourceOptions: GlAccount[]
): string | null {
  const list = cashSourceOptions;
  const txt = (a: GlAccount) => `${a.account_name} ${a.account_code}`.toLowerCase();
  if (method === "mobile") {
    const m = list.find((a) => GL_NAME_MOBILE.test(txt(a)));
    if (m) return m.id;
  }
  if (method === "bank") {
    const m = list.find((a) => GL_NAME_BANK.test(txt(a)));
    if (m) return m.id;
  }
  if (method === "cash") {
    const m = list.find((a) => GL_NAME_CASH.test(txt(a)) && !GL_NAME_BANK.test(txt(a)));
    if (m) return m.id;
  }
  const fallback =
    method === "bank"
      ? list.find((a) => GL_NAME_BANK.test(txt(a)))
      : method === "mobile"
        ? list.find((a) => GL_NAME_MOBILE.test(txt(a)) || /\bmobile\b|\bmoney\b/i.test(txt(a)))
        : list.find((a) => GL_NAME_CASH.test(txt(a)) || /\bcash\b/i.test(txt(a)));
  return (fallback ?? list[0])?.id ?? null;
}

/** Resolve expense GL UUID from simple type + optional item text (never shown in Simple UI). */
function mapCategoryToExpenseGlId(
  category: SimpleCategory,
  expenseAccounts: GlAccount[],
  itemHint = ""
): string | null {
  const expenseOnly = expenseAccounts.filter((a) => a.account_type === "expense");
  if (expenseOnly.length === 0) return expenseAccounts[0]?.id ?? null;
  const t = itemHint.toLowerCase();

  if (category === "Transport") {
    if (/fuel|diesel|petrol|gasoline|pms|generator|lubricant/.test(t)) {
      const a = findExpenseGlByCodes(expenseOnly, ["6413"]);
      if (a) return a.id;
    }
    if (/fare|taxi|boda|transport|vehicle|delivery|freight/.test(t)) {
      const a = findExpenseGlByCodes(expenseOnly, ["6411"]);
      if (a) return a.id;
    }
    const a = findExpenseGlByCodes(expenseOnly, ["6413", "6411"]);
    if (a) return a.id;
  }

  if (category === "Utilities") {
    if (/electric|power|kplc|units/.test(t)) {
      const w = findExpenseGlByCodes(expenseOnly, ["6331"]);
      if (w) return w.id;
    }
    if (/water|nwsc/.test(t)) {
      const w = findExpenseGlByCodes(expenseOnly, ["6332"]);
      if (w) return w.id;
    }
    if (/rent|lease|premises/.test(t)) {
      const w = findExpenseGlByCodes(expenseOnly, ["6419"]);
      if (w) return w.id;
    }
    if (/telephone|internet|airtime|telecom|phone|data|dstv/.test(t)) {
      const w = findExpenseGlByCodes(expenseOnly, ["6414", "6415"]);
      if (w) return w.id;
    }
    const x = findExpenseGlByCodes(expenseOnly, ["6419", "6331", "6332", "6414", "6415"]);
    if (x) return x.id;
  }

  if (category === "Staff") {
    const inPersonnelBand = expenseOnly.filter((a) => {
      const n = parseInt(normalizeExpenseAccountCode(a), 10);
      return Number.isFinite(n) && n >= 6100 && n < 6200;
    });
    const pool = inPersonnelBand.length > 0 ? inPersonnelBand : expenseOnly;
    const sal6120 = findExpenseGlByCodes(pool, ["6120"]);
    if (sal6120) return sal6120.id;
    const byCode = findExpenseGlByCodes(pool, SIMPLE_TYPE_GL_CODES.Staff);
    if (byCode) return byCode.id;
    const byName = findExpenseGlByNameSubs(pool, SIMPLE_TYPE_NAME_FALLBACK.Staff);
    if (byName) return byName.id;
    const firstByCode = [...pool].sort((a, b) =>
      normalizeExpenseAccountCode(a).localeCompare(normalizeExpenseAccountCode(b), undefined, { numeric: true })
    )[0];
    if (firstByCode) return firstByCode.id;
  }

  const codes = SIMPLE_TYPE_GL_CODES[category];
  const byCode = findExpenseGlByCodes(expenseOnly, codes);
  if (byCode) return byCode.id;

  const subs = SIMPLE_TYPE_NAME_FALLBACK[category];
  const byName = findExpenseGlByNameSubs(expenseOnly, subs);
  if (byName) return byName.id;

  return expenseOnly[0]?.id ?? null;
}

function guessCategoryFromItem(text: string): SimpleCategory | null {
  const s = text.toLowerCase().trim();
  if (!s) return null;
  if (/salary|nssf|paye|payroll|staff|wage|bonus|medical|welfare|training|recruitment|personnel/.test(s)) return "Staff";
  if (/marketing|advert|publicity|commission|agent/.test(s)) return "Marketing";
  if (/fuel|diesel|petrol|gasoline|pms|generator|lubricant|transport|taxi|fare|vehicle|delivery|freight|boda/.test(s))
    return "Transport";
  if (/rent|lease|premises|electric|power|kplc|water|nwsc|utility|airtime|internet|phone|telecom|dstv/.test(s))
    return "Utilities";
  if (/office|stationery|printing|legal|postage|insurance|bank charge|repairs|maintenance|security|licence|catering|board/.test(s))
    return "Office";
  return null;
}

/** When editing, derive simple type back from posting account. */
function inferCategoryFromExpenseGl(glId: string, expenseAccounts: GlAccount[]): SimpleCategory {
  const row = expenseAccounts.find((a) => a.id === glId);
  if (!row || row.account_type !== "expense") return "Other";

  const blobEarly = `${row.account_name} ${row.account_code}`.toLowerCase();
  if (blobEarly.includes("dividend")) return "Other";

  const nc = normalizeExpenseAccountCode(row);

  const fromCode = SIMPLE_GL_CODE_TO_CATEGORY.get(nc);
  if (fromCode) return fromCode;

  const num = parseInt(nc, 10);
  if (Number.isFinite(num) && num >= 6100 && num < 6200) return "Staff";
  if (Number.isFinite(num) && num >= 6200 && num < 6300) return "Marketing";
  if (Number.isFinite(num) && num >= 6300 && num < 6400) return "Other";
  if (Number.isFinite(num) && (num === 6331 || num === 6332)) return "Utilities";
  if (Number.isFinite(num) && num >= 6400 && num < 6500) {
    if (num === 6413 || num === 6411) return "Transport";
    if (num === 6419 || num === 6414 || num === 6415) return "Utilities";
    return "Office";
  }

  for (const cat of SIMPLE_EXPENSE_CATEGORIES) {
    for (const kw of SIMPLE_TYPE_NAME_FALLBACK[cat]) {
      const blob = `${row.account_name} ${row.account_code}`.toLowerCase();
      if (blob.includes(kw)) return cat;
    }
  }
  return "Other";
}

function inferPaymentMethodFromGlId(glId: string, cashOptions: GlAccount[]): PaymentMethodSimple {
  const row = cashOptions.find((a) => a.id === glId);
  const name = row ? `${row.account_name} ${row.account_code}` : "";
  const n = name.toLowerCase();
  if (GL_NAME_MOBILE.test(n)) return "mobile";
  if (GL_NAME_BANK.test(n)) return "bank";
  return "cash";
}

const LAST_SIMPLE_CATEGORY_KEY = "boat.expenses.last_category";

function readLastSimpleCategory(): SimpleCategory {
  try {
    const v = localStorage.getItem(LAST_SIMPLE_CATEGORY_KEY);
    if (v && (SIMPLE_EXPENSE_CATEGORIES as readonly string[]).includes(v)) return v as SimpleCategory;
    const legacy: Record<string, SimpleCategory> = {
      Fuel: "Transport",
      Transport: "Transport",
      Rent: "Utilities",
      Airtime: "Utilities",
      Salary: "Staff",
    };
    if (v && legacy[v]) return legacy[v];
  } catch {
    /* ignore */
  }
  return "Other";
}

function emptySimpleLine(): SimpleExpenseLine {
  return {
    key: randomUuid(),
    item: "",
    amount: "",
    payment_method: "cash",
    category: readLastSimpleCategory(),
    typeLocked: false,
  };
}


function buildSimpleExpenseDescription(itemSummary: string, notes: string): string {
  const s = itemSummary.trim();
  const n = notes.trim();
  if (!n) return s || "Expense";
  return s ? `${s}\n\n${n}` : n;
}

/** Notes are stored after a blank line in `expenses.description`. */
function extractSimpleNotesFromExpenseDescription(desc: string | null): string {
  const raw = (desc || "").trim();
  if (!raw) return "";
  const sep = "\n\n";
  const idx = raw.indexOf(sep);
  if (idx === -1) return "";
  return raw.slice(idx + sep.length).trim();
}

/** Summary line for list “What” (before optional notes block). */
function displayWhatColumn(desc: string | null): string {
  const raw = (desc || "").trim();
  if (!raw) return "—";
  const idx = raw.indexOf("\n\n");
  return (idx === -1 ? raw : raw.slice(0, idx).trim()) || "—";
}

function formatMoneyAmount(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(0)}`;
  }
}

type GlAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  category: string | null;
};

interface Expense {
  id: string;
  vendor_id?: string | null;
  amount: number;
  description?: string | null;
  expense_date?: string | null;
  vendors?: { name: string } | null;
  /** Line count for display (from expense_lines aggregate) */
  line_count?: number;
  /** Distinct expense GL account names on this expense (from lines) */
  expense_gl_labels?: string;
  /** First line’s payment source, for simple list (Cash / Bank / Mobile money) */
  paid_using_label?: string;
  source_documents?: unknown;
}

type LineDraft = {
  key: string;
  /** Optional vendor for this line only */
  vendor_id: string;
  expense_gl_account_id: string;
  source_cash_gl_account_id: string;
  /** Net amount (ex VAT) */
  amount: string;
  /** When true, VAT is computed from net × VAT % at top of form */
  vat_enabled: boolean;
  vat_gl_account_id: string;
  comment: string;
};

function emptyLine(): LineDraft {
  return {
    key: randomUuid(),
    vendor_id: "",
    expense_gl_account_id: "",
    source_cash_gl_account_id: "",
    amount: "",
    vat_enabled: true,
    vat_gl_account_id: "",
    comment: "",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNum(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Calendar date in local timezone (date inputs must not use UTC-only ISO). */
function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;

function normalizeGlAccount(row: Record<string, unknown>): GlAccount {
  return {
    id: String(row.id ?? ""),
    account_code: String(row.account_code ?? row.code ?? ""),
    account_name: String(row.account_name ?? row.name ?? ""),
    account_type: String(row.account_type ?? row.type ?? "").toLowerCase(),
    category: row.category == null ? null : String(row.category),
  };
}

/** Supabase/PostgREST errors are plain objects — avoid "[object Object]" in alerts. */
function formatSupabaseError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    if (err.code) return `Code ${err.code}`;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** DB migration for `source_documents` not applied yet (PostgREST / Postgres). */
function isMissingSourceDocumentsColumnError(err: unknown): boolean {
  const msg = formatSupabaseError(err).toLowerCase();
  return msg.includes("source_documents") && msg.includes("does not exist");
}

type ExpensesPageProps = {
  /** Jump to Buy stock / purchase orders without duplicating flows */
  onNavigate?: (page: string) => void;
};

export function ExpensesPage({ onNavigate }: ExpensesPageProps = {}) {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [expenseDate, setExpenseDate] = useState(() => localDateISO());
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [expenseAttachmentFiles, setExpenseAttachmentFiles] = useState<File[]>([]);
  const [filterDateFrom, setFilterDateFrom] = useState(() => localDateISO());
  const [filterDateTo, setFilterDateTo] = useState(() => localDateISO());
  const [filterVendorId, setFilterVendorId] = useState("");
  /** Filter list to expenses that have at least one line posting to this expense GL */
  const [filterExpenseGlAccountId, setFilterExpenseGlAccountId] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** False when DB has no `expenses.source_documents` column (migration not run). */
  const [expenseAttachmentsSupported, setExpenseAttachmentsSupported] = useState(true);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [vatRatePercent, setVatRatePercent] = useState("18");
  const [existingSourceDocuments, setExistingSourceDocuments] = useState<SourceDocumentRef[]>([]);
  const [editModalLoading, setEditModalLoading] = useState(false);
  /** Default VAT GL from journal settings — applied to new lines and first line on Add */
  const [defaultVatGlId, setDefaultVatGlId] = useState("");
  const [simpleExpenseMode, setSimpleExpenseMode] = useState<boolean>(() => readSimpleExpenseModeDefault());
  const [simpleLines, setSimpleLines] = useState<SimpleExpenseLine[]>(() => [emptySimpleLine()]);
  const [simpleNotes, setSimpleNotes] = useState("");
  const [simpleVendorId, setSimpleVendorId] = useState<string | null>(null);
  /** Form-level VAT for simple mode (default off). */
  const [simpleIncludeVat, setSimpleIncludeVat] = useState(false);
  const [showSimpleDetails, setShowSimpleDetails] = useState(false);

  const orgId = user?.organization_id ?? null;
  const isLocalDesktopMode =
    ((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase() === "true" ||
      (import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase() === "1") &&
    (import.meta.env.VITE_DEPLOYMENT_MODE || "").trim().toLowerCase() === "lan";

  const loadGlAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("gl_accounts")
      .select("*");
    if (error) {
      console.error("GL accounts load error:", error.message);
      setGlAccounts([]);
      return;
    }
    const normalized = ((data || []) as Array<Record<string, unknown>>)
      .map(normalizeGlAccount)
      .filter((row) => row.id)
      .sort((a, b) =>
        `${a.account_code || ""} ${a.account_name || ""}`.localeCompare(
          `${b.account_code || ""} ${b.account_name || ""}`
        )
      );
    setGlAccounts(normalized);
  }, []);

  const loadVendors = useCallback(async () => {
    const loadLocalVendors = async () => {
      const [owned, legacy] = await Promise.all([
        supabase.from("vendors").select("id, name").eq("organization_id", orgId),
        supabase.from("vendors").select("id, name").is("organization_id", null),
      ]);
      if (owned.error) return owned;
      if (legacy.error) return legacy;
      const merged = [...(owned.data || []), ...(legacy.data || [])];
      const deduped = Array.from(new Map(merged.map((v: { id: string }) => [v.id, v])).values());
      return { data: deduped, error: null };
    };

    const result =
      orgId && isLocalDesktopMode
        ? await loadLocalVendors()
        : await (() => {
            let base = supabase.from("vendors").select("id, name");
            if (orgId) {
              base = base.eq("organization_id", orgId);
            }
            return base;
          })();
    const { data, error } = result;
    if (error) {
      console.error("Vendors load error:", error.message);
      setVendors([]);
      return;
    }
    setVendors([...(data || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
  }, [orgId, isLocalDesktopMode]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const venRes = await (async () => {
        if (orgId && isLocalDesktopMode) {
          const [owned, legacy] = await Promise.all([
            supabase.from("vendors").select("id, name").eq("organization_id", orgId),
            supabase.from("vendors").select("id, name").is("organization_id", null),
          ]);
          if (owned.error) return owned;
          if (legacy.error) return legacy;
          const merged = [...(owned.data || []), ...(legacy.data || [])];
          const deduped = Array.from(new Map(merged.map((v: { id: string }) => [v.id, v])).values());
          return { data: deduped, error: null };
        }
        let q = supabase.from("vendors").select("id, name");
        if (orgId) q = q.eq("organization_id", orgId);
        return q;
      })();

      if (venRes.error) console.error("Vendors:", venRes.error.message);
      const venList = (venRes.data || []) as Array<{ id: string; name: string }>;
      setVendors([...venList].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      const vMap = new Map<string, string>(venList.map((v) => [v.id, v.name]));

      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;

      let glFilteredExpenseIds: string[] | null = null;
      if (filterExpenseGlAccountId) {
        const { data: glLines, error: glErr } = await supabase
          .from("expense_lines")
          .select("expense_id")
          .eq("expense_gl_account_id", filterExpenseGlAccountId);
        if (glErr) {
          console.error("Expense lines GL filter:", glErr.message);
          throw glErr;
        }
        glFilteredExpenseIds = [...new Set((glLines || []).map((r: { expense_id: string }) => r.expense_id))];
        if (glFilteredExpenseIds.length === 0) {
          setTotalCount(0);
          setExpenses([]);
          setLoading(false);
          return;
        }
      }

      const buildExpenseQuery = (selectCols: string) => {
        let q = supabase
          .from("expenses")
          .select(selectCols, { count: "exact" })
          .order("expense_date", { ascending: false });
        if (orgId) q = q.eq("organization_id", orgId);
        if (filterDateFrom) q = q.gte("expense_date", filterDateFrom);
        if (filterDateTo) q = q.lte("expense_date", filterDateTo);
        if (filterVendorId) q = q.eq("vendor_id", filterVendorId);
        if (glFilteredExpenseIds && glFilteredExpenseIds.length > 0) {
          q = q.in("id", glFilteredExpenseIds);
        }
        return q;
      };

      let expRes = await buildExpenseQuery(
        "id, vendor_id, amount, description, expense_date, source_documents"
      ).range(fromIdx, toIdx);

      if (expRes.error && isMissingSourceDocumentsColumnError(expRes.error)) {
        setExpenseAttachmentsSupported(false);
        expRes = await buildExpenseQuery("id, vendor_id, amount, description, expense_date").range(fromIdx, toIdx);
      } else if (!expRes.error) {
        setExpenseAttachmentsSupported(true);
      }

      if (expRes.error) {
        console.error("Expenses:", expRes.error);
        throw expRes.error;
      }

      setTotalCount(typeof expRes.count === "number" ? expRes.count : null);

      const raw = (expRes.data || []) as unknown as Array<{
        id: string;
        vendor_id: string | null;
        amount: number;
        description: string | null;
        expense_date: string | null;
        source_documents?: unknown;
      }>;

      const ids = raw.map((e) => e.id);
      const lineByExpense: Record<string, number> = {};
      const glNamesByExpense: Record<string, Set<string>> = {};
      const firstSourceGlByExpense: Record<string, string> = {};
      let glNameByIdForList = new Map<string, string>();
      if (ids.length > 0) {
        const { data: lineRows, error: lineErr } = await supabase
          .from("expense_lines")
          .select("expense_id, expense_gl_account_id, source_cash_gl_account_id, sort_order")
          .in("expense_id", ids);
        if (lineErr) console.error("Expense lines count:", lineErr.message);
        else {
          const sorted = [...(lineRows || [])].sort((a, b) => {
            const sa = Number((a as { sort_order?: number }).sort_order ?? 0);
            const sb = Number((b as { sort_order?: number }).sort_order ?? 0);
            return sa - sb;
          });
          for (const r of sorted) {
            const row = r as {
              expense_id: string;
              expense_gl_account_id: string;
              source_cash_gl_account_id: string;
            };
            const eid = row.expense_id;
            lineByExpense[eid] = (lineByExpense[eid] || 0) + 1;
            if (!firstSourceGlByExpense[eid] && row.source_cash_gl_account_id) {
              firstSourceGlByExpense[eid] = row.source_cash_gl_account_id;
            }
          }
          const glIds = new Set<string>();
          for (const r of lineRows || []) {
            const row = r as { expense_gl_account_id: string };
            glIds.add(row.expense_gl_account_id);
          }
          for (const id of Object.values(firstSourceGlByExpense)) {
            if (id) glIds.add(id);
          }
          let nameByGlId = new Map<string, string>();
          if (glIds.size > 0) {
            const { data: glRows } = await supabase
              .from("gl_accounts")
              .select("*")
              .in("id", [...glIds]);
            const normalizedRows = ((glRows || []) as Array<Record<string, unknown>>).map(normalizeGlAccount);
            nameByGlId = new Map(normalizedRows.map((g) => [g.id, g.account_name || g.account_code || "Unnamed account"]));
          }
          glNameByIdForList = nameByGlId;
          for (const r of lineRows || []) {
            const row = r as { expense_id: string; expense_gl_account_id: string };
            const nm = nameByGlId.get(row.expense_gl_account_id);
            if (!nm) continue;
            if (!glNamesByExpense[row.expense_id]) glNamesByExpense[row.expense_id] = new Set();
            glNamesByExpense[row.expense_id].add(nm);
          }
        }
      }

      setExpenses(
        raw.map((e) => {
          const srcGl = firstSourceGlByExpense[e.id];
          const srcName = srcGl ? glNameByIdForList.get(srcGl) || "" : "";
          return {
            ...e,
            vendors: e.vendor_id ? { name: vMap.get(e.vendor_id) ?? "—" } : null,
            line_count: lineByExpense[e.id] ?? 0,
            expense_gl_labels: glNamesByExpense[e.id]?.size
              ? [...glNamesByExpense[e.id]].sort().join(", ")
              : "—",
            paid_using_label: srcGl ? inferPaymentLabelFromGlName(srcName) : "—",
            source_documents: e.source_documents,
          };
        })
      );
    } catch (e) {
      console.error("Error fetching expenses:", e);
      setFetchError(formatSupabaseError(e));
      setExpenses([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, isLocalDesktopMode, filterDateFrom, filterDateTo, filterVendorId, filterExpenseGlAccountId, page, pageSize]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [filterDateFrom, filterDateTo, filterVendorId, filterExpenseGlAccountId, pageSize]);

  useEffect(() => {
    if (simpleExpenseMode) setFilterExpenseGlAccountId("");
  }, [simpleExpenseMode]);

  useEffect(() => {
    loadGlAccounts();
  }, [loadGlAccounts]);

  useEffect(() => {
    if (showModal) {
      void loadVendors();
      void loadGlAccounts();
    }
  }, [showModal, loadVendors, loadGlAccounts]);

  useEffect(() => {
    if (!orgId) return;
    void loadVendors();
    void loadGlAccounts();
  }, [orgId, loadVendors, loadGlAccounts]);

  useEffect(() => {
    try {
      localStorage.setItem(SIMPLE_EXPENSE_MODE_KEY, simpleExpenseMode ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [simpleExpenseMode]);

  const currencyCode = useMemo(() => loadHotelConfig(orgId ?? null).currency || "UGX", [orgId]);

  const cashSourceOptions = useMemo(() => {
    const list = glAccounts.filter((a) => (a.category || "").toLowerCase() === "cash");
    if (list.length > 0) return list;
    return glAccounts.filter((a) => a.account_type === "asset");
  }, [glAccounts]);

  const expenseGlOptions = useMemo(
    () => glAccounts.filter((a) => a.account_type === "expense"),
    [glAccounts]
  );

  /** Input VAT can sit on asset, liability, or expense per chart — allow full chart search */
  const vatGlAccountOptions = useMemo(
    () =>
      glAccounts.map((a) => ({
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
      })),
    [glAccounts]
  );

  const paginationLabel = useMemo(() => {
    if (totalCount === 0) return simpleExpenseMode ? "0 entries" : "0 expenses";
    if (totalCount === null) {
      const from = page * pageSize + 1;
      const to = page * pageSize + expenses.length;
      return expenses.length ? `Rows ${from}–${to}` : "";
    }
    const from = page * pageSize + 1;
    const to = Math.min(page * pageSize + expenses.length, totalCount);
    return `Rows ${from}–${to} of ${totalCount}`;
  }, [totalCount, page, pageSize, expenses.length, simpleExpenseMode]);

  const canPrevPage = page > 0;
  const canNextPage = totalCount !== null && (page + 1) * pageSize < totalCount;

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () =>
    setLines((prev) => {
      const l = emptyLine();
      if (defaultVatGlId) l.vat_gl_account_id = defaultVatGlId;
      return [...prev, l];
    });

  const removeRow = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const lineTotals = useMemo(() => {
    const rate = parseNum(vatRatePercent);
    return lines.map((r) => {
      const net = round2(parseNum(r.amount));
      const vat = r.vat_enabled ? round2(net * (rate / 100)) : 0;
      return { net, vat, rowTotal: round2(net + vat) };
    });
  }, [lines, vatRatePercent]);

  const vendorComboboxOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name })),
    [vendors]
  );

  const grandTotal = useMemo(() => lineTotals.reduce((s, t) => s + t.rowTotal, 0), [lineTotals]);
  const grandNet = useMemo(() => lineTotals.reduce((s, t) => s + t.net, 0), [lineTotals]);
  const grandVat = useMemo(() => lineTotals.reduce((s, t) => s + t.vat, 0), [lineTotals]);

  const simpleLineTotals = useMemo(() => {
    const rate = parseNum(vatRatePercent);
    return simpleLines.map((r) => {
      const net = round2(parseNum(r.amount));
      const vat = simpleIncludeVat ? round2(net * (rate / 100)) : 0;
      return { net, vat, rowTotal: round2(net + vat) };
    });
  }, [simpleLines, simpleIncludeVat, vatRatePercent]);

  const simpleGrandTotal = useMemo(() => simpleLineTotals.reduce((s, t) => s + t.rowTotal, 0), [simpleLineTotals]);

  const updateSimpleLine = (key: string, patch: Partial<SimpleExpenseLine>) => {
    setSimpleLines((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addSimpleRow = () => setSimpleLines((prev) => [...prev, emptySimpleLine()]);

  const removeSimpleRow = (key: string) => {
    setSimpleLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const handleSave = async () => {
    const rate = parseNum(vatRatePercent);
    const journalRows: ExpenseJournalLineInput[] = [];
    const vendorIdsPerJournalRow: (string | null)[] = [];

    if (simpleExpenseMode) {
      const js = orgId ? await resolveJournalAccountSettings(orgId) : loadJournalAccountSettings();
      const vatGlResolved = (defaultVatGlId || js.vat_id || "").trim();

      for (let i = 0; i < simpleLines.length; i++) {
        const r = simpleLines[i];
        const net = round2(parseNum(r.amount));
        const vat = simpleIncludeVat ? round2(net * (rate / 100)) : 0;
        const rowTotal = round2(net + vat);
        if (rowTotal <= 0) continue;

        const expGl = mapCategoryToExpenseGlId(r.category, expenseGlOptions, r.item.trim());
        const srcGl = mapPaymentMethodToGlId(r.payment_method, cashSourceOptions);
        if (!expGl || !srcGl) {
          alert(
            "Could not map this expense to your chart. Add the usual expense accounts (e.g. 6120, 6210, 6413) or use Accountant mode."
          );
          return;
        }
        if (simpleIncludeVat && !vatGlResolved) {
          alert(
            "Include VAT is on but no VAT account is configured. Set it under Admin → Journal account settings, or use Accountant mode."
          );
          return;
        }
        journalRows.push({
          expense_gl_account_id: expGl,
          source_cash_gl_account_id: srcGl,
          amount: net,
          bank_charges: 0,
          vat_amount: vat,
          vat_gl_account_id: simpleIncludeVat ? vatGlResolved : null,
          bank_charges_gl_account_id: null,
          comment: r.item.trim() || null,
        });
        vendorIdsPerJournalRow.push(simpleVendorId);
      }

      if (journalRows.length === 0) {
        alert("Enter at least one item with an amount greater than zero.");
        return;
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        const r = lines[i];
        const t = lineTotals[i];
        if (t.rowTotal <= 0) continue;
        if (!r.expense_gl_account_id || !r.source_cash_gl_account_id) {
          alert("Each line with an amount must have Expense GL and Source of funds selected.");
          return;
        }
        journalRows.push({
          expense_gl_account_id: r.expense_gl_account_id,
          source_cash_gl_account_id: r.source_cash_gl_account_id,
          amount: t.net,
          bank_charges: 0,
          vat_amount: t.vat,
          vat_gl_account_id: r.vat_gl_account_id || null,
          bank_charges_gl_account_id: null,
          comment: r.comment.trim() || null,
        });
        vendorIdsPerJournalRow.push(r.vendor_id.trim() || null);
      }

      if (journalRows.length === 0) {
        alert("Enter at least one line with a positive total (amount and/or VAT).");
        return;
      }
    }

    setSaving(true);
    try {
      const expDate = expenseDate || localDateISO();
      const summary = simpleExpenseMode
        ? buildSimpleExpenseDescription(
            simpleLines
              .filter((l) => round2(parseNum(l.amount)) > 0)
              .map((l) => l.item.trim())
              .filter(Boolean)
              .join("; "),
            simpleNotes
          )
        : lines
            .map((l) => l.comment.trim())
            .filter(Boolean)
            .join("; ") || "Expense";

      const totalRounded =
        Math.round((simpleExpenseMode ? simpleGrandTotal : grandTotal) * 100) / 100;

      const lineInsertsFor = (expenseId: string) =>
        journalRows.map((jr, idx) => ({
          expense_id: expenseId,
          expense_gl_account_id: jr.expense_gl_account_id,
          source_cash_gl_account_id: jr.source_cash_gl_account_id,
          amount: jr.amount,
          bank_charges: 0,
          vat_amount: jr.vat_amount,
          vat_gl_account_id: jr.vat_gl_account_id || null,
          bank_charges_gl_account_id: null,
          comment: jr.comment || null,
          sort_order: idx,
          vendor_id: vendorIdsPerJournalRow[idx] ?? null,
        }));

      let expenseId: string;
      let savedDate: string;

      if (editingExpenseId) {
        expenseId = editingExpenseId;
        const delJ = await deleteJournalEntryByReference("expense", expenseId);
        if (!delJ.ok) throw new Error(delJ.error);

        const { error: delLinesErr } = await supabase.from("expense_lines").delete().eq("expense_id", expenseId);
        if (delLinesErr) throw delLinesErr;

        const { error: updErr } = await supabase
          .from("expenses")
          .update({
            amount: totalRounded,
            description: summary,
            expense_date: expDate,
            ...(simpleExpenseMode ? { vendor_id: simpleVendorId } : {}),
          })
          .eq("id", expenseId);
        if (updErr) throw updErr;

        const { data: expRow } = await supabase.from("expenses").select("expense_date").eq("id", expenseId).single();
        savedDate = (expRow as { expense_date: string | null } | null)?.expense_date ?? expDate;

        const { error: lineErr } = await supabase.from("expense_lines").insert(lineInsertsFor(expenseId));
        if (lineErr) throw lineErr;
      } else {
        const { data: insertedRows, error: expErr } = await supabase
          .from("expenses")
          .insert({
            vendor_id: simpleExpenseMode ? simpleVendorId : null,
            amount: totalRounded,
            description: summary,
            expense_date: expDate,
          })
          .select("id, expense_date");

        if (expErr) throw expErr;
        const inserted = insertedRows?.[0] as { id: string; expense_date: string } | undefined;
        if (!inserted?.id) {
          throw new Error(
            "Expense insert returned no row. Often RLS or missing organization on your staff profile — check Supabase policies and migrations."
          );
        }
        expenseId = inserted.id;
        savedDate = inserted.expense_date ?? expDate;

        const { error: lineErr } = await supabase.from("expense_lines").insert(lineInsertsFor(expenseId));
        if (lineErr) {
          await supabase.from("expenses").delete().eq("id", expenseId);
          throw lineErr;
        }
      }

      const jr = await createJournalForExpenseWithLines(
        expenseId,
        savedDate,
        journalRows,
        user?.id ?? null
      );
      if (!jr.ok) {
        alert(`Expense saved but journal was not posted: ${jr.error}`);
      }

      const uploadNewAttachments = async (): Promise<SourceDocumentRef[]> => {
        const next: SourceDocumentRef[] = [];
        if (expenseAttachmentFiles.length > 0 && orgId) {
          for (const file of expenseAttachmentFiles) {
            const path = buildStoragePath(orgId, "expenses", expenseId, file.name);
            const up = await uploadSourceDocument(file, path);
            if (!up.error) next.push({ path, name: file.name });
          }
        }
        return next;
      };

      const uploaded = await uploadNewAttachments();
      const mergedDocs =
        editingExpenseId && existingSourceDocuments.length > 0
          ? [...existingSourceDocuments, ...uploaded]
          : uploaded.length > 0
            ? uploaded
            : editingExpenseId
              ? existingSourceDocuments
              : [];

      if (mergedDocs.length > 0 && expenseAttachmentsSupported) {
        const { error: docErr } = await supabase.from("expenses").update({ source_documents: mergedDocs }).eq("id", expenseId);
        if (docErr && isMissingSourceDocumentsColumnError(docErr)) {
          alert(
            "Expense saved, but attachments could not be stored: run the SQL migration that adds expenses.source_documents (see supabase/migrations/20260328000000_source_documents_attachments.sql)."
          );
        } else if (docErr) {
          throw docErr;
        }
      }

      if (simpleExpenseMode) {
        try {
          const lastLine = simpleLines.find((l) => parseNum(l.amount) > 0);
          if (lastLine) {
            localStorage.setItem(LAST_SIMPLE_CATEGORY_KEY, lastLine.category);
          }
        } catch {
          /* ignore */
        }
      }

      setShowModal(false);
      setEditingExpenseId(null);
      setExistingSourceDocuments([]);
      setExpenseDate(localDateISO());
      setVatRatePercent("18");
      setDefaultVatGlId("");
      setLines([emptyLine()]);
      setSimpleLines([emptySimpleLine()]);
      setSimpleNotes("");
      setSimpleVendorId(null);
      setSimpleIncludeVat(false);
      setShowSimpleDetails(false);
      setExpenseAttachmentFiles([]);
      void fetchData();
    } catch (e) {
      console.error("Error adding expense:", e);
      alert("Failed: " + formatSupabaseError(e));
    } finally {
      setSaving(false);
    }
  };

  const openModal = () => {
    setEditingExpenseId(null);
    setExistingSourceDocuments([]);
    setExpenseAttachmentFiles([]);
    setExpenseDate(localDateISO());
    setLines([emptyLine()]);
    setSimpleLines([emptySimpleLine()]);
    setSimpleNotes("");
    setSimpleVendorId(null);
    setSimpleIncludeVat(false);
    setShowSimpleDetails(false);
    setShowModal(true);
    void (async () => {
      const s = orgId ? await resolveJournalAccountSettings(orgId) : loadJournalAccountSettings();
      const pct = s.default_vat_percent;
      setVatRatePercent(pct != null && Number.isFinite(pct) ? String(pct) : "18");
      const vatGl = s.vat_id ?? "";
      setDefaultVatGlId(vatGl);
      setLines((prev) => {
        if (prev.length !== 1) return prev;
        const row = prev[0];
        if (row.vat_gl_account_id) return prev;
        return [{ ...row, vat_gl_account_id: vatGl }];
      });
    })();
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingExpenseId(null);
    setExistingSourceDocuments([]);
    setExpenseAttachmentFiles([]);
    setVatRatePercent("18");
    setDefaultVatGlId("");
    setLines([emptyLine()]);
    setSimpleLines([emptySimpleLine()]);
    setSimpleNotes("");
    setSimpleVendorId(null);
    setSimpleIncludeVat(false);
    setShowSimpleDetails(false);
  };

  const openEditModal = async (expenseId: string) => {
    setShowModal(true);
    setEditModalLoading(true);
    setEditingExpenseId(expenseId);
    setExpenseAttachmentFiles([]);
    try {
      const j = orgId ? await resolveJournalAccountSettings(orgId) : loadJournalAccountSettings();
      setDefaultVatGlId(j.vat_id ?? "");

      const { data: exp, error: expErr } = await supabase
        .from("expenses")
        .select("id, expense_date, description, source_documents, vendor_id")
        .eq("id", expenseId)
        .single();
      if (expErr) throw expErr;
      const row = exp as {
        id: string;
        expense_date: string | null;
        description: string | null;
        source_documents: unknown;
        vendor_id: string | null;
      };
      setExpenseDate(row.expense_date || localDateISO());
      setSimpleVendorId(row.vendor_id);
      setSimpleNotes(extractSimpleNotesFromExpenseDescription(row.description));

      const docs = row.source_documents;
      setExistingSourceDocuments(
        Array.isArray(docs) ? (docs as SourceDocumentRef[]).filter((d) => d && typeof d.path === "string") : []
      );

      const { data: lineRows, error: lineErr } = await supabase
        .from("expense_lines")
        .select(
          "vendor_id, expense_gl_account_id, source_cash_gl_account_id, amount, vat_amount, vat_gl_account_id, comment, sort_order"
        )
        .eq("expense_id", expenseId)
        .order("sort_order", { ascending: true });
      if (lineErr) throw lineErr;

      let inferredRate = 18;
      for (const lr of lineRows || []) {
        const l = lr as {
          amount: number;
          vat_amount: number;
        };
        const net = Number(l.amount) || 0;
        const vat = Number(l.vat_amount) || 0;
        if (net > 0 && vat > 0) {
          inferredRate = Math.round((vat / net) * 10000) / 100;
          break;
        }
      }
      setVatRatePercent(String(inferredRate));

      const mappedRows = (lineRows || []).map((lr: {
        vendor_id: string | null;
        expense_gl_account_id: string;
        source_cash_gl_account_id: string;
        amount: number;
        vat_amount: number;
        vat_gl_account_id: string | null;
        comment: string | null;
      }) => {
        const l = lr as {
          vendor_id: string | null;
          expense_gl_account_id: string;
          source_cash_gl_account_id: string;
          amount: number;
          vat_amount: number;
          vat_gl_account_id: string | null;
          comment: string | null;
        };
        const net = Number(l.amount) || 0;
        const vat = Number(l.vat_amount) || 0;
        return {
          key: randomUuid(),
          vendor_id: l.vendor_id ?? "",
          expense_gl_account_id: l.expense_gl_account_id,
          source_cash_gl_account_id: l.source_cash_gl_account_id,
          amount: net > 0 ? String(net) : "",
          vat_enabled: vat > 0,
          vat_gl_account_id: l.vat_gl_account_id ?? "",
          comment: l.comment ?? "",
        };
      });
      setLines(mappedRows);
      if (!mappedRows.length) {
        setLines([emptyLine()]);
      }

      if (simpleExpenseMode) {
        if ((lineRows || []).length > 0) {
          let anyVat = false;
          setSimpleLines(
            (lineRows || []).map((lr) => {
              const l = lr as {
                expense_gl_account_id: string;
                source_cash_gl_account_id: string;
                amount: number;
                vat_amount: number;
                comment: string | null;
              };
              const net = Number(l.amount) || 0;
              const vat = Number(l.vat_amount) || 0;
              if (vat > 0) anyVat = true;
              return {
                key: randomUuid(),
                item: (l.comment || "").trim(),
                amount: net > 0 ? String(net) : "",
                payment_method: inferPaymentMethodFromGlId(l.source_cash_gl_account_id, cashSourceOptions),
                category: inferCategoryFromExpenseGl(l.expense_gl_account_id, expenseGlOptions),
                typeLocked: true,
              };
            })
          );
          setSimpleIncludeVat(anyVat);
          setShowSimpleDetails(anyVat);
        } else {
          setSimpleLines([emptySimpleLine()]);
        }
      }
    } catch (e) {
      console.error("Load expense for edit:", e);
      alert("Could not load expense: " + formatSupabaseError(e));
      setShowModal(false);
      setEditingExpenseId(null);
    } finally {
      setEditModalLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Spend money</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Day-to-day spending — operational costs, fuel, and similar outflows (not buying inventory).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs font-medium"
            role="group"
            aria-label="Entry mode"
          >
            <button
              type="button"
              disabled={showModal}
              onClick={() => setSimpleExpenseMode(true)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                simpleExpenseMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              } disabled:opacity-50`}
            >
              Simple
            </button>
            <button
              type="button"
              disabled={showModal}
              onClick={() => setSimpleExpenseMode(false)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                !simpleExpenseMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              } disabled:opacity-50`}
            >
              Accountant
            </button>
          </div>
          <button type="button" onClick={openModal} className="app-btn-primary">
            <Plus className="w-5 h-5" /> Add spending
          </button>
        </div>
      </div>

      {onNavigate ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Buying stock or inventory?</span>{" "}
          Use{" "}
          <button
            type="button"
            onClick={() => onNavigate("purchases_orders")}
            className="font-semibold text-brand-600 hover:underline"
          >
            Buy stock
          </button>{" "}
          so receipts hit inventory correctly.
        </div>
      ) : null}

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <p className="font-medium">Could not load expenses</p>
          <p className="mt-1 text-red-800">{fetchError}</p>
        </div>
      )}

      {!expenseAttachmentsSupported && !fetchError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          <p className="font-medium">Expense attachments disabled</p>
          <p className="mt-1 text-amber-900/90">
            The <code className="rounded bg-amber-100/80 px-1 text-xs">source_documents</code> column is missing on{" "}
            <code className="rounded bg-amber-100/80 px-1 text-xs">expenses</code>. Run{" "}
            <code className="rounded bg-amber-100/80 px-1 text-xs">supabase/migrations/20260328000000_source_documents_attachments.sql</code>{" "}
            in the Supabase SQL Editor (at least the <code className="rounded bg-amber-100/80 px-1 text-xs">ALTER TABLE expenses</code>{" "}
            line), then reload.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <p className="text-sm font-medium text-slate-700 mb-3">Filters</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From date</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To date</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-[12rem]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
            <select
              value={filterVendorId}
              onChange={(e) => setFilterVendorId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rows per page</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 100 ? "50+ (100)" : n}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              const t = localDateISO();
              setFilterDateFrom(t);
              setFilterDateTo(t);
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterDateFrom("");
              setFilterDateTo("");
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            All dates
          </button>
          {!simpleExpenseMode ? (
            <div className="min-w-[14rem]">
              <label className="block text-xs font-medium text-slate-600 mb-1">Expense GL (line)</label>
              <select
                value={filterExpenseGlAccountId}
                onChange={(e) => setFilterExpenseGlAccountId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
              >
                <option value="">All expense accounts</option>
                {expenseGlOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const t = localDateISO();
              setFilterDateFrom(t);
              setFilterDateTo(t);
              setFilterVendorId("");
              setFilterExpenseGlAccountId("");
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Default view is today (local date). Use &quot;All dates&quot; if older expenses do not appear.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                {simpleExpenseMode ? (
                  <>
                    <th className="text-left p-3 min-w-[10rem]">What</th>
                    <th className="text-left p-3">Paid using</th>
                    <th className="text-right p-3">Amount</th>
                  </>
                ) : (
                  <>
                    <th className="text-left p-3">Vendor</th>
                    <th className="text-left p-3 min-w-[12rem]">Expense GL (lines)</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Lines</th>
                    <th className="text-right p-3">Total</th>
                  </>
                )}
                <th className="text-right p-3 w-24"> </th>
                {expenseAttachmentsSupported ? <th className="text-left p-3 w-28">Docs</th> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">
                    {e.expense_date ? new Date(e.expense_date).toLocaleDateString() : "—"}
                  </td>
                  {simpleExpenseMode ? (
                    <>
                      <td className="p-3 max-w-md truncate" title={displayWhatColumn(e.description ?? null)}>
                        {displayWhatColumn(e.description ?? null)}
                      </td>
                      <td className="p-3">{e.paid_using_label ?? "—"}</td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {formatMoneyAmount(Number(e.amount), currencyCode)}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">{e.vendors?.name || "—"}</td>
                      <td className="p-3 max-w-xs text-slate-700 text-xs" title={e.expense_gl_labels || undefined}>
                        {e.expense_gl_labels || "—"}
                      </td>
                      <td className="p-3 max-w-md truncate" title={e.description || undefined}>
                        {e.description || "—"}
                      </td>
                      <td className="p-3 text-right">{e.line_count ?? 0}</td>
                      <td className="p-3 text-right font-medium">{Number(e.amount).toFixed(2)}</td>
                    </>
                  )}
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => void openEditModal(e.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      title="Edit expense"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </td>
                  {expenseAttachmentsSupported ? (
                    <td className="p-3 align-top">
                      <SourceDocumentsCell
                        table="expenses"
                        recordId={e.id}
                        organizationId={orgId}
                        rawDocuments={e.source_documents}
                        onUpdated={() => void fetchData()}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && !fetchError && (
            <p className="p-8 text-center text-slate-500">
              {simpleExpenseMode
                ? "Nothing recorded in this range. Try \"All dates\" or widen the date filters."
                : "No expenses in this range. Try \"All dates\" or widen the date range."}
            </p>
          )}
          {!loading && expenses.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span className="tabular-nums">{paginationLabel}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!canPrevPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!canNextPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 py-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeModal();
          }}
        >
          <div
            className={`relative z-10 my-auto flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl max-h-[calc(100vh-1rem)] ${
              simpleExpenseMode ? "max-w-2xl" : "max-w-6xl"
            }`}
            onClick={(ev) => ev.stopPropagation()}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-900">
                  {simpleExpenseMode
                    ? editingExpenseId
                      ? "Edit spending"
                      : "Record money spent"
                    : editingExpenseId
                      ? "Edit spending"
                      : "Record expense"}
                </h2>
                <p className="text-xs text-slate-500 mt-1 leading-snug">
                  {simpleExpenseMode
                    ? "Enter what you bought, the amount, and how you paid. Categories map to your chart automatically."
                    : "Per line: vendor, source of funds, expense GL, VAT, and amounts."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!saving) closeModal();
                }}
                className="p-2 hover:bg-slate-100 rounded-lg shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editModalLoading ? (
              <p className="text-slate-600 py-8 text-center px-5">Loading expense…</p>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {simpleExpenseMode ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                        <input
                          type="date"
                          value={expenseDate}
                          onChange={(e) => setExpenseDate(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-xs"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Supplier (optional)</label>
                        <SearchableCombobox
                          value={simpleVendorId || ""}
                          onChange={(id) => setSimpleVendorId(id || null)}
                          options={vendorComboboxOptions}
                          placeholder="Search supplier…"
                          emptyOption={{ label: "No supplier" }}
                          inputAriaLabel="Supplier for this expense"
                        />
                      </div>
                      {orgId && vendors.length === 0 ? (
                        <div className="sm:col-span-2">
                          <p className="text-xs text-amber-700">No suppliers yet. Add them under Purchases → Vendors.</p>
                        </div>
                      ) : null}
                    </div>

                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What you spent</p>

                    <div className="space-y-3 mb-3">
                      {simpleLines.map((row, idx) => {
                        const t = simpleLineTotals[idx] ?? { net: 0, vat: 0, rowTotal: 0 };
                        return (
                          <div key={row.key} className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/40">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">What did you spend on?</label>
                              <input
                                type="text"
                                value={row.item}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const patch: Partial<SimpleExpenseLine> = { item: v };
                                  if (!row.typeLocked) {
                                    const g = guessCategoryFromItem(v);
                                    if (g) patch.category = g;
                                  }
                                  updateSimpleLine(row.key, patch);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                placeholder="e.g. Fuel for generator, staff salaries"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={row.amount}
                                onChange={(e) => updateSimpleLine(row.key, { amount: e.target.value })}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-right tabular-nums max-w-xs"
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Type of expense</label>
                              <select
                                value={row.category}
                                onChange={(e) =>
                                  updateSimpleLine(row.key, {
                                    category: e.target.value as SimpleCategory,
                                    typeLocked: true,
                                  })
                                }
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
                              >
                                {SIMPLE_EXPENSE_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {SIMPLE_EXPENSE_TYPE_LABELS[cat]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Paid using</label>
                              <select
                                value={row.payment_method}
                                onChange={(e) =>
                                  updateSimpleLine(row.key, {
                                    payment_method: e.target.value as PaymentMethodSimple,
                                  })
                                }
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px] max-w-xs"
                              >
                                <option value="cash">Cash</option>
                                <option value="bank">Bank</option>
                                <option value="mobile">Mobile money</option>
                              </select>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span className="text-slate-600">
                                Line total:{" "}
                                <span className="font-medium text-slate-900 tabular-nums">
                                  {formatMoneyAmount(t.rowTotal, currencyCode)}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => removeSimpleRow(row.key)}
                                disabled={simpleLines.length <= 1}
                                className="inline-flex items-center gap-1 text-red-600 text-sm hover:underline disabled:opacity-30 disabled:no-underline"
                              >
                                <Trash2 className="w-4 h-4" />
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={addSimpleRow}
                      className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 mb-3"
                    >
                      <Plus className="w-4 h-4" /> Add another item
                    </button>

                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => setShowSimpleDetails((v) => !v)}
                        className="text-sm font-medium text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline"
                      >
                        {showSimpleDetails ? "−" : "+"} Add more details (optional)
                      </button>
                      {showSimpleDetails ? (
                        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                          <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={simpleIncludeVat}
                              onChange={(e) => setSimpleIncludeVat(e.target.checked)}
                              onMouseDown={(ev) => ev.stopPropagation()}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            Include VAT (uses rate from Admin → Journal account settings)
                          </label>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                            <textarea
                              value={simpleNotes}
                              onChange={(e) => setSimpleNotes(e.target.value)}
                              onMouseDown={(e) => e.stopPropagation()}
                              rows={2}
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="Anything else to remember…"
                            />
                          </div>
                          {expenseAttachmentsSupported ? (
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Attachments (optional)</label>
                              {editingExpenseId && existingSourceDocuments.length > 0 ? (
                                <p className="text-xs text-slate-600 mb-2">
                                  Already saved: {existingSourceDocuments.map((d) => d.name || d.path).join(", ")}
                                </p>
                              ) : null}
                              <input
                                type="file"
                                multiple
                                accept="image/*,application/pdf,.doc,.docx"
                                className="w-full text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:px-2 file:py-1"
                                onChange={(e) => setExpenseAttachmentFiles(Array.from(e.target.files || []))}
                                onMouseDown={(e) => e.stopPropagation()}
                              />
                              {expenseAttachmentFiles.length > 0 ? (
                                <p className="text-xs text-slate-600 mt-1">
                                  New files: {expenseAttachmentFiles.map((f) => f.name).join(", ")}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 mb-2">
                      <p className="text-sm font-semibold text-slate-900">
                        Total:{" "}
                        <span className="tabular-nums">{formatMoneyAmount(simpleGrandTotal, currencyCode)}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {simpleIncludeVat
                          ? "VAT is split automatically in your books — you do not need to pick VAT accounts here."
                          : "Turn on VAT under “Add more details” if this purchase includes tax."}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                        <input
                          type="date"
                          value={expenseDate}
                          onChange={(e) => setExpenseDate(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">VAT % (for lines with VAT on)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={vatRatePercent}
                          onChange={(e) => setVatRatePercent(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-[10rem]"
                        />
                        <p className="text-xs text-slate-500 mt-1 max-w-md">
                          Initial rate comes from <strong className="font-medium text-slate-600">Admin → Journal account settings</strong>{" "}
                          (VAT defaults) when adding an expense; you can change it here.
                        </p>
                      </div>
                      {orgId && vendors.length === 0 && (
                        <div className="flex items-end">
                          <p className="text-xs text-amber-700">No vendors yet. Add them under Purchases → Vendors to tag lines.</p>
                        </div>
                      )}
                    </div>

                    {expenseAttachmentsSupported ? (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Attachments (optional)</label>
                        {editingExpenseId && existingSourceDocuments.length > 0 ? (
                          <p className="text-xs text-slate-600 mb-2">
                            Already saved: {existingSourceDocuments.map((d) => d.name || d.path).join(", ")}
                          </p>
                        ) : null}
                        <input
                          type="file"
                          multiple
                          accept="image/*,application/pdf,.doc,.docx"
                          className="w-full text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:px-2 file:py-1"
                          onChange={(e) => setExpenseAttachmentFiles(Array.from(e.target.files || []))}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                        {expenseAttachmentFiles.length > 0 ? (
                          <p className="text-xs text-slate-600 mt-1">New files: {expenseAttachmentFiles.map((f) => f.name).join(", ")}</p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="border border-slate-200 rounded-lg overflow-x-auto overflow-y-visible">
                      <table className="min-w-[1280px] w-full text-xs sm:text-sm [&_td]:overflow-visible [&_td]:relative">
                        <thead className="bg-slate-50 text-slate-700">
                          <tr>
                            <th className="text-left p-2 font-semibold min-w-[200px]">Vendor</th>
                            <th className="text-left p-2 font-semibold min-w-[160px]">Source of funds</th>
                            <th className="text-left p-2 font-semibold min-w-[160px]">Expense GL</th>
                            <th className="text-center p-2 font-semibold w-14" title="Apply VAT for this line">
                              VAT
                            </th>
                            <th className="text-right p-2 font-semibold w-28">Net (ex VAT)</th>
                            <th className="text-right p-2 font-semibold w-24">VAT amt</th>
                            <th className="text-right p-2 font-semibold w-24">Total</th>
                            <th className="text-left p-2 font-semibold min-w-[160px]">VAT GL</th>
                            <th className="w-10 p-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((row, lineIdx) => {
                            const t = lineTotals[lineIdx] ?? { net: 0, vat: 0, rowTotal: 0 };
                            return (
                              <Fragment key={row.key}>
                                <tr className="border-t border-slate-100 align-top">
                                  <td className="p-2 align-top">
                                    <SearchableCombobox
                                      value={row.vendor_id}
                                      onChange={(id) => updateLine(row.key, { vendor_id: id })}
                                      options={vendorComboboxOptions}
                                      placeholder="Search vendor…"
                                      emptyOption={{ label: "No vendor" }}
                                      inputAriaLabel="Vendor for this line"
                                      className="min-w-[200px]"
                                    />
                                  </td>
                                  <td className="p-2 align-top">
                                    <GlAccountPicker
                                      value={row.source_cash_gl_account_id}
                                      onChange={(id) => updateLine(row.key, { source_cash_gl_account_id: id })}
                                      options={cashSourceOptions}
                                      placeholder="Type code or name…"
                                    />
                                  </td>
                                  <td className="p-2 align-top">
                                    <GlAccountPicker
                                      value={row.expense_gl_account_id}
                                      onChange={(id) => updateLine(row.key, { expense_gl_account_id: id })}
                                      options={expenseGlOptions}
                                      placeholder="Type code or name…"
                                    />
                                  </td>
                                  <td className="p-2 text-center align-middle">
                                    <input
                                      type="checkbox"
                                      checked={row.vat_enabled}
                                      onChange={(e) => updateLine(row.key, { vat_enabled: e.target.checked })}
                                      onMouseDown={(ev) => ev.stopPropagation()}
                                      className="h-4 w-4 rounded border-slate-300"
                                      title="VAT on for this line"
                                      aria-label="VAT on for this line"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={row.amount}
                                      onChange={(e) => updateLine(row.key, { amount: e.target.value })}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm text-right"
                                      placeholder="0"
                                    />
                                  </td>
                                  <td className="p-2 text-right tabular-nums text-slate-700">{t.vat.toFixed(2)}</td>
                                  <td className="p-2 text-right tabular-nums font-medium text-slate-900">{t.rowTotal.toFixed(2)}</td>
                                  <td className="p-2 align-top">
                                    <GlAccountPicker
                                      value={row.vat_gl_account_id}
                                      onChange={(id) => updateLine(row.key, { vat_gl_account_id: id })}
                                      options={vatGlAccountOptions}
                                      placeholder="Type code or name…"
                                      emptyOption={{ label: "Same as expense" }}
                                    />
                                  </td>
                                  <td className="p-2 align-top">
                                    <button
                                      type="button"
                                      onClick={() => removeRow(row.key)}
                                      disabled={lines.length <= 1}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-30"
                                      title="Remove row"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
                      <button
                        type="button"
                        onClick={addRow}
                        className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50"
                      >
                        <Plus className="w-4 h-4" /> Add row
                      </button>
                      <div className="text-sm text-slate-800 text-right space-y-0.5">
                        <p className="text-slate-600">
                          Net (ex VAT): <span className="tabular-nums">{grandNet.toFixed(2)}</span>
                          {" · "}
                          VAT: <span className="tabular-nums">{grandVat.toFixed(2)}</span>
                        </p>
                        <p className="font-semibold">
                          Total outflow: <span className="tabular-nums">{grandTotal.toFixed(2)}</span>
                        </p>
                      </div>
                    </div>
                  </>
                )}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                  <button
                    type="button"
                    onClick={() => !saving && closeModal()}
                    className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || editModalLoading}
                    className="app-btn-primary px-5 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : editingExpenseId ? "Save changes" : "Save expense"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
