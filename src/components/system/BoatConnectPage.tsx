import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  KeyRound,
  LayoutGrid,
  Link2,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  Table2,
  UploadCloud,
} from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "@/contexts/AuthContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";

type ConnectorStatus = "Ready" | "Needs mapping" | "Syncing" | "Saved";
type SourceKind = "google_sheets" | "csv_excel" | "database" | "api";
type SourceMode = "google_sheets" | "file_upload";
type ReportView = "financial" | "operational" | "kpi" | "board_pack";
type ReportScope = "active" | "all";
type ImportFilter = "all" | "issues" | SaccoImportTarget;
type SaccoImportTarget =
  | "savings_deposit"
  | "savings_withdrawal"
  | "loan_repayment"
  | "loan_approval"
  | "loan_disbursement"
  | "loan_interest"
  | "ledger_fee"
  | "cashbook_review";
type BoatFieldType = "text" | "number" | "date";

type BoatField = {
  key: string;
  label: string;
  type: BoatFieldType;
  required?: boolean;
};

type RawRow = Record<string, string>;

type ValidationIssue = {
  row: number;
  field: string;
  message: string;
};

type WarehouseRecord = {
  sourceRecordId: string;
  sourceHash: string;
  syncedAt: string;
  sourceRowNumber?: number;
  connectorId?: string;
  connectorName?: string;
  sourceKind?: SourceKind;
  payload: Record<string, string | number | null>;
};

type ReportRow = {
  metric: string;
  segment: string;
  value: number | string;
  records: number;
};

type SaccoImportSuggestion = {
  target: SaccoImportTarget;
  label: string;
  page: string;
  pageHint: string;
  confidence: number;
  amount: number;
  records: WarehouseRecord[];
  reasons: string[];
};

type SavedConnector = {
  id: string;
  organizationId: string;
  name: string;
  sourceKind: SourceKind;
  spreadsheetId: string;
  sheetUrl: string;
  fileName?: string;
  sourceHeaders?: string[];
  sourceRows?: RawRow[];
  gid: string;
  tabName: string;
  cadence: string;
  mapping: Record<string, string>;
  lastSyncAt: string | null;
  lastSourceHashById: Record<string, string>;
  warehouse: WarehouseRecord[];
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

const STORAGE_KEY = "boat.connect.connectors.v1";
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

const BOAT_FIELDS: BoatField[] = [
  { key: "source_record_id", label: "Source record ID", type: "text", required: true },
  { key: "transaction_date", label: "Transaction date", type: "date", required: true },
  { key: "party_name", label: "Customer / member / party", type: "text", required: true },
  { key: "amount", label: "Amount", type: "number", required: true },
  { key: "debit_amount", label: "Withdrawal / debit", type: "number" },
  { key: "credit_amount", label: "Deposit / credit", type: "number" },
  { key: "reference", label: "Reference", type: "text" },
  { key: "branch_code", label: "Branch code", type: "text" },
  { key: "account_code", label: "Account / GL code", type: "text" },
  { key: "description", label: "Description", type: "text" },
  { key: "status", label: "Status", type: "text" },
];

const connectorCards = [
  {
    name: "Google Sheets",
    type: "Free shared-link import",
    status: "Ready" as ConnectorStatus,
    cadence: "Manual sync",
    records: "No client ID needed",
    icon: FileSpreadsheet,
  },
  {
    name: "CSV / Excel",
    type: "File import",
    status: "Ready" as ConnectorStatus,
    cadence: "Manual sync",
    records: ".csv, .xls, .xlsx",
    icon: UploadCloud,
  },
  {
    name: "Databases",
    type: "Postgres, MySQL, SQL Server",
    status: "Needs mapping" as ConnectorStatus,
    cadence: "Planned",
    records: "Read replicas",
    icon: Database,
  },
  {
    name: "External APIs",
    type: "REST / JSON endpoints",
    status: "Needs mapping" as ConnectorStatus,
    cadence: "Planned",
    records: "Polling / webhooks",
    icon: Link2,
  },
];

const reportViews: Array<{ id: ReportView; label: string }> = [
  { id: "financial", label: "Financial" },
  { id: "operational", label: "Operational" },
  { id: "kpi", label: "KPIs" },
  { id: "board_pack", label: "Board pack" },
];

const saccoTargetMeta: Record<SaccoImportTarget, { label: string; page: string; pageHint: string }> = {
  savings_deposit: {
    label: "Savings deposits",
    page: SACCOPRO_PAGE.teller,
    pageHint: "Teller - Receive money",
  },
  savings_withdrawal: {
    label: "Savings withdrawals",
    page: SACCOPRO_PAGE.teller,
    pageHint: "Teller - Give money",
  },
  loan_repayment: {
    label: "Loan repayments",
    page: SACCOPRO_PAGE.teller,
    pageHint: "Teller - Receive loan repayment",
  },
  loan_approval: {
    label: "Loan approvals",
    page: SACCOPRO_PAGE.loanApproval,
    pageHint: "Loans - Approvals",
  },
  loan_disbursement: {
    label: "Loan disbursements",
    page: SACCOPRO_PAGE.loanDisbursement,
    pageHint: "Loans - Disbursement",
  },
  loan_interest: {
    label: "Loan interest calculations",
    page: SACCOPRO_PAGE.loanInterestCalc,
    pageHint: "Loans - Interest calculation",
  },
  ledger_fee: {
    label: "Ledger fees and charges",
    page: SACCOPRO_PAGE.cashbook,
    pageHint: "Cashbook - Journal",
  },
  cashbook_review: {
    label: "Cashbook review",
    page: SACCOPRO_PAGE.cashbook,
    pageHint: "Cashbook - Journal",
  },
};

function statusClass(status: ConnectorStatus) {
  if (status === "Ready" || status === "Saved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Syncing") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function readConnectors(): SavedConnector[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedConnector[]) : [];
  } catch {
    return [];
  }
}

function writeConnectors(connectors: SavedConnector[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connectors));
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function rowsToObjects(rows: string[][]): { headers: string[]; rawRows: RawRow[] } {
  const headers = (rows[0] || []).map((h, index) => normalizeHeader(h) || `column_${index + 1}`);
  const rawRows = rows.slice(1).map((row) => {
    const obj: RawRow = {};
    headers.forEach((header, index) => {
      obj[header] = (row[index] || "").trim();
    });
    return obj;
  });
  return { headers, rawRows };
}

function normalizeGridRows(rows: unknown[][]): string[][] {
  return rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell).trim())));
}

async function readImportedFile(file: File): Promise<{ headers: string[]; rawRows: RawRow[]; sheetName: string }> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    const text = await file.text();
    return { ...rowsToObjects(parseCsv(text)), sheetName: "CSV" };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return { ...rowsToObjects(normalizeGridRows(rows)), sheetName };
}

function extractSheetInfo(urlOrId: string): { spreadsheetId: string; gid: string } {
  const trimmed = urlOrId.trim();
  const publishedMatch = trimmed.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || trimmed.match(/^([a-zA-Z0-9-_]{20,})$/);
  const gidMatch = trimmed.match(/[?&#]gid=(\d+)/);
  return {
    spreadsheetId: publishedMatch?.[1] || idMatch?.[1] || "",
    gid: gidMatch?.[1] || "0",
  };
}

function googleCsvUrl(spreadsheetId: string, gid: string) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(gid || "0")}`;
}

function googlePublishedCsvUrl(spreadsheetId: string, gid: string) {
  return `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(spreadsheetId)}/pub?output=csv&gid=${encodeURIComponent(gid || "0")}`;
}

async function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google Identity Services.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  });
}

async function fetchSheetTabs(spreadsheetId: string, accessToken: string) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets(properties(title,sheetId))`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Google Sheets tab lookup failed (${res.status}).`);
  const payload = (await res.json()) as { sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> };
  return (payload.sheets || []).map((s) => ({
    title: s.properties?.title || "Sheet",
    gid: String(s.properties?.sheetId ?? 0),
  }));
}

async function fetchSheetRows(args: {
  spreadsheetId: string;
  gid: string;
  tabName: string;
  accessToken: string | null;
}): Promise<{ headers: string[]; rawRows: RawRow[] }> {
  if (args.accessToken && args.tabName) {
    const range = encodeURIComponent(`${args.tabName}!A1:ZZ1000`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${range}`,
      { headers: { Authorization: `Bearer ${args.accessToken}` } }
    );
    if (!res.ok) throw new Error(`Google Sheets read failed (${res.status}).`);
    const payload = (await res.json()) as { values?: string[][] };
    return rowsToObjects(payload.values || []);
  }

  const csvUrl = args.spreadsheetId.startsWith("2PACX-")
    ? googlePublishedCsvUrl(args.spreadsheetId, args.gid)
    : googleCsvUrl(args.spreadsheetId, args.gid);
  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      "Could not read the Google Sheet for free. Share it with anyone who has the link as Viewer, or publish it to the web as CSV."
    );
  }
  return rowsToObjects(parseCsv(await res.text()));
}

function inferMapping(headers: string[]): Record<string, string> {
  const aliases: Record<string, string[]> = {
    source_record_id: ["id", "record_id", "source_id", "transaction_id", "txn_id", "reference", "receipt_no"],
    transaction_date: ["date", "txn_date", "transaction_date", "payment_date", "created_at"],
    party_name: ["name", "member", "member_name", "customer", "customer_name", "party", "client"],
    amount: ["amount", "paid", "amount_paid", "balance", "value", "net_amount", "transaction_amount"],
    debit_amount: ["debit", "dr", "withdrawal", "withdrawals", "money_out", "cash_out", "payment_out", "paid_out"],
    credit_amount: ["credit", "cr", "deposit", "deposits", "money_in", "cash_in", "receipt", "receipts", "payment_in"],
    reference: ["reference", "ref", "receipt", "receipt_no", "voucher"],
    branch_code: ["branch", "branch_code", "office"],
    account_code: ["account", "account_code", "gl", "gl_code"],
    description: ["description", "details", "narration", "memo", "notes"],
    status: ["status", "state"],
  };
  const mapping: Record<string, string> = {};
  BOAT_FIELDS.forEach((field) => {
    const hit = headers.find((h) => aliases[field.key]?.includes(h));
    if (hit) mapping[field.key] = hit;
  });
  return mapping;
}

function hashRecord(value: unknown) {
  const input = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function parseNumber(value: string) {
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function amountOf(record: WarehouseRecord) {
  return Number(record.payload.amount) || 0;
}

function debitOf(record: WarehouseRecord) {
  return Number(record.payload.debit_amount) || 0;
}

function creditOf(record: WarehouseRecord) {
  return Number(record.payload.credit_amount) || 0;
}

function textOf(value: string | number | null | undefined, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function joinedRecordText(record: WarehouseRecord) {
  return [
    record.payload.description,
    record.payload.reference,
    record.payload.account_code,
    record.payload.status,
    record.payload.branch_code,
    record.payload.party_name,
    record.payload.debit_amount ? "debit money out withdrawal" : "",
    record.payload.credit_amount ? "credit money in deposit" : "",
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function classifySaccoRecord(record: WarehouseRecord): { target: SaccoImportTarget; confidence: number; reason: string } {
  const text = joinedRecordText(record);
  const amount = amountOf(record);
  const debit = debitOf(record);
  const credit = creditOf(record);

  if (/\b(loan approval|approved loan|loan application approved|credit approval|approved)\b/.test(text)) {
    return { target: "loan_approval", confidence: 92, reason: "loan approval wording" };
  }
  if (/\b(disburse|disbursement|loan paid out|loan payout|released loan|loan release)\b/.test(text)) {
    return { target: "loan_disbursement", confidence: 90, reason: "loan disbursement wording" };
  }
  if (/\b(interest calc|interest calculation|interest accrued|loan interest|interest income)\b/.test(text)) {
    return { target: "loan_interest", confidence: 88, reason: "interest calculation wording" };
  }
  if (/\b(loan repayment|repayment|installment|instalment|principal paid|loan paid|loan recovery)\b/.test(text)) {
    return { target: "loan_repayment", confidence: 91, reason: "loan repayment wording" };
  }
  if (/\b(withdraw|withdrawal|cash out|paid out|member payout|savings payout)\b/.test(text)) {
    return { target: "savings_withdrawal", confidence: 86, reason: "withdrawal wording" };
  }
  if (/\b(deposit|saving|savings|cash in|member contribution|share deposit|shares|member deposit)\b/.test(text)) {
    return { target: "savings_deposit", confidence: 84, reason: "deposit/savings wording" };
  }
  if (/\b(fee|fees|charge|charges|ledger|penalty|commission|application fee|processing fee)\b/.test(text)) {
    return { target: "ledger_fee", confidence: 82, reason: "fee or ledger charge wording" };
  }
  if (amount < 0) {
    return { target: "savings_withdrawal", confidence: 58, reason: "negative amount" };
  }
  if (debit > 0 && debit >= credit) {
    return { target: "savings_withdrawal", confidence: 66, reason: "debit / money out column" };
  }
  if (credit > 0 && credit > debit) {
    return { target: "savings_deposit", confidence: 64, reason: "credit / money in column" };
  }
  if (amount > 0) {
    return { target: "cashbook_review", confidence: 50, reason: "positive cashbook amount" };
  }
  return { target: "cashbook_review", confidence: 45, reason: "unclassified cashbook row" };
}

function buildSaccoSuggestions(records: WarehouseRecord[]): SaccoImportSuggestion[] {
  const grouped = new Map<SaccoImportTarget, SaccoImportSuggestion>();
  records.forEach((record) => {
    const classified = classifySaccoRecord(record);
    const meta = saccoTargetMeta[classified.target];
    const current =
      grouped.get(classified.target) ||
      ({
        target: classified.target,
        label: meta.label,
        page: meta.page,
        pageHint: meta.pageHint,
        confidence: 0,
        amount: 0,
        records: [],
        reasons: [],
      } satisfies SaccoImportSuggestion);
    current.records.push(record);
    current.amount += amountOf(record);
    current.confidence += classified.confidence;
    if (!current.reasons.includes(classified.reason)) current.reasons.push(classified.reason);
    grouped.set(classified.target, current);
  });
  return Array.from(grouped.values())
    .map((suggestion) => ({
      ...suggestion,
      confidence: suggestion.records.length ? Math.round(suggestion.confidence / suggestion.records.length) : 0,
    }))
    .sort((a, b) => b.records.length - a.records.length || b.confidence - a.confidence);
}

function importFilterLabel(filter: ImportFilter) {
  if (filter === "all") return "All imported transactions";
  if (filter === "issues") return "Rows with validation issues";
  return saccoTargetMeta[filter].label;
}

function aggregateBy(
  records: WarehouseRecord[],
  field: keyof WarehouseRecord["payload"],
  fallback: string,
  metric: string
): ReportRow[] {
  const grouped = new Map<string, { value: number; records: number }>();
  records.forEach((record) => {
    const segment = textOf(record.payload[field], fallback);
    const current = grouped.get(segment) || { value: 0, records: 0 };
    current.value += amountOf(record);
    current.records += 1;
    grouped.set(segment, current);
  });
  return Array.from(grouped.entries())
    .map(([segment, row]) => ({ metric, segment, value: row.value, records: row.records }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

function aggregateBySource(records: WarehouseRecord[]): ReportRow[] {
  const grouped = new Map<string, { value: number; records: number }>();
  records.forEach((record) => {
    const segment = record.connectorName || (record.sourceKind === "csv_excel" ? "Excel / CSV source" : "Google Sheets source");
    const current = grouped.get(segment) || { value: 0, records: 0 };
    current.value += amountOf(record);
    current.records += 1;
    grouped.set(segment, current);
  });
  return Array.from(grouped.entries())
    .map(([segment, row]) => ({ metric: "Amount by connected source", segment, value: row.value, records: row.records }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportRowsToCsv(rows: ReportRow[]) {
  const csvRows = [["Metric", "Segment", "Value", "Records"], ...rows.map((r) => [r.metric, r.segment, r.value, r.records])];
  return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function transformRows(rawRows: RawRow[], mapping: Record<string, string>) {
  const issues: ValidationIssue[] = [];
  const records: WarehouseRecord[] = [];
  const seenIds = new Set<string>();

  rawRows.forEach((row, rowIndex) => {
    const payload: Record<string, string | number | null> = {};
    BOAT_FIELDS.forEach((field) => {
      const sourceColumn = mapping[field.key];
      const raw = sourceColumn ? row[sourceColumn] || "" : "";
      const hasDebitOrCredit =
        field.key === "amount" &&
        Boolean((mapping.debit_amount && row[mapping.debit_amount]?.trim()) || (mapping.credit_amount && row[mapping.credit_amount]?.trim()));
      if (field.required && !raw.trim() && !hasDebitOrCredit) {
        issues.push({ row: rowIndex + 2, field: field.label, message: "Required value is missing." });
      }
      if (field.type === "number") {
        const n = raw ? parseNumber(raw) : null;
        if (raw && n === null) issues.push({ row: rowIndex + 2, field: field.label, message: "Must be numeric." });
        payload[field.key] = n;
      } else if (field.type === "date") {
        const d = raw ? parseDate(raw) : null;
        if (raw && d === null) issues.push({ row: rowIndex + 2, field: field.label, message: "Invalid date." });
        payload[field.key] = d;
      } else {
        payload[field.key] = raw || null;
      }
    });

    const debit = Number(payload.debit_amount) || 0;
    const credit = Number(payload.credit_amount) || 0;
    if ((debit || credit) && payload.amount === null) {
      payload.amount = credit - debit;
    }
    payload.transaction_direction = debit > credit ? "debit" : credit > debit ? "credit" : "neutral";

    const sourceRecordId = String(payload.source_record_id || `row_${rowIndex + 2}`);
    if (seenIds.has(sourceRecordId)) {
      issues.push({ row: rowIndex + 2, field: "Source record ID", message: "Duplicate source record ID." });
    }
    seenIds.add(sourceRecordId);
    records.push({
      sourceRecordId,
      sourceHash: hashRecord(payload),
      syncedAt: new Date().toISOString(),
      sourceRowNumber: rowIndex + 2,
      payload,
    });
  });

  return { issues, records };
}

export function BoatConnectPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const organizationId = user?.organization_id || "local";
  const [connectors, setConnectors] = useState<SavedConnector[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>("google_sheets");
  const [connectorName, setConnectorName] = useState("BOAT Connect import");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [gid, setGid] = useState("0");
  const [tabName, setTabName] = useState("");
  const [tabs, setTabs] = useState<Array<{ title: string; gid: string }>>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseRecord[]>([]);
  const [reportView, setReportView] = useState<ReportView>("financial");
  const [reportScope, setReportScope] = useState<ReportScope>("all");
  const [importFilter, setImportFilter] = useState<ImportFilter>("all");
  const [activeConnectorId, setActiveConnectorId] = useState<string>("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConnectors(readConnectors().filter((c) => c.organizationId === organizationId));
  }, [organizationId]);

  useEffect(() => {
    const info = extractSheetInfo(sheetUrl);
    setSpreadsheetId(info.spreadsheetId);
    setGid(info.gid);
  }, [sheetUrl]);

  const savedConnector = connectors.find((c) => c.id === activeConnectorId) || null;
  const validCount = Math.max(0, rawRows.length - new Set(issues.map((i) => i.row)).size);
  const changedCount = useMemo(() => {
    const previous = savedConnector?.lastSourceHashById || {};
    return warehouse.filter((r) => previous[r.sourceRecordId] !== r.sourceHash).length;
  }, [savedConnector, warehouse]);
  const combinedWarehouse = useMemo<WarehouseRecord[]>(
    () => {
      const savedRows = connectors.flatMap((connector) =>
        ((connector.id === activeConnectorId && warehouse.length > 0 ? warehouse : connector.warehouse) || []).map((record) => ({
          ...record,
          connectorId: connector.id,
          connectorName: connector.name,
          sourceKind: connector.sourceKind,
          sourceRecordId: `${connector.id}:${record.sourceRecordId}`,
        }))
      );
      if (!activeConnectorId && warehouse.length > 0) {
        return [
          ...savedRows,
          ...warehouse.map((record) => ({
            ...record,
            connectorId: "draft",
            connectorName: connectorName.trim() || "Current import",
            sourceKind: sourceMode === "file_upload" ? ("csv_excel" as SourceKind) : ("google_sheets" as SourceKind),
            sourceRecordId: `draft:${record.sourceRecordId}`,
          })),
        ];
      }
      return savedRows;
    },
    [activeConnectorId, connectorName, connectors, sourceMode, warehouse]
  );
  const syncedConnectorCount = useMemo(
    () =>
      new Set(
        combinedWarehouse
          .filter((record) => record.connectorId)
          .map((record) => record.connectorId)
      ).size,
    [combinedWarehouse]
  );
  const reportingWarehouse = reportScope === "all" ? combinedWarehouse : warehouse;
  const reportTotals = useMemo(() => {
    const amount = reportingWarehouse.reduce((sum, row) => sum + (Number(row.payload.amount) || 0), 0);
    const parties = new Set(reportingWarehouse.map((r) => String(r.payload.party_name || "")).filter(Boolean)).size;
    const dates = reportingWarehouse.map((r) => String(r.payload.transaction_date || "")).filter(Boolean).sort();
    return { amount, parties, fromDate: dates[0] || "-", toDate: dates[dates.length - 1] || "-" };
  }, [reportingWarehouse]);
  const activeReportRows = useMemo<ReportRow[]>(() => {
    if (reportView === "financial") {
      return aggregateBy(reportingWarehouse, "account_code", "Unmapped account", "Amount by account / GL code");
    }
    if (reportView === "operational") {
      const branchRows = aggregateBy(reportingWarehouse, "branch_code", "Unmapped branch", "Amount by branch");
      const sourceRows = aggregateBySource(reportingWarehouse);
      return [...branchRows, ...sourceRows];
    }
    if (reportView === "kpi") {
      const average = reportingWarehouse.length ? reportTotals.amount / reportingWarehouse.length : 0;
      return [
        { metric: "Connected sources", segment: reportScope === "all" ? "Saved connectors and current import" : "Active connector", value: reportScope === "all" ? syncedConnectorCount : Number(Boolean(warehouse.length)), records: reportingWarehouse.length },
        { metric: "Total amount", segment: "All synchronized records", value: reportTotals.amount, records: reportingWarehouse.length },
        { metric: "Average amount", segment: "Per reporting row", value: average, records: reportingWarehouse.length },
        { metric: "Unique parties", segment: "Customers / members / parties", value: reportTotals.parties, records: reportingWarehouse.length },
        { metric: "Reporting period", segment: `${reportTotals.fromDate} to ${reportTotals.toDate}`, value: reportingWarehouse.length ? "Active" : "No data", records: reportingWarehouse.length },
      ];
    }
    return [
      { metric: "Executive summary", segment: "Warehouse rows", value: reportingWarehouse.length, records: reportingWarehouse.length },
      { metric: "Connected sources", segment: reportScope === "all" ? "Saved connectors and current import" : "Active connector only", value: reportScope === "all" ? syncedConnectorCount : Number(Boolean(warehouse.length)), records: reportingWarehouse.length },
      { metric: "Financial position", segment: "Total amount", value: reportTotals.amount, records: reportingWarehouse.length },
      { metric: "Operating coverage", segment: "Unique parties", value: reportTotals.parties, records: reportingWarehouse.length },
      { metric: "Reporting period", segment: `${reportTotals.fromDate} to ${reportTotals.toDate}`, value: reportingWarehouse.length ? "Ready" : "No data", records: reportingWarehouse.length },
    ];
  }, [reportScope, reportTotals, reportView, reportingWarehouse, syncedConnectorCount, warehouse]);
  const saccoSuggestions = useMemo(() => buildSaccoSuggestions(warehouse), [warehouse]);
  const filteredWarehouse = useMemo(() => {
    if (importFilter === "all") return warehouse;
    if (importFilter === "issues") {
      const issueRows = new Set(issues.map((issue) => issue.row));
      return warehouse.filter((record) => issueRows.has(record.sourceRowNumber || 0));
    }
    return warehouse.filter((record) => classifySaccoRecord(record).target === importFilter);
  }, [importFilter, issues, warehouse]);

  const saveAllConnectors = (nextForOrg: SavedConnector[]) => {
    const others = readConnectors().filter((c) => c.organizationId !== organizationId);
    writeConnectors([...others, ...nextForOrg]);
    setConnectors(nextForOrg);
  };

  const resetImportDraft = (mode: SourceMode = sourceMode) => {
    setSourceMode(mode);
    setConnectorName("BOAT Connect import");
    setSheetUrl("");
    setFileName("");
    setSpreadsheetId("");
    setGid("0");
    setTabName("");
    setTabs([]);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setIssues([]);
    setWarehouse([]);
    setImportFilter("all");
    setActiveConnectorId("");
    setFileInputKey((value) => value + 1);
  };

  const downloadActiveReport = () => {
    if (activeReportRows.length === 0) return;
    const blob = new Blob([reportRowsToCsv(activeReportRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `boat-connect-${reportScope}-${reportView}-report.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openSaccoPage = (page: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", page);
    window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const applyLoadedRows = (loaded: { headers: string[]; rawRows: RawRow[] }) => {
    const nextMapping = { ...inferMapping(loaded.headers), ...mapping };
    const planned = transformRows(loaded.rawRows, nextMapping);
    setHeaders(loaded.headers);
    setRawRows(loaded.rawRows);
    setMapping(nextMapping);
    setIssues(planned.issues);
    setWarehouse(planned.records);
    setImportFilter("all");
    return { loaded, mapping: nextMapping, planned };
  };

  const connectGoogle = async () => {
    setError(null);
    setMessage(null);
    if (!GOOGLE_CLIENT_ID) {
      setMessage("Free mode is ready. Paste a shared or published Google Sheet link and preview it; OAuth is only for private Sheets.");
      return;
    }
    setBusy(true);
    try {
      await loadGoogleIdentityScript();
      const client = window.google?.accounts?.oauth2?.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
        callback: (response) => {
          if (response.error || !response.access_token) {
            setError(response.error || "Google sign-in did not return an access token.");
          } else {
            setAccessToken(response.access_token);
            setMessage("Google Sheets connected for this session.");
          }
          setBusy(false);
        },
      });
      client?.requestAccessToken({ prompt: "consent" });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not start Google connection.");
    }
  };

  const loadTabs = async () => {
    if (!spreadsheetId) return setError("Paste a valid Google Sheet URL or spreadsheet ID.");
    if (!accessToken) return setMessage("Free mode uses the gid in the Sheet URL. OAuth tab lookup is only needed for private Sheets.");
    setBusy(true);
    setError(null);
    try {
      const loadedTabs = await fetchSheetTabs(spreadsheetId, accessToken);
      setTabs(loadedTabs);
      if (loadedTabs[0]) {
        setTabName(loadedTabs[0].title);
        setGid(loadedTabs[0].gid);
      }
      setMessage(`Loaded ${loadedTabs.length} sheet tab(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sheet tabs.");
    } finally {
      setBusy(false);
    }
  };

  const changeSourceMode = (mode: SourceMode) => {
    setSourceMode(mode);
    setError(null);
    setMessage(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setIssues([]);
    setWarehouse([]);
    setImportFilter("all");
    setActiveConnectorId("");
    if (mode === "google_sheets") {
      setFileName("");
    } else {
      setSheetUrl("");
      setSpreadsheetId("");
      setGid("0");
      setTabName("");
      setTabs([]);
    }
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file || readOnly) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const loaded = await readImportedFile(file);
      setSourceMode("file_upload");
      setFileName(file.name);
      setConnectorName((prev) => (prev && prev !== "BOAT Connect import" ? prev : file.name.replace(/\.[^.]+$/, "")));
      const result = applyLoadedRows(loaded);
      setMessage(
        `Imported ${file.name}: ${result.loaded.rawRows.length} row(s), ${result.loaded.headers.length} column(s) from ${loaded.sheetName}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import the selected file.");
    } finally {
      setBusy(false);
    }
  };

  const loadPreviewData = async () => {
    if (sourceMode === "file_upload") {
      if (rawRows.length === 0) throw new Error("Upload an Excel or CSV file before previewing.");
      return applyLoadedRows({ headers, rawRows });
    }
    if (!spreadsheetId) throw new Error("Paste a valid Google Sheet URL or spreadsheet ID.");
    const loaded = await fetchSheetRows({ spreadsheetId, gid, tabName, accessToken });
    return applyLoadedRows(loaded);
  };

  const preview = async () => {
    if (sourceMode === "google_sheets" && !spreadsheetId) return setError("Paste a valid Google Sheet URL or spreadsheet ID.");
    if (sourceMode === "file_upload" && rawRows.length === 0) return setError("Upload an Excel or CSV file first.");
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await loadPreviewData();
      if (result) {
        setMessage(`Preview loaded: ${result.loaded.rawRows.length} row(s), ${result.loaded.headers.length} column(s).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview source data.");
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    const planned = transformRows(rawRows, mapping);
    setIssues(planned.issues);
    setWarehouse(planned.records);
    setMessage(
      planned.issues.length
        ? `Validation found ${planned.issues.length} issue(s).`
        : `Validation passed for ${planned.records.length} row(s).`
    );
  };

  const saveConnector = () => {
    if (readOnly) return;
    if (rawRows.length === 0) {
      return setError(
        sourceMode === "file_upload"
          ? "Upload and preview an Excel or CSV file before saving."
          : "Paste and preview a Google Sheet before saving."
      );
    }
    const planned = transformRows(rawRows, mapping);
    setIssues(planned.issues);
    setWarehouse(planned.records);
    if (planned.issues.length) {
      setMessage("Save paused until validation issues are fixed.");
      return;
    }
    const nextHashById = Object.fromEntries(planned.records.map((r) => [r.sourceRecordId, r.sourceHash]));
    const nextId = activeConnectorId || crypto.randomUUID();
    const next: SavedConnector = {
      id: nextId,
      organizationId,
      name: connectorName.trim() || (sourceMode === "file_upload" ? "File import" : "Google Sheets import"),
      sourceKind: sourceMode === "file_upload" ? "csv_excel" : "google_sheets",
      spreadsheetId,
      sheetUrl,
      fileName,
      sourceHeaders: headers,
      sourceRows: rawRows,
      gid,
      tabName,
      cadence: "manual",
      mapping,
      lastSyncAt: new Date().toISOString(),
      lastSourceHashById: nextHashById,
      warehouse: planned.records,
    };
    const nextConnectors = connectors.filter((c) => c.id !== next.id).concat(next);
    saveAllConnectors(nextConnectors);
    resetImportDraft(sourceMode);
    setReportScope("all");
    setMessage(`Connector "${next.name}" saved with ${planned.records.length} reporting row(s). You can add another file or sheet now.`);
  };

  const runSync = async () => {
    if (readOnly) return;
    if (sourceMode === "google_sheets" && !spreadsheetId) return setError("Paste and preview a Google Sheet before syncing.");
    if (sourceMode === "file_upload" && rawRows.length === 0) return setError("Upload and preview an Excel or CSV file before syncing.");
    setBusy(true);
    setError(null);
    setMessage(null);
    let result: Awaited<ReturnType<typeof loadPreviewData>> | undefined;
    try {
      result = await loadPreviewData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read source data for sync.");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result) return;
    const { planned, mapping: syncMapping } = result;
    if (planned.issues.length) {
      setIssues(planned.issues);
      setMessage("Sync paused until validation issues are fixed.");
      return;
    }
    const previous = savedConnector?.lastSourceHashById || {};
    const changed = planned.records.filter((r) => previous[r.sourceRecordId] !== r.sourceHash);
    const nextHashById = Object.fromEntries(planned.records.map((r) => [r.sourceRecordId, r.sourceHash]));
    const nextConnector: SavedConnector = {
      id: savedConnector?.id || activeConnectorId || crypto.randomUUID(),
      organizationId,
      name: connectorName.trim() || (sourceMode === "file_upload" ? "File import" : "Google Sheets import"),
      sourceKind: sourceMode === "file_upload" ? "csv_excel" : "google_sheets",
      spreadsheetId,
      sheetUrl,
      fileName,
      sourceHeaders: headers,
      sourceRows: rawRows,
      gid,
      tabName,
      cadence: "manual",
      mapping: syncMapping,
      lastSyncAt: new Date().toISOString(),
      lastSourceHashById: nextHashById,
      warehouse: planned.records,
    };
    const nextConnectors = connectors.filter((c) => c.id !== nextConnector.id).concat(nextConnector);
    saveAllConnectors(nextConnectors);
    setActiveConnectorId(nextConnector.id);
    setWarehouse(planned.records);
    setMessage(`Sync complete: ${changed.length} new or changed record(s), ${planned.records.length} reporting row(s).`);
  };

  const loadConnector = (connector: SavedConnector) => {
    setActiveConnectorId(connector.id);
    setSourceMode(connector.sourceKind === "csv_excel" ? "file_upload" : "google_sheets");
    setConnectorName(connector.name);
    setSheetUrl(connector.sheetUrl);
    setFileName(connector.fileName || "");
    setSpreadsheetId(connector.spreadsheetId);
    setGid(connector.gid);
    setTabName(connector.tabName);
    setHeaders(connector.sourceHeaders || []);
    setRawRows(connector.sourceRows || []);
    setMapping(connector.mapping);
    setWarehouse(connector.warehouse);
    setIssues(transformRows(connector.sourceRows || [], connector.mapping).issues);
    setImportFilter("all");
    setMessage(`Loaded connector "${connector.name}".`);
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
              <Link2 className="h-4 w-4" />
              BOAT Connect
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-normal text-slate-950 sm:text-3xl">
              Imports, mapping, synchronization, and reporting warehouse
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Import Excel, CSV, or Google Sheets data, map source columns into BOAT fields, validate records, sync only
              new or changed rows, and publish a reporting-ready dataset for financial reports, dashboards, KPIs, and
              board packs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={connectGoogle}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" />
              {accessToken ? "Google connected" : "Private Sheet sign-in"}
            </button>
            <button
              type="button"
              onClick={runSync}
              disabled={readOnly || busy || rawRows.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              Run sync
            </button>
          </div>
        </header>

        {message || error ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || message}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {connectorCards.map((connector) => {
            const Icon = connector.icon;
            return (
              <article key={connector.name} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-md bg-slate-100 p-2">
                    <Icon className="h-5 w-5 text-slate-700" />
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(connector.status)}`}>
                    {connector.status}
                  </span>
                </div>
                <h2 className="mt-3 text-base font-bold text-slate-950">{connector.name}</h2>
                <p className="text-sm text-slate-600">{connector.type}</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 p-2">
                    <div className="font-semibold text-slate-900">{connector.cadence}</div>
                    <div className="text-slate-500">Cadence</div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <div className="font-semibold text-slate-900">{connector.records}</div>
                    <div className="text-slate-500">Scope</div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-slate-700" />
                  <h2 className="text-lg font-bold text-slate-950">1. Choose source data</h2>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  File or free link
                </span>
              </div>
              <div className="mt-4 rounded-md border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900">
                Upload an Excel/CSV file or paste a shared Google Sheet link. BOAT Connect will read the columns, then
                you map them into BOAT fields without coding.
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => changeSourceMode("file_upload")}
                    className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                      sourceMode === "file_upload"
                        ? "border-sky-300 bg-sky-50 text-sky-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <UploadCloud className="h-4 w-4" />
                    Excel / CSV file
                  </button>
                  <button
                    type="button"
                    onClick={() => changeSourceMode("google_sheets")}
                    className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                      sourceMode === "google_sheets"
                        ? "border-sky-300 bg-sky-50 text-sky-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Google Sheets link
                  </button>
                </div>
                <label className="block text-sm font-semibold text-slate-700">
                  Connector name
                  <input
                    value={connectorName}
                    onChange={(e) => setConnectorName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    disabled={readOnly}
                  />
                </label>
                {sourceMode === "file_upload" ? (
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      Excel or CSV file
                      <input
                        key={fileInputKey}
                        type="file"
                        accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                        onChange={(e) => void handleFileUpload(e.target.files?.[0] || null)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
                        disabled={readOnly || busy}
                      />
                    </label>
                    {fileName ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Imported file: <span className="font-semibold">{fileName}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <label className="block text-sm font-semibold text-slate-700">
                      Shared or published Google Sheet URL
                      <input
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0 or /spreadsheets/d/e/.../pub"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        disabled={readOnly}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-semibold text-slate-700">
                        Sheet gid
                        <input
                          value={gid}
                          onChange={(e) => setGid(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        Private Sheet tab name
                        <select
                          value={tabName}
                          onChange={(e) => {
                            const next = tabs.find((t) => t.title === e.target.value);
                            setTabName(e.target.value);
                            if (next) setGid(next.gid);
                          }}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">Use gid from free link</option>
                          {tabs.map((tab) => (
                            <option key={tab.gid} value={tab.title}>
                              {tab.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {sourceMode === "google_sheets" ? (
                    <button
                      type="button"
                      onClick={loadTabs}
                      disabled={busy || !spreadsheetId || !accessToken}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                    >
                      <LayoutGrid className="h-4 w-4" />
                      Load private tabs
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={preview}
                    disabled={busy || (sourceMode === "google_sheets" ? !spreadsheetId : rawRows.length === 0)}
                    className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Preview columns
                  </button>
                  <button
                    type="button"
                    onClick={() => resetImportDraft(sourceMode)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    <UploadCloud className="h-4 w-4" />
                    New connector
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center gap-2">
                <Save className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-bold text-slate-950">Saved connectors</h2>
              </div>
              <div className="mt-4 space-y-2">
                {connectors.length === 0 ? (
                  <p className="text-sm text-slate-500">No saved BOAT Connect sources yet.</p>
                ) : (
                  connectors.map((connector) => (
                    <button
                      key={connector.id}
                      type="button"
                      onClick={() => loadConnector(connector)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                        connector.id === activeConnectorId
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-semibold">{connector.name}</div>
                      <div className="text-xs text-slate-500">
                        {connector.sourceKind === "csv_excel" ? connector.fileName || "Excel / CSV file" : "Google Sheets"}
                        {" - "}
                        Last sync: {connector.lastSyncAt ? new Date(connector.lastSyncAt).toLocaleString() : "Not yet"}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">2. Field mapping</h2>
                  <p className="text-sm text-slate-600">Map imported columns into BOAT fields without code.</p>
                </div>
                <Settings2 className="h-5 w-5 text-slate-500" />
              </div>
              <div className="mt-4 grid gap-2">
                {BOAT_FIELDS.map((field) => (
                  <label key={field.key} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1.2fr]">
                    <span className="text-sm font-semibold text-slate-700">
                      {field.label}
                      {field.required ? <span className="text-red-600"> *</span> : null}
                      {field.key === "amount" ? (
                        <span className="block text-xs font-normal text-slate-500">Optional when deposit / credit or withdrawal / debit is mapped.</span>
                      ) : null}
                    </span>
                    <select
                      value={mapping[field.key] || ""}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={validate}
                  disabled={rawRows.length === 0}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Validate
                </button>
                  <button
                    type="button"
                    onClick={saveConnector}
                    disabled={readOnly || rawRows.length === 0}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    Save and add another
                  </button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">3. Validation and incremental sync</h2>
                  <p className="text-sm text-slate-600">Only clean, new, or changed records move into the warehouse.</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setImportFilter("all")}
                  className={`rounded-md border p-3 text-left ${
                    importFilter === "all" ? "border-slate-500 bg-slate-100" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-xl font-bold text-slate-900">{rawRows.length}</div>
                  <div className="text-xs font-semibold text-slate-500">Source rows</div>
                </button>
                <button
                  type="button"
                  onClick={() => setImportFilter("all")}
                  className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-left hover:bg-emerald-100"
                >
                  <div className="text-xl font-bold text-emerald-700">{validCount}</div>
                  <div className="text-xs font-semibold text-emerald-700">Valid rows</div>
                </button>
                <button
                  type="button"
                  onClick={() => setImportFilter("issues")}
                  className={`rounded-md border p-3 text-left ${
                    importFilter === "issues" ? "border-red-500 bg-red-100" : "border-red-200 bg-red-50 hover:bg-red-100"
                  }`}
                >
                  <div className="text-xl font-bold text-red-700">{issues.length}</div>
                  <div className="text-xs font-semibold text-red-700">Issues</div>
                </button>
                <button
                  type="button"
                  onClick={() => setImportFilter("all")}
                  className="rounded-md border border-sky-200 bg-sky-50 p-3 text-left hover:bg-sky-100"
                >
                  <div className="text-xl font-bold text-sky-700">{changedCount}</div>
                  <div className="text-xs font-semibold text-sky-700">New / changed</div>
                </button>
              </div>
              {issues.length > 0 ? (
                <div className="mt-4 max-h-48 overflow-auto rounded-md border border-red-100">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-red-50 text-xs uppercase text-red-700">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Field</th>
                        <th className="px-3 py-2">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.slice(0, 30).map((issue, index) => (
                        <tr key={`${issue.row}-${issue.field}-${index}`} className="border-t border-red-100">
                          <td className="px-3 py-2">{issue.row}</td>
                          <td className="px-3 py-2">{issue.field}</td>
                          <td className="px-3 py-2">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">SACCO import suggestions</h2>
                  <p className="text-sm text-slate-600">
                    BOAT reads the imported cashbook-style rows and suggests which SACCO page should review each group.
                  </p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
                Suggestions do not post transactions automatically. Review each group before importing into deposits,
                withdrawals, loan repayments, approvals, interest, fees, or the cashbook.
              </div>
              <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Suggested BOAT page</th>
                      <th className="px-3 py-2 text-right">Rows</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">Confidence</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saccoSuggestions.map((suggestion) => (
                      <tr key={suggestion.target} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{suggestion.label}</div>
                          <div className="text-xs text-slate-500">{suggestion.pageHint}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {suggestion.records.length.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">
                          {suggestion.amount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                            {suggestion.confidence}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{suggestion.reasons.slice(0, 2).join(", ")}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setImportFilter(suggestion.target)}
                              className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                                importFilter === suggestion.target
                                  ? "border-sky-700 bg-sky-700 text-white"
                                  : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                              }`}
                            >
                              Filter rows
                            </button>
                          <button
                            type="button"
                            onClick={() => openSaccoPage(suggestion.page)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Review page
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {saccoSuggestions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          Import and map a cashbook, loan, or savings file to see SACCO page suggestions.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {saccoSuggestions.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {saccoSuggestions.slice(0, 4).map((suggestion) => {
                    const sample = suggestion.records[0];
                    return (
                      <div key={`${suggestion.target}-sample`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div className="font-semibold text-slate-800">{suggestion.label} sample</div>
                        <div className="mt-1 text-slate-600">
                          {sample?.payload.transaction_date || "-"} - {sample?.payload.party_name || "Unknown party"} -{" "}
                          {sample?.payload.description || sample?.payload.reference || "No narration"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-950">4. Transformation engine</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              BOAT Connect converts external rows into normalized BOAT records with stable source IDs, typed dates,
              numeric amounts, source hashes, and sync timestamps.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700">
                Showing: {importFilterLabel(importFilter)}
              </span>
              {importFilter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setImportFilter("all")}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear filter
                </button>
              ) : null}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Source ID</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">Debit</th>
                    <th className="px-3 py-2">Credit</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWarehouse.slice(0, 12).map((record) => (
                    <tr key={record.sourceRecordId} className="border-t border-slate-100">
                      <td className="px-3 py-2">{record.sourceRecordId}</td>
                      <td className="px-3 py-2">{record.payload.transaction_date || "-"}</td>
                      <td className="px-3 py-2">{record.payload.party_name || "-"}</td>
                      <td className="px-3 py-2">{Number(record.payload.debit_amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2">{Number(record.payload.credit_amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2">{Number(record.payload.amount || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-xs">{record.sourceHash}</td>
                    </tr>
                  ))}
                  {filteredWarehouse.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                        {warehouse.length === 0 ? "Preview a source to see transformed records." : "No imported rows match this filter."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-bold text-slate-950">5. Reporting warehouse and reports</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Synchronized rows are stored as reporting records for this organization, separate from operational
              transactions. Select a report view to generate financial summaries, operational analysis, KPIs, or a board
              pack from the selected warehouse.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setReportScope("all")}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  reportScope === "all"
                    ? "border-sky-700 bg-sky-700 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                All connectors
              </button>
              <button
                type="button"
                onClick={() => setReportScope("active")}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  reportScope === "active"
                    ? "border-sky-700 bg-sky-700 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Active connector
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="rounded-md bg-slate-100 px-2 py-1">Imported source</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <span className="rounded-md bg-slate-100 px-2 py-1">Validated staging</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <span className="rounded-md bg-slate-900 px-2 py-1 text-white">Reporting facts</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-700">Connected sources</div>
                <div className="mt-2 text-2xl font-bold text-slate-950">
                  {reportScope === "all"
                    ? syncedConnectorCount.toLocaleString()
                    : (warehouse.length ? 1 : 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Table2 className="h-4 w-4" />
                  Warehouse rows
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-950">{reportingWarehouse.length.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <BarChart3 className="h-4 w-4" />
                  Amount total
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-950">{reportTotals.amount.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-700">Unique parties</div>
                <div className="mt-2 text-2xl font-bold text-slate-950">{reportTotals.parties.toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {reportViews.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setReportView(view.id)}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                      reportView === view.id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={downloadActiveReport}
                disabled={activeReportRows.length === 0}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
            <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Segment</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReportRows.slice(0, 12).map((row, index) => (
                    <tr key={`${row.metric}-${row.segment}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{row.metric}</td>
                      <td className="px-3 py-2 text-slate-700">{row.segment}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {typeof row.value === "number" ? row.value.toLocaleString() : row.value}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{row.records.toLocaleString()}</td>
                    </tr>
                  ))}
                  {activeReportRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                        Sync or preview clean data to generate reports.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                "Financial statements",
                "Operational dashboards",
                "KPI scorecards",
                "Board packs",
              ].map((pack) => (
                <div key={pack} className="flex items-center gap-3 rounded-md border border-emerald-100 bg-emerald-50 p-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div className="text-sm font-semibold text-emerald-800">{pack} active</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
