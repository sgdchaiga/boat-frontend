import { supabase } from "./supabase";
import { sanitizeFileName } from "./sourceDocuments";

export const VSLA_MEETING_MINUTES_BUCKET = "vsla-meeting-minutes";

export function buildVslaMinutesStoragePath(
  orgId: string,
  meetingId: string,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName);
  const uniq = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${orgId}/meetings/${meetingId}/${uniq}_${safe}`;
}

export async function uploadVslaMeetingMinutesFile(
  file: File,
  storagePath: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.storage
    .from(VSLA_MEETING_MINUTES_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function removeVslaMeetingMinutesFile(
  storagePath: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.storage
    .from(VSLA_MEETING_MINUTES_BUCKET)
    .remove([storagePath]);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function getVslaMeetingMinutesSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(VSLA_MEETING_MINUTES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
