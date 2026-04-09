import { supabase } from "./supabase";

export const SOURCE_DOCUMENTS_BUCKET = "source-documents";

/** Stored file in `source-documents` bucket, or external link. */
export type SourceDocumentRef = {
  name: string;
  /** Storage object path (omit if `url` is set). */
  path?: string;
  /** External document URL (https). Removing only drops the reference. */
  url?: string;
  /** If true, removing only drops the reference; file stays in storage (e.g. picked from org library). */
  refOnly?: boolean;
};

export function refKey(d: SourceDocumentRef): string {
  return d.path ?? d.url ?? d.name;
}

export function parseSourceDocumentsJson(raw: unknown): SourceDocumentRef[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  const out: SourceDocumentRef[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { path?: string; name?: string; url?: string; refOnly?: boolean };
    const name = String(r.name || r.path?.split("/").pop() || r.url || "Link").trim();
    if (r.url && typeof r.url === "string" && /^https?:\/\//i.test(r.url.trim())) {
      out.push({ name: name || "Link", url: r.url.trim() });
      continue;
    }
    if (r.path && typeof r.path === "string") {
      out.push({
        path: r.path,
        name: name || r.path.split("/").pop() || "file",
        refOnly: Boolean(r.refOnly),
      });
    }
  }
  return out;
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(0, 200) || "file";
}

export function buildStoragePath(
  orgId: string,
  kind: "payments_received" | "vendor_payments" | "expenses",
  recordId: string,
  fileName: string
): string {
  const safe = sanitizeFileName(fileName);
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${orgId}/${kind}/${recordId}/${uniq}_${safe}`;
}

export async function uploadSourceDocument(
  file: File,
  storagePath: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.storage.from(SOURCE_DOCUMENTS_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function deleteSourceDocument(storagePath: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.storage.from(SOURCE_DOCUMENTS_BUCKET).remove([storagePath]);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function getSourceDocumentSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SOURCE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** List existing files in org’s area of the bucket (for “attach from storage”). */
export async function listOrgSourceFiles(
  orgId: string
): Promise<{ path: string; name: string; label: string }[]> {
  const out: { path: string; name: string; label: string }[] = [];
  const kinds = ["payments_received", "vendor_payments", "expenses"] as const;
  for (const kind of kinds) {
    const base = `${orgId}/${kind}`;
    const { data: recordFolders, error: e1 } = await supabase.storage
      .from(SOURCE_DOCUMENTS_BUCKET)
      .list(base, { limit: 1000 });
    if (e1 || !recordFolders?.length) continue;
    for (const folder of recordFolders) {
      if (folder.metadata) continue;
      const recordPath = `${base}/${folder.name}`;
      const { data: files, error: e2 } = await supabase.storage
        .from(SOURCE_DOCUMENTS_BUCKET)
        .list(recordPath, { limit: 200 });
      if (e2 || !files?.length) continue;
      for (const f of files) {
        if (!f.metadata) continue;
        const fullPath = `${recordPath}/${f.name}`;
        const shortKind = kind.replace(/_/g, " ");
        out.push({
          path: fullPath,
          name: f.name,
          label: `${shortKind} · …/${f.name}`,
        });
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return out;
}

export async function openSourceDocument(d: SourceDocumentRef): Promise<void> {
  if (d.url) {
    window.open(d.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (d.path) {
    const url = await getSourceDocumentSignedUrl(d.path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
}
