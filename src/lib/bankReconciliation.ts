import * as XLSX from "xlsx";

export type StatementLine = {
  id: string;
  statement_date: string;
  description: string;
  reference: string | null;
  amount: number;
  source_type?: ReconciliationSourceType;
  source_label?: string | null;
};

export type ReconciliationSourceType =
  | "bank"
  | "cash_count"
  | "till_float"
  | "vault"
  | "mobile_money"
  | "wallet"
  | "other";

export type LedgerBankLine = {
  id: string;
  entry_date: string;
  description: string;
  line_description: string | null;
  transaction_id: string | null;
  amount: number;
};

export type AutoMatchPair = { statementId: string; ledgerId: string };
export type StatementFileRow = Record<string, string>;
export type StatementFilePageStat = { name: string; rowCount: number };
export type StatementColumnMapping = {
  date: string;
  description: string;
  reference: string;
  amount: string;
  debit: string;
  credit: string;
};

const PDF_HEADERS = ["Date", "Description", "Reference", "Amount", "Debit", "Credit", "__Source page"];

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

function suggestColumn(headers: string[], patterns: RegExp[]): string {
  return headers.find((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header)))) || "";
}

export function suggestStatementColumnMapping(headers: string[]): StatementColumnMapping {
  return {
    date: suggestColumn(headers, [/^(date|transactiondate|valuedate|postingdate)$/]),
    description: suggestColumn(headers, [/description|narration|details|particulars|memo/]),
    reference: suggestColumn(headers, [/reference|refno|transactionid|chequeno|receiptno/]),
    amount: suggestColumn(headers, [/^(amount|transactionamount|signedamount)$/]),
    debit: suggestColumn(headers, [/debit|withdrawal|moneyout|paidout/]),
    credit: suggestColumn(headers, [/credit|deposit|moneyin|paidin/]),
  };
}

const HEADER_HINT = /date|description|narration|details|particulars|memo|reference|ref|amount|debit|credit|withdrawal|deposit/i;

function uniqueHeaders(cells: unknown[]): string[] {
  const used = new Map<string, number>();
  return cells.map((cell, index) => {
    const base = String(cell).trim() || `Column ${index + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function findHeaderRow(matrix: unknown[][]): number {
  let bestIndex = -1;
  let bestScore = 0;
  matrix.slice(0, 60).forEach((row, index) => {
    const values = row.map((cell) => String(cell).trim()).filter(Boolean);
    const score = values.filter((value) => HEADER_HINT.test(value)).length * 10 + Math.min(values.length, 8);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export async function parseStatementFile(file: File): Promise<{ headers: string[]; rows: StatementFileRow[]; sheetNames: string[]; pageStats: StatementFilePageStat[] }> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return parseStatementPdf(file);
  }
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const allHeaders: string[] = [];
  const rows: StatementFileRow[] = [];
  const sheetNames: string[] = [];
  const pageStats: StatementFilePageStat[] = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) return;
    const headers = uniqueHeaders(matrix[headerRow]);
    headers.forEach((header) => {
      if (!allHeaders.includes(header)) allHeaders.push(header);
    });
    sheetNames.push(sheetName);
    const beforeCount = rows.length;
    matrix.slice(headerRow + 1).forEach((cells) => {
      if (!cells.some((cell) => String(cell).trim())) return;
      const row: StatementFileRow = { "__Source sheet": sheetName };
      headers.forEach((header, index) => {
        row[header] = String(cells[index] ?? "").trim();
      });
      rows.push(row);
    });
    pageStats.push({ name: sheetName, rowCount: rows.length - beforeCount });
  });
  return { headers: allHeaders, rows, sheetNames, pageStats };
}

async function parseStatementPdf(file: File): Promise<{ headers: string[]; rows: StatementFileRow[]; sheetNames: string[]; pageStats: StatementFilePageStat[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const rows: StatementFileRow[] = [];
  const pages: string[] = [];
  const pageStats: StatementFilePageStat[] = [];
  const seen = new Set<string>();
  const datePattern = /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/;
  const amountAtEndPattern = /(\(?-?[\d,]+\.\d{2}\)?)\s*$/;
  let pendingDate = "";
  let debitHeaderX: number | null = null;
  let creditHeaderX: number | null = null;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string; transform?: number[] }>).filter((item) => item.str?.trim());
    const byLine = new Map<number, Array<{ x: number; text: string }>>();
    items.forEach((item) => {
      const y = Math.round(item.transform?.[5] || 0);
      const x = item.transform?.[4] || 0;
      const line = byLine.get(y) || [];
      line.push({ x, text: item.str?.trim() || "" });
      byLine.set(y, line);
    });
    pages.push(`Page ${pageNumber}`);
    const pageStartCount = rows.length;
    const orderedLines = Array.from(byLine.entries()).sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.sort((a, b) => a.x - b.x));
    const headerParts = orderedLines.find((parts) => {
      const text = parts.map((part) => part.text).join(" ").toLowerCase();
      return /date/.test(text) && (/debit|withdrawal/.test(text) || /credit|deposit/.test(text));
    }) || [];
    const debitHeader = headerParts.find((part) => /debit|withdrawal/i.test(part.text));
    const creditHeader = headerParts.find((part) => /credit|deposit/i.test(part.text));
    if (debitHeader) debitHeaderX = debitHeader.x;
    if (creditHeader) creditHeaderX = creditHeader.x;
    let pendingDescription: string[] = [];
    orderedLines.forEach((parts) => {
      const text = parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
      const dateMatch = text.match(datePattern);
      if (dateMatch) {
        pendingDate = dateMatch[1];
        pendingDescription = [];
      }
      let amountParts = parts.filter((part) => amountAtEndPattern.test(part.text.replace(/\s+/g, "")));
      const looksLikeHeader = /date|description|narration|details|particulars|debit|credit|withdrawal|deposit|balance/i.test(text)
        && !dateMatch;
      if (amountParts.length === 0) {
        if (pendingDate && !looksLikeHeader) {
          const continuation = parts.filter((part) => !datePattern.test(part.text)).map((part) => part.text).join(" ").trim();
          if (continuation) pendingDescription.push(continuation);
        }
        return;
      }
      if (!pendingDate && !dateMatch) return;
      if (debitHeaderX != null && creditHeaderX != null) {
        const left = Math.min(debitHeaderX, creditHeaderX);
        const right = Math.max(debitHeaderX, creditHeaderX);
        const padding = Math.max(35, (right - left) * 0.65);
        amountParts = amountParts.filter((part) => part.x >= left - padding && part.x <= right + padding);
        if (amountParts.length === 0) return;
      } else if (amountParts.length > 1) {
        // Without debit/credit header positions, the right-most amount is commonly the balance column.
        amountParts = [amountParts[amountParts.length - 2] || amountParts[0]];
      }
      let debit = "";
      let credit = "";
      let amount = "";
      amountParts.forEach((part) => {
        if (debitHeaderX != null && creditHeaderX != null) {
          const debitDistance = Math.abs(part.x - debitHeaderX);
          const creditDistance = Math.abs(part.x - creditHeaderX);
          if (debitDistance <= creditDistance) debit = part.text;
          else credit = part.text;
        } else {
          amount = part.text;
        }
      });
      const lastAmountIndex = Math.max(...amountParts.map((part) => parts.indexOf(part)));
      const datePartIndex = dateMatch ? parts.findIndex((part) => datePattern.test(part.text)) : -1;
      const currentDescription = parts.slice(datePartIndex + 1, lastAmountIndex).filter((part) => !amountParts.includes(part)).map((part) => part.text).join(" ").trim();
      const middle = [...pendingDescription, currentDescription].filter(Boolean).join(" ").trim();
      const referenceMatch = middle.match(/\b([A-Z0-9-]{5,})\b/i);
      const extractedRow = {
        Date: pendingDate,
        Description: middle,
        Reference: referenceMatch?.[1] || "",
        Amount: amount,
        Debit: debit,
        Credit: credit,
        "__Source page": String(pageNumber),
      };
      const key = `${pageNumber}|${extractedRow.Date}|${extractedRow.Description}|${extractedRow.Reference}|${extractedRow.Amount}|${extractedRow.Debit}|${extractedRow.Credit}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(extractedRow);
      }
      pendingDescription = [];
    });
    pageStats.push({ name: `Page ${pageNumber}`, rowCount: rows.length - pageStartCount });
  }
  if (rows.length === 0) {
    throw new Error("No transaction rows could be extracted from this PDF. It may be scanned or use an unsupported layout; use OCR or export it to Excel/CSV.");
  }
  const headers = PDF_HEADERS.filter((header) => header.startsWith("__") || rows.some((row) => String(row[header] || "").trim()));
  return { headers, rows, sheetNames: pages, pageStats };
}

function parseAmount(value: string): number {
  const clean = value.replace(/[^\d.,()-]/g, "").replace(/,/g, "").trim();
  if (!clean) return 0;
  const negative = clean.startsWith("(") && clean.endsWith(")");
  const parsed = Number(clean.replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : 0;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function mapStatementFileRows(
  rows: StatementFileRow[],
  mapping: StatementColumnMapping
): { valid: Array<Omit<StatementLine, "id">>; invalidCount: number; invalidReasons: Record<string, number> } {
  const valid: Array<Omit<StatementLine, "id">> = [];
  let invalidCount = 0;
  const invalidReasons: Record<string, number> = {};
  for (const row of rows) {
    const statementDate = parseDate(row[mapping.date] || "");
    const amount = mapping.amount
      ? parseAmount(row[mapping.amount] || "")
      : Math.abs(parseAmount(row[mapping.credit] || "")) - Math.abs(parseAmount(row[mapping.debit] || ""));
    if (!statementDate || Math.abs(amount) < 0.005) {
      invalidCount += 1;
      const reason = !statementDate ? "Missing or unreadable date" : "Blank or zero amount";
      invalidReasons[reason] = (invalidReasons[reason] || 0) + 1;
      continue;
    }
    valid.push({
      statement_date: statementDate,
      description: row[mapping.description] || "Bank statement line",
      reference: mapping.reference ? row[mapping.reference] || null : null,
      amount,
    });
  }
  return { valid, invalidCount, invalidReasons };
}


function dateDistanceDays(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;
}

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length >= 3)
  );
}

function textScore(statement: StatementLine, ledger: LedgerBankLine): number {
  const left = words(`${statement.reference || ""} ${statement.description}`);
  const right = words(`${ledger.transaction_id || ""} ${ledger.description} ${ledger.line_description || ""}`);
  let score = 0;
  for (const word of left) if (right.has(word)) score += 1;
  return score;
}

export function autoMatchBankLines(
  statements: StatementLine[],
  ledgerLines: LedgerBankLine[],
  maxDateDistanceDays = 3
): AutoMatchPair[] {
  const usedLedger = new Set<string>();
  const pairs: AutoMatchPair[] = [];
  for (const statement of statements) {
    const candidates = ledgerLines
      .filter(
        (ledger) =>
          !usedLedger.has(ledger.id) &&
          Math.abs(statement.amount - ledger.amount) < 0.005 &&
          dateDistanceDays(statement.statement_date, ledger.entry_date) <= maxDateDistanceDays
      )
      .sort((a, b) => {
        const scoreDiff = textScore(statement, b) - textScore(statement, a);
        if (scoreDiff !== 0) return scoreDiff;
        return dateDistanceDays(statement.statement_date, a.entry_date) - dateDistanceDays(statement.statement_date, b.entry_date);
      });
    if (!candidates[0]) continue;
    usedLedger.add(candidates[0].id);
    pairs.push({ statementId: statement.id, ledgerId: candidates[0].id });
  }
  return pairs;
}
