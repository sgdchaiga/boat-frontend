import { supabase } from "@/lib/supabase";
import {
  assessmentReportPdfFileName,
  getHotelAssessmentReportPdfBlob,
  triggerBrowserPdfDownload,
  type HotelAssessmentReportPdfInput,
} from "@/lib/hotelAssessmentPdf";

export const HOTEL_ASSESSMENT_REPORTS_BUCKET = "hotel-assessment-reports";

/** Path relative to bucket: `{organization_id}/{assessment_id}.pdf` */
export function assessmentReportStoragePath(organizationId: string, assessmentId: string): string {
  const org = organizationId.trim();
  const aid = assessmentId.trim();
  return `${org}/${aid}.pdf`;
}

async function blobFromSignedPdfUrl(pathInBucket: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage
    .from(HOTEL_ASSESSMENT_REPORTS_BUCKET)
    .createSignedUrl(pathInBucket, 180);
  if (error || !data?.signedUrl) return null;
  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * Upsert PDF bytes to org-scoped storage and record `report_storage_path` (+ optional timestamp).
 */
export async function persistAssessmentPdfToStorage(
  organizationId: string,
  assessmentId: string,
  blob: Blob,
  options?: { touchReportGeneratedAt?: boolean }
): Promise<boolean> {
  const touch = options?.touchReportGeneratedAt !== false;
  const pathInBucket = assessmentReportStoragePath(organizationId, assessmentId);
  const { error } = await supabase.storage.from(HOTEL_ASSESSMENT_REPORTS_BUCKET).upload(pathInBucket, blob, {
    upsert: true,
    contentType: "application/pdf",
    cacheControl: "3600",
  });
  if (error) {
    console.warn("[BOAT] Assessment PDF upload:", error.message);
    return false;
  }
  const patch: Record<string, unknown> = { report_storage_path: pathInBucket };
  if (touch) patch.report_generated_at = new Date().toISOString();
  const { error: uErr } = await supabase.from("onboarding_assessments").update(patch).eq("id", assessmentId);
  if (uErr) {
    console.warn("[BOAT] Assessment report_storage_path update:", uErr.message);
    return false;
  }
  return true;
}

/**
 * Serve archived PDF when `report_storage_path` is set; otherwise build from `regenerateInput`,
 * download in-browser, and repair storage.
 */
export async function resolveAndDownloadAssessmentReportPdf(opts: {
  organizationId: string;
  assessmentId: string;
  storedPath?: string | null;
  regenerateInput: HotelAssessmentReportPdfInput;
  touchReportGeneratedAt?: boolean;
}): Promise<boolean> {
  const { organizationId, assessmentId, storedPath, regenerateInput } = opts;
  const touch = opts.touchReportGeneratedAt !== false;
  const fname = assessmentReportPdfFileName(regenerateInput.hotelName, regenerateInput.assessmentDate);

  const path = storedPath?.trim();
  if (path) {
    const blob = await blobFromSignedPdfUrl(path);
    if (blob && blob.size > 0) {
      triggerBrowserPdfDownload(blob, fname);
      if (touch) {
        await supabase.from("onboarding_assessments").update({ report_generated_at: new Date().toISOString() }).eq("id", assessmentId);
      }
      return true;
    }
  }

  const fresh = getHotelAssessmentReportPdfBlob(regenerateInput);
  triggerBrowserPdfDownload(fresh, fname);
  await persistAssessmentPdfToStorage(organizationId, assessmentId, fresh, { touchReportGeneratedAt: touch });
  return true;
}
