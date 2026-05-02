import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileDown,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { HOTEL_ASSESSMENT_PAGE } from "@/lib/hotelPages";
import {
  ASSESSMENT_CATEGORY_WEIGHTS,
  ASSESSMENT_SCORE_ITEMS,
  buildRecommendations,
  calculateScore,
  categoryAveragesMap,
  defaultPricingForModule,
  estimateMonthlyRevenueLeakageUgx,
  formatLeakageSentenceUgx,
  formatRiskLabels,
  getReadiness,
  topRiskCategories,
  type ScoreRow,
} from "@/lib/hotelAssessmentEngine";
import { downloadPersistedAssessmentReportPdf } from "@/lib/hotelAssessmentDownload";
import {
  assessmentReportPdfFileName,
  getHotelAssessmentReportPdfBlob,
  triggerBrowserPdfDownload,
} from "@/lib/hotelAssessmentPdf";
import { persistAssessmentPdfToStorage } from "@/lib/hotelAssessmentReportStorage";

const SCORE_EMOJI = ["😡", "😕", "😐", "🙂", "😃"];

function scoreTone(n: number): string {
  if (n <= 2) return "border-rose-500 bg-rose-50 text-rose-900 shadow-[0_0_0_1px_rgba(244,63,94,0.35)]";
  if (n === 3) return "border-amber-400 bg-amber-50 text-amber-900 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]";
  return "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]";
}

type StepNum = 1 | 2 | 3 | 4;

function initialScores(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const row of ASSESSMENT_SCORE_ITEMS) {
    m[`${row.category}::${row.item}`] = 3;
  }
  return m;
}

function categoryTitle(cat: keyof typeof ASSESSMENT_CATEGORY_WEIGHTS | string): string {
  if (cat === "billing") return "Billing & payments";
  return String(cat).replace(/_/g, " ");
}

export function HotelAssessmentWizardPage({
  onNavigate,
  resumeAssessmentId,
}: {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
  resumeAssessmentId?: string | null;
}) {
  const { user } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const [step, setStep] = useState<StepNum>(1);
  const [saving, setSaving] = useState(false);

  const [hotelList, setHotelList] = useState<{ id: string; name: string }[]>([]);
  const [branchList, setBranchList] = useState<{ id: string; name: string; rooms: number; occupancy_rate: number }[]>(
    []
  );

  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState("");
  const [hotelLocation, setHotelLocation] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [numberOfBranches, setNumberOfBranches] = useState(1);

  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchChoice, setBranchChoice] = useState<string>("__new__");
  const [branchName, setBranchName] = useState("");
  const [branchLocation, setBranchLocation] = useState("");
  const [rooms, setRooms] = useState(0);
  const [occupancy, setOccupancy] = useState(0);

  const [assessorName, setAssessorName] = useState(() => user?.full_name?.trim() || "");
  const [scoresMap, setScoresMap] = useState<Record<string, number>>(initialScores);

  const [pain1, setPain1] = useState("");
  const [pain2, setPain2] = useState("");
  const [pain3, setPain3] = useState("");

  const [savedAssessmentId, setSavedAssessmentId] = useState<string | null>(null);
  /** Finalized assessments are immutable in-app; PDF is always rebuilt from saved rows on reprint. */
  const [savedLocked, setSavedLocked] = useState(false);

  /** Keep finished runs on review — steps 1–3 are editable only while draft. */
  useEffect(() => {
    if (savedLocked && step !== 4) setStep(4);
  }, [savedLocked, step]);

  useEffect(() => {
    if (!organizationId) return;
    void (async () => {
      const { data } = await supabase
        .from("onboarding_hotels")
        .select("id,name")
        .order("name");
      setHotelList((data || []) as { id: string; name: string }[]);
    })();
  }, [organizationId]);

  useEffect(() => {
    if (!hotelId) {
      setBranchList([]);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("onboarding_branches")
        .select("id,name,rooms,occupancy_rate")
        .eq("hotel_id", hotelId)
        .order("name");
      setBranchList(
        ((data || []) as { id: string; name: string; rooms: number; occupancy_rate: number }[]).map((b) => ({
          ...b,
          occupancy_rate: Number(b.occupancy_rate ?? 0),
        }))
      );
    })();
  }, [hotelId]);

  /** Resume draft/final assessment */
  useEffect(() => {
    const aid = resumeAssessmentId?.trim();
    if (!aid || !organizationId) return;
    let cancelled = false;
    void (async () => {
      const { data: ass, error: aErr } = await supabase.from("onboarding_assessments").select("*").eq("id", aid).maybeSingle();
      if (aErr || !ass || cancelled) {
        toast.error("Could not load assessment.");
        return;
      }
      const row = ass as Record<string, unknown>;
      const hotelPk = String(row.hotel_id ?? "");
      const branchPk = row.branch_id ? String(row.branch_id) : "";

      const [{ data: h }, { data: b }, { data: sc }] = await Promise.all([
        supabase.from("onboarding_hotels").select("*").eq("id", hotelPk).maybeSingle(),
        branchPk
          ? supabase.from("onboarding_branches").select("*").eq("id", branchPk).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("onboarding_assessment_scores").select("category,item,score").eq("assessment_id", aid),
      ]);

      if (cancelled) return;

      setSavedAssessmentId(aid);
      setHotelId(hotelPk || null);
      setBranchId(branchPk || null);
      setAssessorName(String(row.assessor_name ?? ""));
      setPain1(String(row.pain_point_1 ?? ""));
      setPain2(String(row.pain_point_2 ?? ""));
      setPain3(String(row.pain_point_3 ?? ""));

      if (h && !cancelled) {
        const hr = h as Record<string, unknown>;
        setHotelName(String(hr.name ?? ""));
        setHotelLocation(String(hr.location ?? ""));
        setContactPerson(String(hr.contact_person ?? ""));
        setPhone(String(hr.phone ?? ""));
        setEmail(String(hr.email ?? ""));
        setNumberOfBranches(Number(hr.number_of_branches ?? 1));
      }
      if (b && !cancelled) {
        const br = b as Record<string, unknown>;
        const bid = String(br.id ?? branchPk);
        setBranchChoice(bid);
        setBranchName(String(br.name ?? ""));
        setBranchLocation(String(br.location ?? ""));
        setRooms(Number(br.rooms ?? 0));
        setOccupancy(Number(br.occupancy_rate ?? 0));
      }

      const nextMap = initialScores();
      for (const srow of sc || []) {
        const cat = srow.category as string;
        const item = srow.item as string;
        const key = `${cat}::${item}`;
        if (key in nextMap) nextMap[key] = Number(srow.score);
      }
      setScoresMap(nextMap);

      /** Finalized assessments open on review only; drafts land on sparse step. */
      const filledPain = `${String(row.pain_point_1 ?? "").trim()}${String(row.pain_point_2 ?? "").trim()}${String(row.pain_point_3 ?? "").trim()}`;
      const isDraft = String(row.status ?? "") === "draft";
      setSavedLocked(!isDraft);
      if (!isDraft) setStep(4);
      else if (!filledPain) setStep(2);
      else setStep(4);
      toast.success("Assessment loaded.");
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeAssessmentId, organizationId]);

  const scoreRows: ScoreRow[] = useMemo(() => {
    return ASSESSMENT_SCORE_ITEMS.map((row) => ({
      category: row.category,
      item: row.item,
      score: scoresMap[`${row.category}::${row.item}`] ?? 3,
    }));
  }, [scoresMap]);

  const totalScore = useMemo(() => calculateScore(scoreRows), [scoreRows]);
  const readiness = useMemo(() => getReadiness(totalScore), [totalScore]);
  const risksKeys = useMemo(() => topRiskCategories(scoreRows, 3), [scoreRows]);
  const reco = useMemo(() => buildRecommendations(scoreRows), [scoreRows]);

  const leakage = useMemo(
    () => estimateMonthlyRevenueLeakageUgx({ weightedScore: totalScore, rooms, occupancyPct: occupancy }),
    [totalScore, rooms, occupancy]
  );

  const setScore = (category: string, item: string, value: number) => {
    setScoresMap((prev) => ({ ...prev, [`${category}::${item}`]: value }));
  };

  const persistCore = async (isFinal: boolean, withPdf: boolean) => {
    if (!organizationId) throw new Error("No organization");
    if (savedLocked) throw new Error("This assessment is finalized. Use Reprint PDF to download from saved data.");
    const dateStr = new Date().toISOString().slice(0, 10);
    const recoRows = buildRecommendations(scoreRows);
    let hid = hotelId;

    if (!hotelName.trim()) throw new Error("Hotel name required");
    if (!branchName.trim()) throw new Error("Branch required");

    if (!hid) {
      const ins = await supabase
        .from("onboarding_hotels")
        .insert({
          organization_id: organizationId,
          name: hotelName.trim(),
          location: hotelLocation.trim(),
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          number_of_branches: Math.max(0, Number(numberOfBranches) || 0),
        })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      hid = (ins.data as { id: string }).id;
      setHotelId(hid);
    } else {
      await supabase
        .from("onboarding_hotels")
        .update({
          name: hotelName.trim(),
          location: hotelLocation.trim(),
          contact_person: contactPerson.trim(),
          phone: phone.trim(),
          email: email.trim(),
          number_of_branches: Math.max(0, Number(numberOfBranches) || 0),
        })
        .eq("id", hid);
    }

    let bid: string | null = null;
    if (branchChoice === "__new__") {
      const bins = await supabase
        .from("onboarding_branches")
        .insert({
          hotel_id: hid,
          name: branchName.trim(),
          location: branchLocation.trim(),
          rooms: Math.max(0, Number(rooms) || 0),
          occupancy_rate: Math.min(100, Math.max(0, Number(occupancy) || 0)),
        })
        .select("id")
        .single();
      if (bins.error) throw bins.error;
      bid = (bins.data as { id: string }).id;
      setBranchId(bid);
    } else {
      bid = branchChoice;
      const bup = await supabase
        .from("onboarding_branches")
        .update({
          name: branchName.trim(),
          location: branchLocation.trim(),
          rooms: Math.max(0, Number(rooms) || 0),
          occupancy_rate: Math.min(100, Math.max(0, Number(occupancy) || 0)),
        })
        .eq("id", bid);
      if (bup.error) throw bup.error;
      setBranchId(bid);
    }

    const total = calculateScore(scoreRows);
    const readinessLevel = getReadiness(total);

    let aid = savedAssessmentId;
    const assessPayload = {
      organization_id: organizationId,
      hotel_id: hid,
      branch_id: bid,
      assessor_name: assessorName.trim() || "Assessor",
      assessment_date: dateStr,
      total_score: total,
      readiness_level: readinessLevel,
      status: isFinal ? "final" : "draft",
      pain_point_1: pain1.trim(),
      pain_point_2: pain2.trim(),
      pain_point_3: pain3.trim(),
      ...(isFinal ? { report_generated_at: new Date().toISOString() } : {}),
    };

    if (!aid) {
      const rins = await supabase.from("onboarding_assessments").insert(assessPayload).select("id").single();
      if (rins.error) throw rins.error;
      aid = (rins.data as { id: string }).id;
      setSavedAssessmentId(aid);
    } else {
      const up = await supabase.from("onboarding_assessments").update(assessPayload).eq("id", aid);
      if (up.error) throw up.error;
    }
    if (isFinal) setSavedLocked(true);

    await supabase.from("onboarding_assessment_scores").delete().eq("assessment_id", aid);
    const scoreInserts = scoreRows.map((r) => ({
      assessment_id: aid,
      category: r.category,
      item: r.item,
      score: r.score,
    }));
    const { error: sErr } = await supabase.from("onboarding_assessment_scores").insert(scoreInserts);
    if (sErr) throw sErr;

    await supabase.from("onboarding_recommendations").delete().eq("assessment_id", aid);
    if (recoRows.length) {
      const { error: rErr } = await supabase.from("onboarding_recommendations").insert(
        recoRows.map((r) => ({
          assessment_id: aid,
          module: r.module,
          priority: r.priority,
        }))
      );
      if (rErr) throw rErr;
    }

    if (withPdf && isFinal) {
      const pdfInput = {
        hotelName: hotelName.trim(),
        branchName: branchName.trim(),
        location: `${hotelLocation.trim()} / ${branchLocation.trim()}`.replace(/^\s*\/\s*|\/\s*$/g, ""),
        assessorName: assessorName.trim() || "Assessor",
        assessmentDate: dateStr,
        totalScore: total,
        readiness: readinessLevel,
        topRisks: risksKeys,
        scoreRows,
        recommendations: recoRows.map((r) => ({ module: r.module, priority: r.priority })),
        painPoints: [pain1.trim(), pain2.trim(), pain3.trim()] as [string, string, string],
        revenueLeakageLow: leakage.low,
        revenueLeakageHigh: leakage.high,
      };
      const blob = getHotelAssessmentReportPdfBlob(pdfInput);
      triggerBrowserPdfDownload(blob, assessmentReportPdfFileName(pdfInput.hotelName, pdfInput.assessmentDate));
      /** Archival copy (`report_generated_at` already set above). */
      const archived = await persistAssessmentPdfToStorage(organizationId, aid, blob, { touchReportGeneratedAt: false });
      if (!archived) toast.error("Report downloaded locally, but archive upload failed. Use Reprint to retry.", { duration: 5000 });
    }

    return { assessmentId: aid, total, readinessLevel, recoRows, dateStr };
  };

  const validateStep1 = () => {
    if (!hotelName.trim()) {
      toast.error("Enter the hotel name (or choose an existing hotel).");
      return false;
    }
    if (!branchName.trim()) {
      toast.error("Choose a branch or add a new branch name.");
      return false;
    }
    return true;
  };

  const onSaveDraft = async () => {
    setSaving(true);
    try {
      await persistCore(false, false);
      toast.success("Draft saved.");
      onNavigate(HOTEL_ASSESSMENT_PAGE.home);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not save draft.");
    } finally {
      setSaving(false);
    }
  };

  const onReprintPdfOnly = async () => {
    if (!savedAssessmentId) {
      toast.error("No assessment id.");
      return;
    }
    setSaving(true);
    try {
      const ok = await downloadPersistedAssessmentReportPdf(savedAssessmentId);
      if (ok) toast.success("PDF downloaded from saved assessment.");
      else toast.error("Could not build PDF from saved scores.");
    } catch (e) {
      console.error(e);
      toast.error("Could not reprint PDF.");
    } finally {
      setSaving(false);
    }
  };

  const onGenerateReport = async () => {
    setSaving(true);
    try {
      await persistCore(true, true);
      toast.success("Assessment finalized — saved and report downloaded.");
      onNavigate(HOTEL_ASSESSMENT_PAGE.home);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not finalize assessment.");
    } finally {
      setSaving(false);
    }
  };

  const selectExistingHotel = (id: string) => {
    const h = hotelList.find((x) => x.id === id);
    setHotelId(id);
    setHotelName(h?.name ?? "");
    setBranchChoice("__new__");
    setBranchId(null);
    setBranchName("");
    setBranchLocation("");
    setRooms(0);
    setOccupancy(0);
    void (async () => {
      const { data } = await supabase.from("onboarding_hotels").select("*").eq("id", id).maybeSingle();
      if (!data) return;
      const row = data as Record<string, unknown>;
      setHotelLocation(String(row.location ?? ""));
      setContactPerson(String(row.contact_person ?? ""));
      setPhone(String(row.phone ?? ""));
      setEmail(String(row.email ?? ""));
      setNumberOfBranches(Number(row.number_of_branches ?? 1));
    })();
  };

  const pickBranchTemplate = (id: string) => {
    if (id === "__new__") {
      setBranchChoice("__new__");
      setBranchId(null);
      setBranchName("");
      setBranchLocation("");
      setRooms(0);
      setOccupancy(0);
      return;
    }
    const b = branchList.find((x) => x.id === id);
    setBranchChoice(id);
    setBranchId(id);
    if (b) {
      setBranchName(b.name);
      setRooms(b.rooms);
      setOccupancy(b.occupancy_rate);
    }
  };

  const feedbackPanel = (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm space-y-4 sticky top-4">
      <div className="flex items-center gap-2 text-indigo-900 font-semibold">
        <Sparkles className="w-5 h-5" />
        Live feedback
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total score</div>
        <div className="text-3xl font-bold text-slate-900">{totalScore.toFixed(2)}</div>
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Readiness</div>
        <div
          className={`text-xl font-semibold ${
            readiness === "HIGH"
              ? "text-emerald-700"
              : readiness === "MEDIUM"
                ? "text-amber-700"
                : readiness === "LOW"
                  ? "text-orange-700"
                  : "text-rose-700"
          }`}
        >
          {readiness}
        </div>
      </div>

      <div className="rounded-xl bg-white/70 border border-amber-100 p-3">
        <div className="flex items-center gap-1.5 text-amber-800 text-xs font-semibold uppercase tracking-wide mb-1">
          <Zap className="w-3.5 h-3.5" /> Est. revenue leakage
        </div>
        <p className="text-sm text-slate-800 leading-snug">{formatLeakageSentenceUgx(leakage.low, leakage.high)}</p>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-600">Top risks</div>
        <ul className="mt-2 space-y-1 text-sm text-slate-800 list-disc ml-5">
          {(formatRiskLabels(risksKeys).length ? formatRiskLabels(risksKeys) : ["None singled out"]).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-sm font-medium text-slate-600">Recommended modules</div>
        <ul className="mt-2 space-y-2">
          {reco.slice(0, 8).map((r) => (
            <li key={r.module} className="text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{r.module}</span>
            </li>
          ))}
          {!reco.length && <li className="text-sm text-slate-500">Strong across measured areas.</li>}
        </ul>
      </div>
      <div className="text-[11px] text-slate-500 leading-snug border-t border-slate-100 pt-3">
        Very poor ← → Excellent on the scale; red / amber / green highlights severity.
      </div>
    </div>
  );

  const stepDots = ["Hotel & branch", "Operations score", "Pain points", "Review & finalize"] as const;

  return (
    <div className="min-h-[calc(100vh-6rem)] bg-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          onClick={() => onNavigate(HOTEL_ASSESSMENT_PAGE.home)}
        >
          <ArrowLeft className="w-4 h-4" />
          Assessment dashboard
        </button>

        {savedLocked && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950 px-4 py-3 text-sm leading-snug">
            <strong className="font-semibold">Finalized.</strong> All scores and pain points are stored. You can reprint the PDF
            anytime — this record is read-only here to keep the audit trail consistent.
          </div>
        )}

        <div className={`flex flex-wrap items-center gap-2 sm:gap-3 ${savedLocked ? "opacity-70 pointer-events-none" : ""}`}>
          {stepDots.map((label, i) => {
            const n = (i + 1) as StepNum;
            const active = step >= n;
            return (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {n}
                </div>
                <span className={`text-xs sm:text-sm max-w-[7rem] sm:max-w-none ${active ? "text-slate-900 font-medium" : "text-slate-500"}`}>
                  {label}
                </span>
                {n < 4 && <div className="w-4 sm:w-8 h-px bg-slate-200 shrink-0 hidden sm:block" />}
              </div>
            );
          })}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
              <h2 className="text-lg font-semibold text-slate-900">Step 1 — Hotel &amp; branch</h2>

              <div>
                <span className="text-sm text-slate-600">Existing hotel</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-900"
                  value={hotelId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      setHotelId(null);
                      return;
                    }
                    selectExistingHotel(v);
                  }}
                >
                  <option value="">— New prospect (enter below) —</option>
                  {hotelList.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="block">
                <span className="text-sm text-slate-600">Hotel name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={hotelName}
                  onChange={(e) => {
                    setHotelName(e.target.value);
                    setHotelId(null);
                  }}
                  placeholder="Property trading name"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block sm:col-span-2">
                  <span className="text-sm text-slate-600">Primary location</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={hotelLocation}
                    onChange={(e) => setHotelLocation(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-600">Contact person</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-600">Phone</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm text-slate-600">Email</span>
                  <input
                    type="email"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-600">Portfolio branches (#)</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={numberOfBranches}
                    onChange={(e) => setNumberOfBranches(Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <h3 className="font-medium text-slate-800">Branch under assessment</h3>
                {hotelId && branchList.length > 0 ? (
                  <div>
                    <span className="text-sm text-slate-600">Branch</span>
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                      value={branchChoice}
                      onChange={(e) => pickBranchTemplate(e.target.value)}
                    >
                      <option value="__new__">+ Add new branch</option>
                      {branchList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block sm:col-span-2">
                    <span className="text-sm text-slate-600">Branch name</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-sm text-slate-600">Branch location</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={branchLocation}
                      onChange={(e) => setBranchLocation(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-600">Rooms</span>
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={rooms}
                      onChange={(e) => setRooms(Number(e.target.value))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-600">Occupancy %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={occupancy}
                      onChange={(e) => setOccupancy(Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <label className="block">
                <span className="text-sm text-slate-600">Assessor name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={assessorName}
                  onChange={(e) => setAssessorName(e.target.value)}
                />
              </label>

              <button
                type="button"
                className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700"
                onClick={() => validateStep1() && setStep(2)}
              >
                Next →
              </button>
            </div>
            <div>{feedbackPanel}</div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-indigo-600 shrink-0" />
                  Step 2 — Score operations (1 = very poor, 5 = excellent)
                </h2>
                <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => setStep(1)}>
                  Edit hotel
                </button>
              </div>

              <p className="text-xs text-slate-500 -mt-4 inline-flex gap-3 flex-wrap items-center">
                <span>{SCORE_EMOJI.join(" ")}</span>
                <span>Very poor</span>
                <span className="text-slate-300">————————</span>
                <span>Excellent</span>
              </p>

              {(Object.keys(ASSESSMENT_CATEGORY_WEIGHTS) as (keyof typeof ASSESSMENT_CATEGORY_WEIGHTS)[]).map((cat) => {
                const items = ASSESSMENT_SCORE_ITEMS.filter((r) => r.category === cat);
                return (
                  <section key={cat} className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <h3 className="font-medium text-slate-800 capitalize">{categoryTitle(cat)}</h3>
                      <span className="text-xs text-slate-500">
                        Avg {categoryAveragesMap(scoreRows)[cat]?.toFixed(2) ?? "—"}
                      </span>
                    </div>
                    {items.map((row) => {
                      const v = scoresMap[`${row.category}::${row.item}`] ?? 3;
                      return (
                        <div key={row.item} className="space-y-2">
                          <div className="text-sm font-medium text-slate-700">{row.item}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                aria-label={`Score ${n}`}
                                onClick={() => setScore(row.category, row.item, n)}
                                title={`${n} — ${SCORE_EMOJI[n - 1] ?? ""}`}
                                className={`flex flex-col items-center justify-center min-w-[3.25rem] px-1.5 py-2 rounded-xl text-xs font-semibold border-2 transition ${scoreTone(n)} ${
                                  v === n ? "ring-2 ring-indigo-500 ring-offset-1 scale-[1.02]" : "opacity-80 hover:opacity-100"
                                }`}
                              >
                                <span className="text-lg leading-none">{SCORE_EMOJI[n - 1] ?? ""}</span>
                                <span className="text-[11px] mt-1">{n}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })}

              <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700"
                  onClick={() => setStep(3)}
                >
                  Next → pain points
                </button>
                <button type="button" className="text-sm text-slate-600 px-3 py-2" onClick={() => setStep(1)}>
                  Back
                </button>
              </div>
            </div>
            <div>{feedbackPanel}</div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
              <h2 className="text-lg font-semibold text-slate-900">Step 3 — Key pain points</h2>
              <p className="text-sm text-slate-600">Capture three priorities they mentioned — these surface in the client PDF.</p>
              {[1, 2, 3].map((i) => (
                <label key={i} className="block">
                  <span className="text-sm text-slate-600">{i}.</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={i === 1 ? pain1 : i === 2 ? pain2 : pain3}
                    onChange={(e) => (i === 1 ? setPain1 : i === 2 ? setPain2 : setPain3)(e.target.value)}
                    placeholder="e.g. Night audit never balances with bar stock"
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700"
                  onClick={() => setStep(4)}
                >
                  Next → review
                </button>
                <button type="button" className="text-sm text-slate-600 px-3 py-2" onClick={() => setStep(2)}>
                  Back
                </button>
              </div>
            </div>
            <div>{feedbackPanel}</div>
          </div>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-6">
              <h2 className="text-lg font-semibold text-slate-900">Step 4 — Review &amp; finalize</h2>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2 text-sm">
                <p>
                  <span className="text-slate-500">Score:</span>{" "}
                  <span className="font-semibold text-slate-900">{totalScore.toFixed(2)}</span>
                </p>
                <p>
                  <span className="text-slate-500">Readiness:</span>{" "}
                  <span className="font-semibold text-slate-900">{readiness}</span>
                </p>
                <p className="text-slate-600 pt-2 leading-snug">{formatLeakageSentenceUgx(leakage.low, leakage.high)}</p>
                <div className="pt-2">
                  <div className="text-slate-500 text-xs uppercase font-semibold mb-1">Modules recommended</div>
                  <ul className="list-disc ml-5 space-y-0.5">
                    {reco.map((r) => (
                      <li key={r.module}>{r.module}</li>
                    ))}
                    {!reco.length && <li className="text-slate-500">None beyond baseline</li>}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-3">
                {savedLocked ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onReprintPdfOnly()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      Reprint PDF
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-800 hover:bg-slate-50"
                      onClick={() => onNavigate(HOTEL_ASSESSMENT_PAGE.home)}
                    >
                      Back to list
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onGenerateReport()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Finalize &amp; download report
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onSaveDraft()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Save as draft
                    </button>
                    <button type="button" className="text-sm text-slate-600 px-3 py-2 sm:ml-0" onClick={() => setStep(3)}>
                      Back
                    </button>
                  </>
                )}
              </div>

              <div className="border-t border-slate-100 pt-5 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">After the report</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    onClick={() => {
                      const subj = encodeURIComponent(`Hotel assessment — ${hotelName}`);
                      const body = encodeURIComponent(
                        `Please find the BOAT assessment summary for ${hotelName} (${branchName}).\n\nScore: ${totalScore.toFixed(2)}\nReadiness: ${readiness}`
                      );
                      window.open(`mailto:${email || ""}?subject=${subj}&body=${body}`, "_blank");
                      toast("Opened email draft — attach the PDF from your downloads folder.");
                    }}
                  >
                    <Mail className="w-4 h-4" /> Send via email
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    onClick={() => {
                      const lines = [
                        "PROPOSAL (from assessment)",
                        `Hotel: ${hotelName} · ${branchName}`,
                        `Score ${totalScore.toFixed(2)} · ${readiness}`,
                        "",
                        ...buildRecommendations(scoreRows).map(
                          (r) =>
                            `• ${r.module} (${r.priority}) — setup ~UGX ${defaultPricingForModule(r.module).setup.toLocaleString("en-UG")}`
                        ),
                      ];
                      void navigator.clipboard?.writeText(lines.join("\n"));
                      toast.success("Proposal outline copied — paste into your quote template.");
                    }}
                  >
                    <Send className="w-4 h-4" /> Convert to proposal
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 hover:bg-emerald-100"
                    onClick={() =>
                      toast(
                        "Create the live BOAT organization from Platform → Organizations, then enable recommended modules in that tenant. Full one-click provisioning can plug in here later.",
                        { duration: 6000 }
                      )
                    }
                  >
                    <Zap className="w-4 h-4" /> Activate system for this hotel
                  </button>
                </div>
              </div>
            </div>
            <div>{feedbackPanel}</div>
          </div>
        )}
      </div>
    </div>
  );
}
