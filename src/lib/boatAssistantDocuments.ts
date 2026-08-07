import { mapStatementFileRows, parseStatementFile, suggestStatementColumnMapping } from "@/lib/bankReconciliation";

export type AssistantDocumentResult = {
  kind: "bank_statement" | "mobile_money_statement" | "business_document";
  fileName: string;
  rowCount: number;
  invalidCount: number;
  totalValue: number;
  summary: string;
  suggestedInstruction: string;
};

export async function inspectAssistantDocument(file: File): Promise<AssistantDocumentResult> {
  const parsed = await parseStatementFile(file);
  const mapped = mapStatementFileRows(parsed.rows, suggestStatementColumnMapping(parsed.headers));
  const mobile = /mobile|mtn|airtel|wallet/i.test(file.name);
  if (mapped.valid.length) {
    const totalValue = mapped.valid.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return { kind: mobile ? "mobile_money_statement" : "bank_statement", fileName: file.name, rowCount: mapped.valid.length, invalidCount: mapped.invalidCount, totalValue, summary: `${mapped.valid.length} statement line(s) were extracted for review. ${mapped.invalidCount} row(s) need attention. Nothing has been imported or matched yet.`, suggestedInstruction: `Review ${mobile ? "mobile-money" : "bank"} statement ${file.name}: ${mapped.valid.length} extracted lines with total value ${totalValue}. Prepare it for reconciliation; do not import or match without confirmation.` };
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 10); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      chunks.push((content.items as Array<{ str?: string }>).map((item) => item.str ?? "").join(" "));
    }
    const text = chunks.join(" ").replace(/\s+/g, " ").trim();
    const amountMatch = text.match(/\b(UGX|USD|KES|TZS|RWF|GBP|EUR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/. -]\d{1,2}[\/. -]\d{2,4})\b/);
    const totalValue = amountMatch ? Number(amountMatch[2].replace(/,/g, "")) : 0;
    const details = [amountMatch ? `${amountMatch[1].toUpperCase()} ${totalValue.toLocaleString()}` : null, dateMatch?.[1] ?? null].filter(Boolean).join(" on ");
    return { kind: "business_document", fileName: file.name, rowCount: text ? 1 : 0, invalidCount: 0, totalValue, summary: text ? `Text was extracted from ${document.numPages} page(s). ${details ? `Possible transaction: ${details}. ` : ""}Review the source document before confirming.` : "No readable text was found; the PDF may contain scanned images.", suggestedInstruction: `Review supporting document ${file.name}${details ? ` for ${details}` : ""}. Prepare a transaction suggestion from the document, but do not post without confirmation.` };
  }
  return { kind: "business_document", fileName: file.name, rowCount: 0, invalidCount: mapped.invalidCount, totalValue: 0, summary: "BOAT could not identify statement rows in this document. Review the file or describe the transaction in plain language.", suggestedInstruction: `Review business document ${file.name}; do not post anything without confirmation.` };
}
