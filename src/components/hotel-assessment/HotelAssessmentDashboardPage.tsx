import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  LineChart,
  PlayCircle,
  TrendingDown,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { HOTEL_ASSESSMENT_PAGE } from "@/lib/hotelPages";
import { averageForCategory, type ScoreRow } from "@/lib/hotelAssessmentEngine";
import { downloadPersistedAssessmentReportPdf } from "@/lib/hotelAssessmentDownload";

interface AssessmentListRow {
  id: string;
  hotel_id: string;
  branch_id: string | null;
  assessment_date: string;
  total_score: number | null;
  readiness_level: string | null;
  status: string;
  converted_to_client: boolean;
  pain_point_1?: string | null;
  pain_point_2?: string | null;
  pain_point_3?: string | null;
  report_generated_at?: string | null;
  onboarding_hotels: { name: string } | null;
  onboarding_branches: { name: string } | null;
}

function formatUgx(n: number): string {
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

function formatReportStamp(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function HotelAssessmentDashboardPage({
  onNavigate,
}: {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<AssessmentListRow[]>([]);
  const [hotelCountCaptured, setHotelCountCaptured] = useState(0);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [{ count: hotelsCount, error: hcErr }, { data: assessRows, error: aErr }] = await Promise.all([
        supabase.from("onboarding_hotels").select("id", { count: "exact", head: true }),
        supabase
          .from("onboarding_assessments")
          .select(
            "id,hotel_id,branch_id,assessment_date,total_score,readiness_level,status,converted_to_client,pain_point_1,pain_point_2,pain_point_3,report_generated_at,onboarding_hotels(name),onboarding_branches(name)"
          )
          .eq("organization_id", organizationId)
          .order("assessment_date", { ascending: false })
          .limit(300),
      ]);
      if (hcErr) throw hcErr;
      if (aErr) throw aErr;
      setHotelCountCaptured(hotelsCount ?? 0);
      setAssessments((assessRows || []) as AssessmentListRow[]);
    } catch (e) {
      console.error(e);
      toast.error("Could not load assessment data.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const finals = useMemo(() => assessments.filter((a) => a.status === "final"), [assessments]);
  const distinctHotelsAssessed = useMemo(() => new Set(assessments.map((a) => a.hotel_id)).size, [assessments]);

  const avgScore = useMemo(() => {
    const scored = finals.filter((a) => a.total_score != null) as (AssessmentListRow & { total_score: number })[];
    if (!scored.length) return null;
    const sum = scored.reduce((s, a) => s + a.total_score, 0);
    return Math.round((sum / scored.length) * 100) / 100;
  }, [finals]);

  const conversionRate = useMemo(() => {
    if (!finals.length) return null;
    const conv = finals.filter((a) => a.converted_to_client).length;
    return Math.round((conv / finals.length) * 1000) / 10;
  }, [finals]);

  const highRiskHotels = useMemo(() => {
    const risky = finals.filter((a) => a.readiness_level === "LOW" || a.readiness_level === "CRITICAL");
    return new Set(risky.map((a) => a.hotel_id)).size;
  }, [finals]);

  const readinessChart = useMemo(() => {
    const map: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, CRITICAL: 0 };
    for (const f of finals) {
      const r = (f.readiness_level || "").toUpperCase();
      if (r in map) map[r]++;
    }
    return Object.entries(map).map(([tier, count]) => ({ tier, count }));
  }, [finals]);

  const [weaknessAgg, setWeaknessAgg] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!organizationId || finals.length === 0) {
      setWeaknessAgg({});
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = finals.map((a) => a.id);
      const { data: scoreRows, error } = await supabase
        .from("onboarding_assessment_scores")
        .select("assessment_id,category,score")
        .in("assessment_id", ids);
      if (error || cancelled) return;
      const byAssessment: Record<string, ScoreRow[]> = {};
      for (const row of scoreRows || []) {
        const aid = row.assessment_id as string;
        if (!byAssessment[aid]) byAssessment[aid] = [];
        byAssessment[aid].push({
          category: row.category as string,
          item: "",
          score: Number(row.score),
        });
      }
      const tally: Record<string, { sum: number; n: number }> = {};
      for (const aid of Object.keys(byAssessment)) {
        const scr = byAssessment[aid];
        for (const cat of [
          "front_office",
          "billing",
          "pos",
          "inventory",
          "accounting",
          "housekeeping",
          "controls",
          "technology",
        ]) {
          const av = averageForCategory(scr, cat);
          if (!tally[cat]) tally[cat] = { sum: 0, n: 0 };
          tally[cat].sum += av;
          tally[cat].n += 1;
        }
      }
      const out: Record<string, number> = {};
      for (const [cat, { sum, n }] of Object.entries(tally)) {
        if (n > 0) out[cat] = Math.round((sum / n) * 100) / 100;
      }
      if (!cancelled) setWeaknessAgg(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, finals]);

  const commonWeaknesses = useMemo(() => {
    return Object.entries(weaknessAgg)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([k]) => k.replace(/_/g, " "));
  }, [weaknessAgg]);

  const readinessColors: Record<string, string> = {
    HIGH: "#10b981",
    MEDIUM: "#f59e0b",
    LOW: "#f97316",
    CRITICAL: "#f43f5e",
  };

  if (!organizationId) {
    return (
      <div className="p-6 max-w-xl mx-auto text-slate-600">
        Assessment workspace requires an organization context.
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <ClipboardCheck className="w-7 h-7 text-indigo-600" />
                Assessment &amp; Onboarding
              </h1>
              <p className="text-slate-600 mt-1">Pipeline of prospect hotels, scores, and conversion to BOAT clients.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAnalyticsOpen(!analyticsOpen)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-800 px-4 py-2.5 font-medium shadow-sm hover:bg-slate-50"
              >
                <LineChart className="w-4 h-4" />
                {analyticsOpen ? "Hide analytics" : "View analytics"}
              </button>
              <button
                type="button"
                onClick={() => onNavigate(HOTEL_ASSESSMENT_PAGE.run, {})}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium shadow hover:bg-indigo-700 transition"
              >
                <span className="text-lg leading-none">+</span>
                New assessment
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {analyticsOpen && (
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" /> Readiness distribution (final assessments)
            </h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={readinessChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="tier" tick={{ fill: "#64748b", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Assessments">
                    {readinessChart.map((e) => (
                      <Cell key={e.tier} fill={readinessColors[e.tier] ?? "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Building2 className="w-4 h-4" /> Hotels assessed
            </div>
            <div className="text-3xl font-semibold text-slate-900 mt-2">{loading ? "…" : distinctHotelsAssessed}</div>
            <p className="text-xs text-slate-400 mt-1">{hotelCountCaptured} captured in CRM</p>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <BarChart3 className="w-4 h-4" /> Avg score (final)
            </div>
            <div className="text-3xl font-semibold text-slate-900 mt-2">
              {loading ? "…" : avgScore == null ? "—" : avgScore.toFixed(2)}
            </div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Users className="w-4 h-4" /> Conversion (final → client)
            </div>
            <div className="text-3xl font-semibold text-slate-900 mt-2">
              {loading ? "…" : conversionRate == null ? "—" : `${conversionRate}%`}
            </div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm border-rose-100 bg-rose-50/40">
            <div className="flex items-center gap-2 text-rose-700 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" /> High-risk hotels
            </div>
            <div className="text-3xl font-semibold text-rose-900 mt-2">{loading ? "…" : highRiskHotels}</div>
            <p className="text-xs text-rose-700/80 mt-1">Distinct properties with LOW / CRITICAL readiness (final)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-amber-600" />
              Most common weaknesses
            </h2>
            <p className="text-sm text-slate-500 mt-1">Averaged across finalized assessments.</p>
            <ul className="mt-4 space-y-2">
              {(commonWeaknesses.length ? commonWeaknesses : ["Run a final assessment to populate this"]).map((w) => (
                <li key={w} className="flex items-center gap-2 text-slate-800 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              Commercial motion
            </h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Lead with leakage language in the wizard PDF, attach implementation ranges, then use{" "}
              <strong className="font-medium text-slate-800">Convert to proposal</strong> after finalization. Monetization paths
              commonly pair a low-cost diagnostic ({formatUgx(50_000)}–{formatUgx(500_000)}) with implementation in the millions.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-slate-900">Assessment pipeline</h2>
            <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => void load()}>
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Hotel name</th>
                  <th className="text-left font-medium px-4 py-3">Branch</th>
                  <th className="text-left font-medium px-4 py-3">Score</th>
                  <th className="text-left font-medium px-4 py-3">Readiness</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3">Updated</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Last PDF</th>
                  <th className="text-left font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">{a.onboarding_hotels?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{a.onboarding_branches?.name ?? "—"}</td>
                    <td className="px-4 py-3">{a.total_score != null ? a.total_score.toFixed(2) : "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          a.readiness_level === "HIGH"
                            ? "text-emerald-700 font-medium"
                            : a.readiness_level === "MEDIUM"
                              ? "text-amber-700 font-medium"
                              : a.readiness_level === "LOW"
                                ? "text-orange-700 font-medium"
                                : "text-rose-700 font-medium"
                        }
                      >
                        {a.readiness_level ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{a.status}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{a.assessment_date}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap hidden md:table-cell">
                      {a.status === "final" ? formatReportStamp(a.report_generated_at) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {a.status === "draft" ? (
                          <button
                            type="button"
                            className="text-xs inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white px-2.5 py-1 font-medium hover:bg-indigo-700"
                            onClick={() => onNavigate(HOTEL_ASSESSMENT_PAGE.run, { hotelAssessmentId: a.id })}
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                            Continue
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={pdfBusyId === a.id}
                              className="text-xs inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-60"
                              onClick={() => {
                                setPdfBusyId(a.id);
                                void downloadPersistedAssessmentReportPdf(a.id).then((ok) => {
                                  setPdfBusyId(null);
                                  if (ok) {
                                    toast.success("Report downloaded.");
                                    void load();
                                  } else toast.error("Could not build PDF — check scores are saved.");
                                });
                              }}
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              Reprint PDF
                            </button>
                            <button
                              type="button"
                              className="text-xs inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium hover:bg-slate-100 text-slate-700"
                              onClick={() =>
                                onNavigate(HOTEL_ASSESSMENT_PAGE.run, {
                                  hotelAssessmentId: a.id,
                                })
                              }
                            >
                              Summary
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && assessments.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                      No assessments yet — start with <strong>New assessment</strong>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
