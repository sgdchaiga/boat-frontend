import { supabase } from "@/lib/supabase";
import {
  buildRecommendations,
  calculateScore,
  estimateMonthlyRevenueLeakageUgx,
  getReadiness,
  topRiskCategories,
  type ScoreRow,
} from "@/lib/hotelAssessmentEngine";
import { resolveAndDownloadAssessmentReportPdf } from "@/lib/hotelAssessmentReportStorage";

/**
 * Download assessment PDF — prefers archived object in Storage (`report_storage_path`);
 * regenerates from DB, uploads (repair), and downloads if absent.
 */
export async function downloadPersistedAssessmentReportPdf(
  assessmentId: string,
  options?: { touchReportGeneratedAt?: boolean }
): Promise<boolean> {
  const touch = options?.touchReportGeneratedAt !== false;
  const { data: ass, error: aErr } = await supabase.from("onboarding_assessments").select("*").eq("id", assessmentId).maybeSingle();
  if (aErr || !ass) return false;
  const ar = ass as Record<string, unknown>;
  const hotelId = String(ar.hotel_id ?? "");
  const branchId = ar.branch_id ? String(ar.branch_id) : "";
  const organizationId = String(ar.organization_id ?? "");
  if (!organizationId) return false;

  const [{ data: hotel }, { data: branch }, { data: scores }, { data: recs }] = await Promise.all([
    supabase.from("onboarding_hotels").select("*").eq("id", hotelId).maybeSingle(),
    branchId ? supabase.from("onboarding_branches").select("*").eq("id", branchId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("onboarding_assessment_scores").select("category,item,score").eq("assessment_id", assessmentId),
    supabase.from("onboarding_recommendations").select("module,priority").eq("assessment_id", assessmentId),
  ]);

  const scoreRows = (scores || []).map((r) => ({
    category: String(r.category),
    item: String(r.item),
    score: Number(r.score),
  }));
  let recoList = ((recs || []) as { module?: string | null; priority?: string | null }[]).map((r) => ({
    module: String(r.module ?? ""),
    priority: String(r.priority ?? "medium"),
  }));
  const scoreTuples = scoreRows.map((s) => ({ category: s.category, item: s.item, score: s.score }));
  if (!recoList.length) {
    recoList = buildRecommendations(scoreTuples).map((x) => ({ module: x.module, priority: x.priority }));
  }

  const h = hotel as Record<string, unknown> | null;
  const br = branch as Record<string, unknown> | null;
  const rooms = Number(br?.rooms ?? 0);
  const occ = Number(br?.occupancy_rate ?? 0);
  const weighted = calculateScore(scoreTuples);
  const leak = estimateMonthlyRevenueLeakageUgx({ weightedScore: weighted, rooms, occupancyPct: occ });

  const readiness = getReadiness(weighted);
  const topRisks = topRiskCategories(scoreTuples as ScoreRow[], 5);

  const regenerateInput = {
    hotelName: String(h?.name ?? "Hotel"),
    branchName: String(br?.name ?? "Branch"),
    location: `${String(h?.location ?? "")} / ${String(br?.location ?? "")}`,
    assessorName: String(ar.assessor_name ?? "Assessor"),
    assessmentDate: String(ar.assessment_date ?? new Date().toISOString().slice(0, 10)),
    totalScore: weighted,
    readiness,
    topRisks,
    scoreRows,
    recommendations: recoList.length ? recoList : [{ module: "BOAT baseline", priority: "low" }],
    painPoints: [String(ar.pain_point_1 ?? ""), String(ar.pain_point_2 ?? ""), String(ar.pain_point_3 ?? "")] as [
      string,
      string,
      string,
    ],
    revenueLeakageLow: leak.low,
    revenueLeakageHigh: leak.high,
  };

  try {
    await resolveAndDownloadAssessmentReportPdf({
      organizationId,
      assessmentId,
      storedPath: ar.report_storage_path != null ? String(ar.report_storage_path) : null,
      regenerateInput,
      touchReportGeneratedAt: touch,
    });
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}
