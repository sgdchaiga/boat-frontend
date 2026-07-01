import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, ImagePlus, Plus, Trash2, Wand2 } from "lucide-react";
import * as XLSX from "xlsx";
import { boatApi, getBoatApiBaseUrl } from "@/lib/boatApi";
import { desktopApi } from "@/lib/desktopApi";

type TableRow = string[];

const emptyRows: TableRow[] = [
  ["Description", "Quantity", "Amount"],
  ["", "", ""],
  ["", "", ""],
  ["", "", ""],
];

function safeFileStem(name: string): string {
  return (
    (name || "boat-image-conversion")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "boat-image-conversion"
  );
}

function splitTextToRows(text: string): TableRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return emptyRows;
  return lines.map((line) => {
    const tabbed = line.split(/\t+/).map((cell) => cell.trim());
    if (tabbed.length > 1) return tabbed;
    const spaced = line.split(/\s{2,}/).map((cell) => cell.trim());
    return spaced.length > 1 ? spaced : [line];
  });
}

function normalizeRows(rows: TableRow[]): TableRow[] {
  const width = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ImageDocumentConverterPage() {
  const [imageName, setImageName] = useState("boat-image-conversion");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<TableRow[]>(emptyRows);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [lastAutoOcrDataUrl, setLastAutoOcrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const normalizedRows = useMemo(() => normalizeRows(rows), [rows]);
  const fileStem = safeFileStem(imageName);

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setImageName(file.name);
    setOcrStatus(null);
    setActionStatus("Picture loaded. OCR will start automatically; you can also type or paste text manually.");
    setImageDataUrl(null);
    setLastAutoOcrDataUrl(null);
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => {
      setOcrStatus("Could not prepare this image for OCR.");
    };
    reader.readAsDataURL(file);
  };

  const runBrowserOcr = async () => {
    if (!imageUrl) return;
    if (ocrRunning) return;
    setOcrRunning(true);
    try {
      if (imageDataUrl && desktopApi.isAvailable()) {
        setOcrStatus("Reading text from the picture...");
        const result = await desktopApi.readImageOcr({ dataUrl: imageDataUrl, fileName: imageName });
        const text = result.text?.trim() || "";
        if (!text) {
          setOcrStatus("No readable text was detected. Try a clearer photo or enter the text manually.");
          return;
        }
        setRawText(text);
        setRows(splitTextToRows(text));
        setOcrStatus("Text detected. Review the editable table before exporting.");
        return;
      }

      const TextDetectorCtor = (window as unknown as { TextDetector?: new () => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).TextDetector;
      const boatApiBaseUrl = imageDataUrl ? await getBoatApiBaseUrl() : "";

      if (imageDataUrl && boatApiBaseUrl) {
        setOcrStatus("Reading text from the picture online...");
        const result = await boatApi.ocr.imageDocument({ data_url: imageDataUrl, file_name: imageName }, 60000);
        const text = String(result.text || "").trim();
        if (!text) {
          setOcrStatus("No readable text was detected. Try a clearer photo or enter the text manually.");
          return;
        }
        setRawText(text);
        setRows(splitTextToRows(text));
        const provider = result.provider === "tesseract" ? "free Tesseract OCR" : "online OCR";
        const confidence =
          typeof result.confidence === "number" && Number.isFinite(result.confidence)
            ? ` Confidence: ${Math.round(result.confidence)}%.`
            : "";
        const reviewNote =
          result.provider === "tesseract" && typeof result.confidence === "number" && result.confidence < 65
            ? " The photo was difficult to read, so review the text carefully."
            : "";
        const fallbackNote = result.fallback_from ? " OpenAI was unavailable, so BOAT used the free fallback." : "";
        setOcrStatus(`Text detected with ${provider}.${confidence}${reviewNote} Review the editable table before exporting.${fallbackNote}`);
        return;
      }

      if (!TextDetectorCtor) {
        setOcrStatus(
          imageDataUrl
            ? "Online OCR server is not configured. Paste or type the text, then build the table."
            : "Automatic OCR is unavailable in this browser. Paste or type the text, then build the table."
        );
        return;
      }
      setOcrStatus("Reading text from the picture...");
      const imageBlob = await fetch(imageUrl).then((res) => res.blob());
      const bitmap = await createImageBitmap(imageBlob);
      const detections = await new TextDetectorCtor().detect(bitmap);
      bitmap.close();
      const text = detections.map((item) => item.rawValue?.trim()).filter(Boolean).join("\n");
      if (!text) {
        setOcrStatus("No readable text was detected. Try a clearer photo or enter the text manually.");
        return;
      }
      setRawText(text);
      setRows(splitTextToRows(text));
      setOcrStatus("Text detected. Review the editable table before exporting.");
    } catch (error) {
      setOcrStatus(error instanceof Error ? error.message : "Automatic OCR failed. Enter the text manually.");
    } finally {
      setOcrRunning(false);
    }
  };

  useEffect(() => {
    if (!imageUrl || !imageDataUrl || lastAutoOcrDataUrl === imageDataUrl) return;
    setLastAutoOcrDataUrl(imageDataUrl);
    void runBrowserOcr();
  }, [imageUrl, imageDataUrl, lastAutoOcrDataUrl]);

  const rebuildRowsFromText = () => {
    const nextRows = splitTextToRows(rawText);
    setRows(nextRows);
    const hasText = rawText.trim().length > 0;
    setActionStatus(hasText ? `Editable table built with ${nextRows.length} row(s).` : "No text entered yet. Type or paste text first, then build the table.");
  };

  const patchCell = (rowIndex: number, columnIndex: number, value: string) => {
    setRows((current) => {
      const next = normalizeRows(current).map((row) => [...row]);
      next[rowIndex][columnIndex] = value;
      return next;
    });
  };

  const addRow = () => {
    setRows((current) => {
      const width = Math.max(1, ...current.map((row) => row.length));
      return [...normalizeRows(current), Array.from({ length: width }, () => "")];
    });
  };

  const addColumn = () => {
    setRows((current) => normalizeRows(current).map((row) => [...row, ""]));
  };

  const removeRow = (rowIndex: number) => {
    setRows((current) => {
      const next = current.filter((_, index) => index !== rowIndex);
      return next.length ? normalizeRows(next) : [[""]];
    });
  };

  const exportExcel = () => {
    try {
      const ws = XLSX.utils.aoa_to_sheet(normalizedRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Image data");
      XLSX.writeFile(wb, `${fileStem}.xlsx`);
      setActionStatus(`Excel file created: ${fileStem}.xlsx`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Could not create the Excel file.");
    }
  };

  const exportWord = () => {
    try {
      const tableRows = normalizedRows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td style="border:1px solid #94a3b8;padding:6px;">${htmlEscape(cell)}</td>`)
              .join("")}</tr>`
        )
        .join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(
        fileStem
      )}</title></head><body><h1>${htmlEscape(
        fileStem
      )}</h1><table style="border-collapse:collapse;width:100%;">${tableRows}</table></body></html>`;
      downloadBlob(`${fileStem}.doc`, new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }));
      setActionStatus(`Word file created: ${fileStem}.doc`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Could not create the Word file.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Image to Excel / Word</h1>
          <p className="mt-1 text-sm text-slate-600">
            Turn a photographed table, list, receipt, or note into editable rows before export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="app-btn-secondary cursor-pointer">
            <ImagePlus className="h-4 w-4" />
            Upload picture
            <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
          </label>
          <button type="button" className="app-btn-secondary" onClick={exportWord}>
            <FileText className="h-4 w-4" />
            Word
          </button>
          <button type="button" className="app-btn-primary" onClick={exportExcel}>
            <Download className="h-4 w-4" />
            Excel
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="aspect-[4/3] overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50">
            {imageUrl ? (
              <img src={imageUrl} alt="Uploaded source" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">
                Upload a clear picture to preview it here
              </div>
            )}
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            File name
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
              value={imageName}
              onChange={(event) => setImageName(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Text copied from the picture
            <textarea
              className="mt-1 min-h-40 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Paste or type the text from the image. Use tabs or multiple spaces between columns."
            />
          </label>
          <button type="button" className="app-btn-secondary w-full justify-center" onClick={rebuildRowsFromText}>
            <Wand2 className="h-4 w-4" />
            Build editable table
          </button>
          <button type="button" className="app-btn-secondary w-full justify-center" onClick={() => void runBrowserOcr()} disabled={!imageUrl || ocrRunning}>
            <Wand2 className="h-4 w-4" />
            {ocrRunning ? "Reading..." : "Retry automatic OCR"}
          </button>
          {ocrStatus && <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{ocrStatus}</p>}
          {actionStatus && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{actionStatus}</p>}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase text-slate-600">Editable table</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="app-btn-secondary" onClick={addColumn}>
                <Plus className="h-4 w-4" />
                Column
              </button>
              <button type="button" className="app-btn-secondary" onClick={addRow}>
                <Plus className="h-4 w-4" />
                Row
              </button>
            </div>
          </div>
          <div className="max-h-[620px] overflow-auto rounded-md border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <tbody>
                {normalizedRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex === 0 ? "bg-slate-100" : "bg-white"}>
                    {row.map((cell, columnIndex) => (
                      <td key={`${rowIndex}-${columnIndex}`} className="min-w-36 border border-slate-200 p-0">
                        <input
                          className="h-10 w-full bg-transparent px-2 text-sm outline-none focus:bg-emerald-50"
                          value={cell}
                          onChange={(event) => patchCell(rowIndex, columnIndex, event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="w-10 border border-slate-200 p-1">
                      <button
                        type="button"
                        className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => removeRow(rowIndex)}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              BOAT Desktop uses Windows OCR. BOAT Online can use OpenAI OCR when configured, then falls back to free
              Tesseract OCR on the BOAT server. The review table stays editable so users can correct OCR mistakes before
              exporting to Excel or Word.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
