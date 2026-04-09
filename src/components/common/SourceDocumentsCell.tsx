import { useCallback, useEffect, useState } from "react";
import { Paperclip, Loader2, ExternalLink, Trash2, HardDrive, Database, Link2 } from "lucide-react";
import {
  type SourceDocumentRef,
  parseSourceDocumentsJson,
  buildStoragePath,
  uploadSourceDocument,
  deleteSourceDocument,
  listOrgSourceFiles,
  openSourceDocument,
  refKey,
} from "../../lib/sourceDocuments";
import { supabase } from "../../lib/supabase";

type TableName = "payments" | "vendor_payments" | "expenses";

const KIND: Record<TableName, "payments_received" | "vendor_payments" | "expenses"> = {
  payments: "payments_received",
  vendor_payments: "vendor_payments",
  expenses: "expenses",
};

type AddPanel = "none" | "library" | "link";

interface SourceDocumentsCellProps {
  table: TableName;
  recordId: string;
  organizationId: string | null;
  rawDocuments: unknown;
  readOnly?: boolean;
  onUpdated?: () => void;
}

const MAX_DOCS = 8;

export function SourceDocumentsCell({
  table,
  recordId,
  organizationId,
  rawDocuments,
  readOnly = false,
  onUpdated,
}: SourceDocumentsCellProps) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<SourceDocumentRef[]>(() => parseSourceDocumentsJson(rawDocuments));
  const [uploading, setUploading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addPanel, setAddPanel] = useState<AddPanel>("none");
  const [libraryFiles, setLibraryFiles] = useState<{ path: string; name: string; label: string }[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    setDocs(parseSourceDocumentsJson(rawDocuments));
  }, [rawDocuments]);

  useEffect(() => {
    if (!open) setAddPanel("none");
  }, [open]);

  const persist = useCallback(
    async (next: SourceDocumentRef[]) => {
      const { error } = await supabase.from(table).update({ source_documents: next }).eq("id", recordId);
      if (error) throw new Error(error.message);
      setDocs(next);
      onUpdated?.();
    },
    [table, recordId, onUpdated]
  );

  const handleAddFiles = async (files: FileList | File[] | null) => {
    const list = files ? (Array.isArray(files) ? files : Array.from(files)) : [];
    if (!list.length || !organizationId || readOnly) return;
    if (docs.length + list.length > MAX_DOCS) {
      alert(`Maximum ${MAX_DOCS} attachments per record.`);
      return;
    }
    setUploading(true);
    try {
      let next = [...docs];
      for (const file of list) {
        if (file.size > 50 * 1024 * 1024) {
          alert(`File too large (max 50 MB): ${file.name}`);
          continue;
        }
        const path = buildStoragePath(organizationId, KIND[table], recordId, file.name);
        const up = await uploadSourceDocument(file, path);
        if (up.error) {
          alert(up.error.message);
          continue;
        }
        next = [...next, { path, name: file.name }];
      }
      await persist(next);
      setAddPanel("none");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save attachments");
    } finally {
      setUploading(false);
    }
  };

  const loadLibrary = async () => {
    if (!organizationId) return;
    setLibraryLoading(true);
    setLibrarySearch("");
    try {
      const rows = await listOrgSourceFiles(organizationId);
      setLibraryFiles(rows);
    } catch {
      setLibraryFiles([]);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handlePickFromLibrary = async (path: string, name: string) => {
    if (readOnly || !organizationId) return;
    if (docs.some((d) => d.path === path)) {
      alert("This file is already attached.");
      return;
    }
    if (docs.length >= MAX_DOCS) {
      alert(`Maximum ${MAX_DOCS} attachments per record.`);
      return;
    }
    try {
      await persist([...docs, { path, name, refOnly: true }]);
      setAddPanel("none");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to attach");
    }
  };

  const handleAddLink = async () => {
    if (readOnly) return;
    const name = linkName.trim();
    const url = linkUrl.trim();
    if (!name) {
      alert("Enter a label for the link.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      alert("Enter a valid URL starting with http:// or https://");
      return;
    }
    if (docs.length >= MAX_DOCS) {
      alert(`Maximum ${MAX_DOCS} attachments per record.`);
      return;
    }
    try {
      await persist([...docs, { name, url }]);
      setLinkName("");
      setLinkUrl("");
      setAddPanel("none");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save link");
    }
  };

  const handleRemove = async (d: SourceDocumentRef) => {
    if (readOnly) return;
    if (!confirm("Remove this attachment?")) return;
    const key = refKey(d);
    setBusyKey(key);
    try {
      if (d.path && !d.refOnly) {
        const del = await deleteSourceDocument(d.path);
        if (del.error) console.warn(del.error.message);
      }
      const next = docs.filter((x) => refKey(x) !== key);
      await persist(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusyKey(null);
    }
  };

  const filteredLibrary = libraryFiles.filter((f) => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return true;
    return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
  });

  if (!organizationId) {
    return <span className="text-slate-400 text-xs">—</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
        title="Attachments"
      >
        <Paperclip className="w-4 h-4 shrink-0" />
        {docs.length > 0 ? <span className="tabular-nums">{docs.length}</span> : <span className="text-slate-500">Add</span>}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left">
            <p className="text-xs font-medium text-slate-700 mb-2">Source documents</p>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto mb-2 border-b border-slate-100 pb-2">
              {docs.length === 0 ? (
                <li className="text-xs text-slate-500">No files yet.</li>
              ) : (
                docs.map((d) => (
                  <li key={refKey(d)} className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left truncate text-brand-700 hover:underline"
                      onClick={() => void openSourceDocument(d)}
                    >
                      {d.name}
                      {d.url ? <span className="text-slate-400"> · web</span> : null}
                      {d.refOnly ? <span className="text-slate-400"> · library</span> : null}
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-slate-500 hover:text-brand-700"
                      title="Open"
                      onClick={() => void openSourceDocument(d)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        className="p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-40"
                        disabled={busyKey === refKey(d)}
                        onClick={() => void handleRemove(d)}
                        title="Remove"
                      >
                        {busyKey === refKey(d) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </li>
                ))
              )}
            </ul>

            {!readOnly && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Add</p>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800 cursor-pointer hover:bg-slate-100">
                    <HardDrive className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                    <span>This device</span>
                    <input
                      type="file"
                      className="sr-only"
                      multiple
                      accept="image/*,application/pdf,.doc,.docx"
                      disabled={uploading}
                      onChange={(e) => {
                        void handleAddFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" /> : null}
                  </label>

                  <div
                    className="rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-center text-[10px] text-slate-500"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleAddFiles(e.dataTransfer.files);
                    }}
                  >
                    Or drop files here
                  </div>

                  <button
                    type="button"
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium text-left ${
                      addPanel === "library"
                        ? "border-brand-500 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
                    }`}
                    onClick={() => {
                      setAddPanel((p) => (p === "library" ? "none" : "library"));
                      if (addPanel !== "library") void loadLibrary();
                    }}
                  >
                    <Database className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                    Storage library
                    {libraryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" /> : null}
                  </button>

                  {addPanel === "library" && (
                    <div className="rounded border border-slate-200 p-2 bg-slate-50 max-h-40 flex flex-col gap-1">
                      <input
                        type="search"
                        placeholder="Search file name…"
                        value={librarySearch}
                        onChange={(e) => setLibrarySearch(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1"
                      />
                      <div className="overflow-y-auto text-xs space-y-0.5 min-h-0">
                        {libraryLoading ? (
                          <p className="text-slate-500 py-2">Loading…</p>
                        ) : filteredLibrary.length === 0 ? (
                          <p className="text-slate-500 py-1">No files in your org library yet. Upload from a device first.</p>
                        ) : (
                          filteredLibrary.map((f) => (
                            <button
                              key={f.path}
                              type="button"
                              className="w-full text-left truncate py-0.5 px-1 rounded hover:bg-white text-slate-800"
                              title={f.path}
                              onClick={() => void handlePickFromLibrary(f.path, f.name)}
                            >
                              {f.label}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium text-left ${
                      addPanel === "link"
                        ? "border-brand-500 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
                    }`}
                    onClick={() => setAddPanel((p) => (p === "link" ? "none" : "link"))}
                  >
                    <Link2 className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                    Web link
                  </button>

                  {addPanel === "link" && (
                    <div className="rounded border border-slate-200 p-2 bg-slate-50 space-y-1.5">
                      <input
                        type="text"
                        placeholder="Label (e.g. Receipt PDF)"
                        value={linkName}
                        onChange={(e) => setLinkName(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1"
                      />
                      <input
                        type="url"
                        placeholder="https://…"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded px-2 py-1 font-mono"
                      />
                      <button
                        type="button"
                        className="w-full app-btn-secondary text-xs py-1"
                        onClick={() => void handleAddLink()}
                      >
                        Add link
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">
                  Device uploads go to Supabase Storage. Library reuses existing files. Web links open as URLs (no upload).
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
