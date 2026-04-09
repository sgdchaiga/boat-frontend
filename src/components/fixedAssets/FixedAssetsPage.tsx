import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Layers, LineChart, History, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import {
  clearJournalAccountCache,
  createJournalForFixedAssetCapitalization,
  createJournalForFixedAssetDepreciationRun,
  createJournalForFixedAssetDisposal,
  createJournalForFixedAssetImpairment,
  createJournalForFixedAssetRevaluation,
} from "@/lib/journal";
import {
  computeDepreciationForPeriod,
  netBookValue,
  roundMoney,
  type DepreciationFrequency,
  type DepreciationMethod,
} from "@/lib/fixedAssetsDepreciation";
import { fetchFixedAssetOrgSettings, upsertFixedAssetOrgSettings, type FixedAssetOrgSettingsRow } from "@/lib/fixedAssetOrgSettings";
import { addDays, isPeriodDue, suggestNextPeriodAfter, type AutoDepreciationFrequency } from "@/lib/fixedAssetSchedule";
import { PageNotes } from "@/components/common/PageNotes";

type Tab = "register" | "categories" | "depreciation" | "lifecycle";

type FaCategory = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  /** Straight-line default: useful life in months. */
  default_useful_life_months?: number | null;
  /** Reducing balance default: annual rate % (e.g. 25 for 25%). */
  default_reducing_balance_rate_percent?: number | null;
};

/** PostgREST when DB migration not applied yet. */
function isMissingFaCategoryDepColumnError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const m = (err.message || "").toLowerCase();
  return (
    String(err.code || "") === "PGRST204" ||
    m.includes("schema cache") ||
    m.includes("default_reducing_balance_rate_percent") ||
    m.includes("default_useful_life_months")
  );
}

/** Sub-tree under `rootId` (not including `rootId`). Used to avoid parent cycles when editing. */
function descendantIdsOf(categories: FaCategory[], rootId: string): Set<string> {
  const byParent = new Map<string | null, FaCategory[]>();
  for (const c of categories) {
    const p = c.parent_id ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(c);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const ch of byParent.get(id) ?? []) {
      out.add(ch.id);
      walk(ch.id);
    }
  };
  walk(rootId);
  return out;
}

type FaAsset = {
  id: string;
  organization_id: string;
  asset_code: string;
  barcode: string | null;
  qr_code_payload: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  room_or_location: string | null;
  custodian_staff_id: string | null;
  custodian_name: string | null;
  supplier_name: string | null;
  invoice_reference: string | null;
  purchase_date: string | null;
  cost: number;
  funding_source: string | null;
  status: "draft" | "capitalized" | "disposed";
  depreciation_method: DepreciationMethod;
  useful_life_months: number | null;
  residual_value: number;
  reducing_balance_rate_percent: number | null;
  units_total: number | null;
  units_produced_to_date: number;
  depreciation_frequency: DepreciationFrequency;
  in_service_date: string | null;
  last_depreciation_period_end: string | null;
  accumulated_depreciation: number;
  revaluation_adjustment: number;
  impairment_loss_accumulated: number;
  disposed_at: string | null;
  impairment_review_due_date?: string | null;
};

type FaEvent = {
  id: string;
  asset_id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type Department = { id: string; name: string };
type StaffRow = { id: string; full_name: string };

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "register", label: "Register", icon: Building2 },
  { id: "categories", label: "Categories", icon: Layers },
  { id: "depreciation", label: "Depreciation", icon: LineChart },
  { id: "lifecycle", label: "Lifecycle log", icon: History },
];

/** Suggested top-level classes; duplicates (same name per org) are skipped. */
const COMMON_FA_CATEGORY_NAMES = [
  "Land",
  "Buildings",
  "Plant & machinery",
  "Motor vehicles",
  "Fixtures & fittings",
  "Computer equipment",
];

function emptyAssetDraft(): Partial<FaAsset> {
  return {
    asset_code: "",
    name: "",
    cost: 0,
    residual_value: 0,
    status: "draft",
    depreciation_method: "straight_line",
    depreciation_frequency: "monthly",
    units_produced_to_date: 0,
    accumulated_depreciation: 0,
    revaluation_adjustment: 0,
    impairment_loss_accumulated: 0,
    impairment_review_due_date: null,
  };
}

export function FixedAssetsPage({ readOnly }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const uid = user?.id ?? null;

  const [tab, setTab] = useState<Tab>("register");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [categories, setCategories] = useState<FaCategory[]>([]);
  const [assets, setAssets] = useState<FaAsset[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [events, setEvents] = useState<(FaEvent & { asset_name?: string })[]>([]);

  const [assetModal, setAssetModal] = useState<"add" | "edit" | null>(null);
  const [draft, setDraft] = useState<Partial<FaAsset>>(emptyAssetDraft());
  const [editingId, setEditingId] = useState<string | null>(null);

  const [catName, setCatName] = useState("");
  const [catParentId, setCatParentId] = useState<string>("");
  const [catDefaultUsefulLife, setCatDefaultUsefulLife] = useState("");
  const [catDefaultRbRate, setCatDefaultRbRate] = useState("");
  /** When set, left panel updates this category instead of inserting. */
  const [catEditingId, setCatEditingId] = useState<string | null>(null);

  const [depPeriodStart, setDepPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [depPeriodEnd, setDepPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [depFreq, setDepFreq] = useState<DepreciationFrequency>("monthly");
  const [previewLines, setPreviewLines] = useState<
    { asset_id: string; code: string; name: string; amount: number; note: string }[]
  >([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [unitsByAsset, setUnitsByAsset] = useState<Record<string, string>>({});
  const [depPosting, setDepPosting] = useState(false);

  const [orgSchedule, setOrgSchedule] = useState<FixedAssetOrgSettingsRow | null>(null);
  const [scheduleAutoEnabled, setScheduleAutoEnabled] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState<AutoDepreciationFrequency>("monthly");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [depreciationReminder, setDepreciationReminder] = useState<{
    periodStart: string;
    periodEnd: string;
  } | null>(null);

  type FaDepAlert = {
    id: string;
    organization_id: string;
    period_start: string;
    period_end: string;
    frequency: string;
    dismissed_at: string | null;
  };
  const [faAlerts, setFaAlerts] = useState<FaDepAlert[]>([]);

  const [actionModal, setActionModal] = useState<
    null | { type: "dispose" | "impair" | "revalue" | "transfer"; asset: FaAsset }
  >(null);
  const [actionAmount, setActionAmount] = useState("");
  const [actionProceeds, setActionProceeds] = useState("");
  const [actionBranch, setActionBranch] = useState("");
  const [actionDept, setActionDept] = useState("");
  const [actionRoom, setActionRoom] = useState("");

  const categoryById = useMemo(() => {
    const m = new Map<string, FaCategory>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const categoryParentOptions = useMemo(() => {
    if (catEditingId) {
      const banned = new Set([catEditingId, ...descendantIdsOf(categories, catEditingId)]);
      return categories.filter((c) => !banned.has(c.id));
    }
    return categories.filter((c) => !c.parent_id);
  }, [categories, catEditingId]);

  const categoriesSortedFlat = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
  }, [categories]);

  const categoryDepth = useCallback(
    (c: FaCategory) => {
      let d = 0;
      let cur: FaCategory | undefined = c;
      while (cur?.parent_id) {
        d += 1;
        cur = categoryById.get(cur.parent_id);
      }
      return d;
    },
    [categoryById]
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const impairmentSoonLimit = addDays(todayIso, 30);

  const loadAll = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);

    const [cRes, aRes, dRes, sRes, eRes] = await Promise.all([
      filterByOrganizationId(
        supabase.from("fixed_asset_categories").select("*").order("sort_order").order("name"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(supabase.from("fixed_assets").select("*").order("asset_code"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("departments").select("id, name").order("name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("staff").select("id, full_name").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(
        supabase.from("fixed_asset_events").select("*").order("created_at", { ascending: false }).limit(200),
        orgId,
        superAdmin
      ),
    ]);

    try {
      const os = await fetchFixedAssetOrgSettings(orgId);
      if (os) {
        setOrgSchedule(os);
        setScheduleAutoEnabled(!!os.auto_depreciation_enabled);
        setScheduleFreq(os.auto_depreciation_frequency || "monthly");
      } else {
        setOrgSchedule(null);
        setScheduleAutoEnabled(false);
        setScheduleFreq("monthly");
      }
    } catch {
      setOrgSchedule(null);
      setScheduleAutoEnabled(false);
      setScheduleFreq("monthly");
    }

    if (cRes.error) setErr(cRes.error.message);
    else setCategories((cRes.data as FaCategory[]) || []);

    if (aRes.error) setErr(aRes.error.message);
    else setAssets((aRes.data as FaAsset[]) || []);

    if (!dRes.error && dRes.data) setDepartments(dRes.data as Department[]);
    if (!sRes.error && sRes.data) setStaffList(sRes.data as StaffRow[]);

    if (!eRes.error && eRes.data) {
      const evs = eRes.data as FaEvent[];
      const assetIds = [...new Set(evs.map((e) => e.asset_id))];
      let nameById: Record<string, string> = {};
      if (assetIds.length > 0) {
        const { data: an } = await supabase.from("fixed_assets").select("id, name").in("id", assetIds);
        nameById = Object.fromEntries((an || []).map((r: { id: string; name: string }) => [r.id, r.name]));
      }
      setEvents(evs.map((e) => ({ ...e, asset_name: nameById[e.asset_id] })));
    }

    try {
      await supabase.rpc("refresh_fixed_asset_depreciation_alerts");
    } catch {
      /* migration not applied */
    }
    const { data: alertRows } = await supabase
      .from("fixed_asset_depreciation_alerts")
      .select("id, organization_id, period_start, period_end, frequency, dismissed_at")
      .eq("organization_id", orgId)
      .is("dismissed_at", null)
      .order("period_end", { ascending: false });
    setFaAlerts((alertRows as FaDepAlert[]) || []);

    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!orgId || !scheduleAutoEnabled || !assets.some((a) => a.status === "capitalized")) {
      setDepreciationReminder(null);
      return;
    }
    const last = orgSchedule?.auto_depreciation_last_period_end ?? null;
    const { periodStart, periodEnd } = suggestNextPeriodAfter(last, scheduleFreq);
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!isPeriodDue(todayIso, periodEnd)) {
      setDepreciationReminder(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("fixed_asset_depreciation_runs")
        .select("id")
        .eq("organization_id", orgId)
        .eq("period_end", periodEnd)
        .eq("frequency", scheduleFreq)
        .eq("status", "posted")
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setDepreciationReminder({ periodStart, periodEnd });
      } else {
        setDepreciationReminder(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, scheduleAutoEnabled, scheduleFreq, orgSchedule?.auto_depreciation_last_period_end, assets]);

  const saveScheduleSettings = async () => {
    if (!orgId || readOnly) return;
    setScheduleSaving(true);
    setErr(null);
    try {
      await upsertFixedAssetOrgSettings(orgId, {
        auto_depreciation_enabled: scheduleAutoEnabled,
        auto_depreciation_frequency: scheduleFreq,
      });
      const os = await fetchFixedAssetOrgSettings(orgId);
      setOrgSchedule(os);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save schedule settings.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const applyReminderPeriod = () => {
    if (!depreciationReminder) return;
    setDepPeriodStart(depreciationReminder.periodStart);
    setDepPeriodEnd(depreciationReminder.periodEnd);
    setDepFreq(scheduleFreq);
  };

  const openAdd = () => {
    setDraft(emptyAssetDraft());
    setEditingId(null);
    setAssetModal("add");
  };

  const openEdit = (a: FaAsset) => {
    setDraft({ ...a });
    setEditingId(a.id);
    setAssetModal("edit");
  };

  const saveAsset = async () => {
    if (!orgId || !draft.asset_code?.trim() || !draft.name?.trim()) {
      setErr("Asset code and name are required.");
      return;
    }
    const payload = {
      organization_id: orgId,
      asset_code: draft.asset_code.trim(),
      barcode: draft.barcode?.trim() || null,
      qr_code_payload: draft.qr_code_payload?.trim() || null,
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      category_id: draft.category_id || null,
      branch_name: draft.branch_name?.trim() || null,
      department_id: draft.department_id || null,
      room_or_location: draft.room_or_location?.trim() || null,
      custodian_staff_id: draft.custodian_staff_id || null,
      custodian_name: draft.custodian_name?.trim() || null,
      supplier_name: draft.supplier_name?.trim() || null,
      invoice_reference: draft.invoice_reference?.trim() || null,
      purchase_date: draft.purchase_date || null,
      cost: Number(draft.cost) || 0,
      funding_source: draft.funding_source?.trim() || null,
      status: draft.status || "draft",
      depreciation_method: draft.depreciation_method || "straight_line",
      useful_life_months: draft.useful_life_months ?? null,
      residual_value: Number(draft.residual_value) || 0,
      reducing_balance_rate_percent: draft.reducing_balance_rate_percent ?? null,
      units_total: draft.units_total ?? null,
      units_produced_to_date: Number(draft.units_produced_to_date) || 0,
      depreciation_frequency: draft.depreciation_frequency || "monthly",
      in_service_date: draft.in_service_date || null,
      last_depreciation_period_end: draft.last_depreciation_period_end || null,
      accumulated_depreciation: Number(draft.accumulated_depreciation) || 0,
      revaluation_adjustment: Number(draft.revaluation_adjustment) || 0,
      impairment_loss_accumulated: Number(draft.impairment_loss_accumulated) || 0,
      disposed_at: draft.disposed_at || null,
      impairment_review_due_date: draft.impairment_review_due_date || null,
    };

    if (editingId) {
      const { error } = await supabase.from("fixed_assets").update(payload).eq("id", editingId);
      if (error) setErr(error.message);
      else {
        setAssetModal(null);
        loadAll();
      }
    } else {
      const { error } = await supabase.from("fixed_assets").insert(payload);
      if (error) setErr(error.message);
      else {
        setAssetModal(null);
        loadAll();
      }
    }
  };

  const capitalize = async (a: FaAsset) => {
    if (!uid || readOnly) return;
    setErr(null);
    const cost = Number(a.cost) || 0;
    if (cost <= 0) {
      setErr("Set a positive cost before capitalization.");
      return;
    }
    const jr = await createJournalForFixedAssetCapitalization(a.id, cost, a.purchase_date || new Date().toISOString().slice(0, 10), uid);
    if (!jr.ok) {
      setErr(jr.error);
      return;
    }
    await supabase
      .from("fixed_assets")
      .update({
        status: "capitalized",
        capitalized_journal_entry_id: jr.journalId,
      })
      .eq("id", a.id);
    await supabase.from("fixed_asset_events").insert({
      organization_id: orgId,
      asset_id: a.id,
      event_type: "capitalization",
      event_date: a.purchase_date || new Date().toISOString().slice(0, 10),
      notes: "Capitalized to PPE",
      payload: { journal_id: jr.journalId, amount: cost },
      created_by: uid,
    });
    clearJournalAccountCache();
    loadAll();
  };

  const runPreview = () => {
    setErr(null);
    const lines: typeof previewLines = [];
    let total = 0;
    for (const a of assets) {
      if (a.status !== "capitalized") continue;
      const uopUnits =
        a.depreciation_method === "units_of_production"
          ? Number(unitsByAsset[a.id] ?? 0) || null
          : null;
      const r = computeDepreciationForPeriod(
        {
          cost: a.cost,
          residual_value: a.residual_value,
          accumulated_depreciation: a.accumulated_depreciation,
          revaluation_adjustment: a.revaluation_adjustment,
          impairment_loss_accumulated: a.impairment_loss_accumulated,
          depreciation_method: a.depreciation_method,
          useful_life_months: a.useful_life_months,
          reducing_balance_rate_percent: a.reducing_balance_rate_percent,
          units_total: a.units_total,
          units_produced_to_date: a.units_produced_to_date,
          depreciation_frequency: depFreq,
          in_service_date: a.in_service_date,
          last_depreciation_period_end: a.last_depreciation_period_end,
        },
        depPeriodStart,
        depPeriodEnd,
        uopUnits
      );
      if (r.ok && r.amount > 0) {
        total += r.amount;
        lines.push({
          asset_id: a.id,
          code: a.asset_code,
          name: a.name,
          amount: r.amount,
          note: r.note,
        });
      }
    }
    setPreviewLines(lines);
    setPreviewTotal(roundMoney(total));
  };

  const postDepreciation = async () => {
    if (!orgId || !uid || readOnly) return;
    if (previewLines.length === 0 || previewTotal <= 0) {
      setErr("Preview a period with depreciation first.");
      return;
    }
    setDepPosting(true);
    setErr(null);
    const { data: runRow, error: runErr } = await supabase
      .from("fixed_asset_depreciation_runs")
      .insert({
        organization_id: orgId,
        period_start: depPeriodStart,
        period_end: depPeriodEnd,
        frequency: depFreq,
        status: "draft",
        total_amount: previewTotal,
        created_by: uid,
      })
      .select("id")
      .single();
    if (runErr || !runRow) {
      setErr(runErr?.message || "Could not create run");
      setDepPosting(false);
      return;
    }
    const runId = runRow.id as string;

    for (const ln of previewLines) {
      const a = assets.find((x) => x.id === ln.asset_id);
      const uop =
        a?.depreciation_method === "units_of_production" ? Number(unitsByAsset[a.id] ?? 0) || null : null;
      await supabase.from("fixed_asset_depreciation_lines").insert({
        run_id: runId,
        asset_id: ln.asset_id,
        amount: ln.amount,
        units_in_period: uop,
        note: ln.note,
      });
    }

    const jr = await createJournalForFixedAssetDepreciationRun(runId, previewTotal, depPeriodEnd, uid);
    if (!jr.ok) {
      await supabase.from("fixed_asset_depreciation_runs").update({ status: "failed", error_message: jr.error }).eq("id", runId);
      setErr(jr.error);
      setDepPosting(false);
      return;
    }

    for (const ln of previewLines) {
      const a = assets.find((x) => x.id === ln.asset_id);
      if (!a) continue;
      const newAcc = roundMoney(a.accumulated_depreciation + ln.amount);
      let newUnits = a.units_produced_to_date;
      if (a.depreciation_method === "units_of_production") {
        newUnits = roundMoney(a.units_produced_to_date + (Number(unitsByAsset[a.id]) || 0));
      }
      await supabase
        .from("fixed_assets")
        .update({
          accumulated_depreciation: newAcc,
          last_depreciation_period_end: depPeriodEnd,
          units_produced_to_date: newUnits,
        })
        .eq("id", ln.asset_id);
      await supabase.from("fixed_asset_events").insert({
        organization_id: orgId,
        asset_id: ln.asset_id,
        event_type: "depreciation",
        event_date: depPeriodEnd,
        notes: `Run ${depPeriodStart} → ${depPeriodEnd}`,
        payload: { run_id: runId, amount: ln.amount },
        journal_entry_id: jr.journalId,
        created_by: uid,
      });
    }

    await supabase
      .from("fixed_asset_depreciation_runs")
      .update({ status: "posted", journal_entry_id: jr.journalId })
      .eq("id", runId);

    try {
      await upsertFixedAssetOrgSettings(orgId, {
        auto_depreciation_last_period_end: depPeriodEnd,
      });
      const os = await fetchFixedAssetOrgSettings(orgId);
      setOrgSchedule(os);
    } catch {
      /* optional tracking */
    }

    clearJournalAccountCache();
    setPreviewLines([]);
    setPreviewTotal(0);
    setDepPosting(false);
    loadAll();
  };

  const cancelCategoryEdit = () => {
    setCatEditingId(null);
    setCatName("");
    setCatParentId("");
    setCatDefaultUsefulLife("");
    setCatDefaultRbRate("");
  };

  const startEditCategory = (c: FaCategory) => {
    setErr(null);
    setCatEditingId(c.id);
    setCatName(c.name);
    setCatParentId(c.parent_id ?? "");
    setCatDefaultUsefulLife(
      c.default_useful_life_months != null && c.default_useful_life_months > 0
        ? String(c.default_useful_life_months)
        : ""
    );
    setCatDefaultRbRate(
      c.default_reducing_balance_rate_percent != null && c.default_reducing_balance_rate_percent > 0
        ? String(c.default_reducing_balance_rate_percent)
        : ""
    );
  };

  const parseCategoryDepreciationFields = (): {
    default_useful_life_months: number | null;
    default_reducing_balance_rate_percent: number | null;
  } | null => {
    let default_useful_life_months: number | null = null;
    if (catDefaultUsefulLife.trim()) {
      const n = parseInt(catDefaultUsefulLife.trim(), 10);
      if (!Number.isFinite(n) || n <= 0) {
        setErr("Default useful life must be a positive whole number of months (or leave empty).");
        return null;
      }
      default_useful_life_months = n;
    }
    let default_reducing_balance_rate_percent: number | null = null;
    if (catDefaultRbRate.trim()) {
      const r = Number(catDefaultRbRate.trim());
      if (!Number.isFinite(r) || r <= 0) {
        setErr("Default reducing-balance rate must be a positive percent (or leave empty).");
        return null;
      }
      default_reducing_balance_rate_percent = r;
    }
    return { default_useful_life_months, default_reducing_balance_rate_percent };
  };

  const saveCategory = async () => {
    if (!orgId || !catName.trim()) return;
    setErr(null);
    const depDefaults = parseCategoryDepreciationFields();
    if (depDefaults === null) return;

    const wantsDep =
      depDefaults.default_useful_life_months != null ||
      depDefaults.default_reducing_balance_rate_percent != null;

    if (catEditingId) {
      const parent = catParentId || null;
      if (parent === catEditingId) {
        setErr("A category cannot be its own parent.");
        return;
      }
      if (parent && descendantIdsOf(categories, catEditingId).has(parent)) {
        setErr("Cannot move a category under one of its sub-categories.");
        return;
      }
      let usedDepFallback = false;
      let { error } = await supabase
        .from("fixed_asset_categories")
        .update({
          name: catName.trim(),
          parent_id: parent,
          default_useful_life_months: depDefaults.default_useful_life_months,
          default_reducing_balance_rate_percent: depDefaults.default_reducing_balance_rate_percent,
        })
        .eq("id", catEditingId)
        .eq("organization_id", orgId);
      if (error && isMissingFaCategoryDepColumnError(error)) {
        usedDepFallback = true;
        ({ error } = await supabase
          .from("fixed_asset_categories")
          .update({ name: catName.trim(), parent_id: parent })
          .eq("id", catEditingId)
          .eq("organization_id", orgId));
      }
      if (error) {
        setErr(error.message);
        return;
      }
      cancelCategoryEdit();
      loadAll();
      if (wantsDep && usedDepFallback) {
        setErr(
          "Category saved. Depreciation defaults were not stored — run the SQL in supabase/manual/apply_fixed_asset_category_depreciation_defaults.sql (or `supabase db push`) so the database has the new columns."
        );
      }
      return;
    }

    let usedInsertFallback = false;
    let { error: insErr } = await supabase.from("fixed_asset_categories").insert({
      organization_id: orgId,
      name: catName.trim(),
      parent_id: catParentId || null,
      sort_order: 0,
      default_useful_life_months: depDefaults.default_useful_life_months,
      default_reducing_balance_rate_percent: depDefaults.default_reducing_balance_rate_percent,
    });
    if (insErr && isMissingFaCategoryDepColumnError(insErr)) {
      usedInsertFallback = true;
      ({ error: insErr } = await supabase.from("fixed_asset_categories").insert({
        organization_id: orgId,
        name: catName.trim(),
        parent_id: catParentId || null,
        sort_order: 0,
      }));
    }
    if (insErr) {
      setErr(insErr.message);
      return;
    }
    setCatName("");
    setCatParentId("");
    setCatDefaultUsefulLife("");
    setCatDefaultRbRate("");
    loadAll();
    if (wantsDep && usedInsertFallback) {
      setErr(
        "Category created. Depreciation defaults were not stored — run the SQL in supabase/manual/apply_fixed_asset_category_depreciation_defaults.sql (or `supabase db push`) so the database has the new columns."
      );
    }
  };

  const addCommonCategories = async () => {
    if (!orgId || readOnly) return;
    setErr(null);
    for (const name of COMMON_FA_CATEGORY_NAMES) {
      const { error } = await supabase.from("fixed_asset_categories").insert({
        organization_id: orgId,
        name,
        parent_id: null,
        sort_order: 0,
      });
      if (error && error.code !== "23505") {
        setErr(error.message);
        loadAll();
        return;
      }
    }
    loadAll();
  };

  const submitLifecycleAction = async () => {
    if (!actionModal || !orgId || !uid || readOnly) return;
    const a = actionModal.asset;
    if (actionModal.type === "transfer") {
      await supabase
        .from("fixed_assets")
        .update({
          branch_name: actionBranch.trim() || null,
          department_id: actionDept ? actionDept : null,
          room_or_location: actionRoom.trim() || null,
        })
        .eq("id", a.id);
      await supabase.from("fixed_asset_events").insert({
        organization_id: orgId,
        asset_id: a.id,
        event_type: "transfer",
        event_date: new Date().toISOString().slice(0, 10),
        notes: "Location / custodian update",
        payload: { branch: actionBranch, department_id: actionDept, room: actionRoom },
        created_by: uid,
      });
      setActionModal(null);
      loadAll();
      return;
    }

    const amt = Number(actionAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Enter a positive amount.");
      return;
    }

    if (actionModal.type === "revalue") {
      const ev = await supabase
        .from("fixed_asset_events")
        .insert({
          organization_id: orgId,
          asset_id: a.id,
          event_type: "revaluation",
          event_date: new Date().toISOString().slice(0, 10),
          notes: "Revaluation increase",
          payload: { increase: amt },
          created_by: uid,
        })
        .select("id")
        .single();
      const eid = ev.data?.id as string | undefined;
      if (!eid || ev.error) {
        setErr(ev.error?.message || "Event failed");
        return;
      }
      const jr = await createJournalForFixedAssetRevaluation(eid, amt, new Date().toISOString().slice(0, 10), uid);
      if (!jr.ok) {
        setErr(jr.error);
        return;
      }
      await supabase
        .from("fixed_assets")
        .update({ revaluation_adjustment: roundMoney(a.revaluation_adjustment + amt) })
        .eq("id", a.id);
      await supabase.from("fixed_asset_events").update({ journal_entry_id: jr.journalId }).eq("id", eid);
    } else if (actionModal.type === "impair") {
      const ev = await supabase
        .from("fixed_asset_events")
        .insert({
          organization_id: orgId,
          asset_id: a.id,
          event_type: "impairment",
          event_date: new Date().toISOString().slice(0, 10),
          notes: "Impairment",
          payload: { loss: amt },
          created_by: uid,
        })
        .select("id")
        .single();
      const eid = ev.data?.id as string | undefined;
      if (!eid || ev.error) {
        setErr(ev.error?.message || "Event failed");
        return;
      }
      const jr = await createJournalForFixedAssetImpairment(eid, amt, new Date().toISOString().slice(0, 10), uid);
      if (!jr.ok) {
        setErr(jr.error);
        return;
      }
      await supabase
        .from("fixed_assets")
        .update({ impairment_loss_accumulated: roundMoney(a.impairment_loss_accumulated + amt) })
        .eq("id", a.id);
      await supabase.from("fixed_asset_events").update({ journal_entry_id: jr.journalId }).eq("id", eid);
    } else if (actionModal.type === "dispose") {
      const proceeds = Number(actionProceeds);
      if (!Number.isFinite(proceeds) || proceeds < 0) {
        setErr("Enter proceeds (0 or more).");
        return;
      }
      const ev = await supabase
        .from("fixed_asset_events")
        .insert({
          organization_id: orgId,
          asset_id: a.id,
          event_type: "disposal",
          event_date: new Date().toISOString().slice(0, 10),
          notes: "Disposal",
          payload: { proceeds },
          created_by: uid,
        })
        .select("id")
        .single();
      const eid = ev.data?.id as string | undefined;
      if (!eid || ev.error) {
        setErr(ev.error?.message || "Event failed");
        return;
      }
      const jr = await createJournalForFixedAssetDisposal(eid, {
        originalCost: a.cost,
        accumulatedDepreciation: a.accumulated_depreciation,
        proceeds,
        entryDate: new Date().toISOString().slice(0, 10),
        createdBy: uid,
        revaluationReserveRelease:
          a.revaluation_adjustment && a.revaluation_adjustment > 0 ? a.revaluation_adjustment : undefined,
        lineDimensions: {
          branch: a.branch_name,
          department_id: a.department_id,
        },
      });
      if (!jr.ok) {
        setErr(jr.error);
        return;
      }
      await supabase
        .from("fixed_assets")
        .update({
          status: "disposed",
          disposed_at: new Date().toISOString().slice(0, 10),
          disposal_journal_entry_id: jr.journalId,
        })
        .eq("id", a.id);
      await supabase.from("fixed_asset_events").update({ journal_entry_id: jr.journalId }).eq("id", eid);
    }
    clearJournalAccountCache();
    setActionModal(null);
    setActionAmount("");
    setActionProceeds("");
    loadAll();
  };

  if (!orgId) {
    return <div className="p-6 text-slate-600">No organization context.</div>;
  }

  if (loading) {
    return <div className="p-8 text-slate-600">Loading fixed assets…</div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Fixed assets</h1>
          <PageNotes ariaLabel="Fixed assets help">
            <p>
              Register, classify, depreciate, and post journals to the GL (IFRS-style mapping via Admin → Journal account settings).
            </p>
          </PageNotes>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-2">
          Subscription is read-only — viewing only.
        </div>
      )}

      {faAlerts.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-violet-950">Depreciation alerts (from schedule / server check)</p>
          <ul className="text-sm text-violet-900 space-y-2">
            {faAlerts.map((al) => (
              <li key={al.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Period <span className="font-mono">{al.period_start}</span> →{" "}
                  <span className="font-mono">{al.period_end}</span> ({al.frequency})
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-violet-800 text-white"
                    onClick={() => {
                      setTab("depreciation");
                      setDepPeriodStart(al.period_start);
                      setDepPeriodEnd(al.period_end);
                      setDepFreq(al.frequency as DepreciationFrequency);
                    }}
                  >
                    Open depreciation
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-violet-400 text-violet-900"
                    onClick={async () => {
                      await supabase
                        .from("fixed_asset_depreciation_alerts")
                        .update({ dismissed_at: new Date().toISOString() })
                        .eq("id", al.id);
                      setFaAlerts((prev) => prev.filter((x) => x.id !== al.id));
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-violet-800">
            Alerts refresh when you load this page. With pg_cron enabled, the database can run{" "}
            <code className="font-mono">refresh_fixed_asset_depreciation_alerts</code> daily.
          </p>
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-2">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "register" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              disabled={readOnly}
              onClick={openAdd}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50"
            >
              Add asset
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3 font-semibold">Code</th>
                  <th className="text-left p-3 font-semibold">Name</th>
                  <th className="text-left p-3 font-semibold">Category</th>
                  <th className="text-right p-3 font-semibold">Cost</th>
                  <th className="text-right p-3 font-semibold">NBV</th>
                  <th className="text-left p-3 font-semibold">Impairment review</th>
                  <th className="text-left p-3 font-semibold">Status</th>
                  <th className="p-3 w-56"></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const nbv = netBookValue(a);
                  const cat = a.category_id ? categoryById.get(a.category_id) : null;
                  return (
                    <tr key={a.id} className="border-b border-slate-100">
                      <td className="p-3 font-mono text-xs">{a.asset_code}</td>
                      <td className="p-3">
                        <div>{a.name}</div>
                        {a.barcode && (
                          <div className="text-[11px] text-slate-500">Barcode: {a.barcode}</div>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">{cat?.name ?? "—"}</td>
                      <td className="p-3 text-right">{a.cost.toFixed(2)}</td>
                      <td className="p-3 text-right font-medium">{nbv.toFixed(2)}</td>
                      <td className="p-3 text-xs">
                        {!a.impairment_review_due_date ? (
                          "—"
                        ) : a.impairment_review_due_date < todayIso ? (
                          <span className="text-red-700 font-medium">Overdue ({a.impairment_review_due_date})</span>
                        ) : a.impairment_review_due_date <= impairmentSoonLimit ? (
                          <span className="text-amber-800">{a.impairment_review_due_date} (soon)</span>
                        ) : (
                          a.impairment_review_due_date
                        )}
                      </td>
                      <td className="p-3 capitalize">{a.status}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                            onClick={() => openEdit(a)}
                            disabled={readOnly}
                          >
                            Edit
                          </button>
                          {a.status === "draft" && (
                            <button
                              type="button"
                              className="text-xs px-2 py-1 rounded bg-emerald-700 text-white disabled:opacity-50"
                              onClick={() => capitalize(a)}
                              disabled={readOnly}
                            >
                              Capitalize
                            </button>
                          )}
                          {a.status === "capitalized" && (
                            <>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded border border-slate-200"
                                onClick={() => {
                                  setActionModal({ type: "transfer", asset: a });
                                  setActionBranch(a.branch_name || "");
                                  setActionDept(a.department_id || "");
                                  setActionRoom(a.room_or_location || "");
                                }}
                                disabled={readOnly}
                              >
                                Transfer
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded border border-slate-200"
                                onClick={() => {
                                  setActionModal({ type: "revalue", asset: a });
                                  setActionAmount("");
                                }}
                                disabled={readOnly}
                              >
                                Revalue
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded border border-slate-200"
                                onClick={() => {
                                  setActionModal({ type: "impair", asset: a });
                                  setActionAmount("");
                                }}
                                disabled={readOnly}
                              >
                                Impair
                              </button>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-red-700 text-white"
                                onClick={() => {
                                  setActionModal({ type: "dispose", asset: a });
                                  setActionProceeds("");
                                }}
                                disabled={readOnly}
                              >
                                Dispose
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {assets.length === 0 && <p className="p-6 text-slate-500 text-sm">No assets yet.</p>}
          </div>
        </div>
      )}

      {tab === "categories" && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">
                {catEditingId ? "Edit category" : "Add category / sub-category"}
              </h3>
              {catEditingId ? (
                <button
                  type="button"
                  onClick={cancelCategoryEdit}
                  className="text-xs text-slate-600 hover:text-slate-900 underline"
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <label className="block text-xs font-medium text-slate-600">Parent (optional)</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={catParentId}
              onChange={(e) => setCatParentId(e.target.value)}
            >
              <option value="">— Top level —</option>
              {categoryParentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? `↳ ${c.name}` : c.name}
                </option>
              ))}
            </select>
            {catEditingId ? (
              <p className="text-xs text-slate-500">
                Parent can be any category except this one or its sub-categories. Choose top level to make it a root
                category.
              </p>
            ) : (
              <p className="text-xs text-slate-500">Sub-categories: choose a top-level parent above.</p>
            )}
            <label className="block text-xs font-medium text-slate-600">Name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="e.g. Kitchen equipment"
            />
            <div className="grid sm:grid-cols-2 gap-3 pt-1">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Default useful life (months)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                  value={catDefaultUsefulLife}
                  onChange={(e) => setCatDefaultUsefulLife(e.target.value)}
                  placeholder="e.g. 60 for straight-line"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Default RB rate (% p.a.)</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                  value={catDefaultRbRate}
                  onChange={(e) => setCatDefaultRbRate(e.target.value)}
                  placeholder="e.g. 25 for reducing balance"
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Optional. When you assign an asset to this category, the asset form fills{" "}
              <strong>useful life</strong> and/or <strong>reducing-balance rate</strong> from these values (you can
              still change them on the asset).
            </p>
            <button
              type="button"
              disabled={readOnly}
              onClick={saveCategory}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {catEditingId ? "Save changes" : "Save category"}
            </button>
            <p className="text-xs text-slate-500 pt-1">Or add a starter set (skips names you already have):</p>
            <button
              type="button"
              disabled={readOnly}
              onClick={addCommonCategories}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Add Land, Buildings, Plant &amp; machinery…
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-900 mb-3">All categories</h3>
            <ul className="text-sm space-y-1.5">
              {categoriesSortedFlat.map((c) => {
                const depth = categoryDepth(c);
                const editing = catEditingId === c.id;
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-2 flex-wrap border-b border-slate-100 pb-1.5 last:border-0 rounded-md -mx-1 px-1 ${
                      editing ? "bg-brand-50 border-brand-200/80" : ""
                    }`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className={depth === 0 ? "font-medium text-slate-900" : "text-slate-700"}>
                        {depth > 0 ? "↳ " : ""}
                        {c.name}
                      </span>
                      {(() => {
                        const parts: string[] = [];
                        if (c.default_useful_life_months != null && c.default_useful_life_months > 0) {
                          parts.push(`Life ${c.default_useful_life_months} mo`);
                        }
                        if (c.default_reducing_balance_rate_percent != null && c.default_reducing_balance_rate_percent > 0) {
                          parts.push(`RB ${c.default_reducing_balance_rate_percent}%`);
                        }
                        return parts.length > 0 ? (
                          <span className="block text-[11px] text-slate-500 mt-0.5">{parts.join(" · ")}</span>
                        ) : null;
                      })()}
                    </div>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => startEditCategory(c)}
                      className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-900 disabled:opacity-50"
                      title="Edit category"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
            {categories.length === 0 && <p className="text-slate-500 text-sm">No categories.</p>}
          </div>
        </div>
      )}

      {tab === "depreciation" && (
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Automatic schedule (reminders)</h3>
              <p className="text-xs text-slate-600 mt-0.5">
                When enabled, the Depreciation tab highlights the next period after your last posted run. Posting still
                requires Preview — nothing is auto-posted without your confirmation.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={scheduleAutoEnabled}
                onChange={(e) => setScheduleAutoEnabled(e.target.checked)}
                disabled={readOnly}
              />
              Enable period reminders
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Reminder frequency</label>
                <select
                  className="block border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                  value={scheduleFreq}
                  onChange={(e) => setScheduleFreq(e.target.value as AutoDepreciationFrequency)}
                  disabled={readOnly}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <button
                type="button"
                disabled={readOnly || scheduleSaving}
                onClick={saveScheduleSettings}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {scheduleSaving ? "Saving…" : "Save schedule"}
              </button>
            </div>
            {orgSchedule?.auto_depreciation_last_period_end && (
              <p className="text-xs text-slate-500">
                Last posted period end: <span className="font-mono">{orgSchedule.auto_depreciation_last_period_end}</span>
              </p>
            )}
          </div>

          {depreciationReminder && (
            <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-sky-950">
                <span className="font-semibold">Scheduled depreciation due: </span>
                <span className="font-mono">
                  {depreciationReminder.periodStart} → {depreciationReminder.periodEnd}
                </span>
                <span className="text-sky-800"> — no posted run for this period yet.</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 bg-sky-800 text-white rounded-lg text-sm"
                  onClick={applyReminderPeriod}
                >
                  Apply dates
                </button>
                <button type="button" className="px-3 py-1.5 border border-sky-700 text-sky-900 rounded-lg text-sm" onClick={runPreview}>
                  Preview
                </button>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600">Period start</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                value={depPeriodStart}
                onChange={(e) => setDepPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Period end</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                value={depPeriodEnd}
                onChange={(e) => setDepPeriodEnd(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Schedule frequency</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-1"
                value={depFreq}
                onChange={(e) => setDepFreq(e.target.value as DepreciationFrequency)}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={runPreview}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm"
              >
                Preview
              </button>
              <button
                type="button"
                disabled={readOnly || depPosting || previewTotal <= 0}
                onClick={postDepreciation}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {depPosting ? "Posting…" : "Post to GL"}
              </button>
            </div>
          </div>

          {assets.some((a) => a.status === "capitalized" && a.depreciation_method === "units_of_production") && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-amber-900 mb-2">Units of production — enter units this period, then Preview</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {assets
                  .filter((a) => a.status === "capitalized" && a.depreciation_method === "units_of_production")
                  .map((a) => (
                    <label key={a.id} className="flex flex-col text-xs">
                      <span className="text-slate-600">
                        {a.asset_code} — {a.name}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className="border border-slate-300 rounded px-2 py-1 mt-1"
                        value={unitsByAsset[a.id] ?? ""}
                        onChange={(e) => setUnitsByAsset((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      />
                    </label>
                  ))}
              </div>
            </div>
          )}

          {previewLines.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-3">Asset</th>
                    <th className="text-right p-3">Amount</th>
                    <th className="text-left p-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLines.map((ln) => (
                    <tr key={ln.asset_id} className="border-b border-slate-100">
                      <td className="p-3">
                        {ln.code} — {ln.name}
                      </td>
                      <td className="p-3 text-right">{ln.amount.toFixed(2)}</td>
                      <td className="p-3 text-slate-600 text-xs">{ln.note}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="p-3">Total</td>
                    <td className="p-3 text-right">{previewTotal.toFixed(2)}</td>
                    <td className="p-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "lifecycle" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Asset</th>
                <th className="text-left p-3">Event</th>
                <th className="text-left p-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="p-3 whitespace-nowrap">{e.event_date}</td>
                  <td className="p-3">{e.asset_name ?? e.asset_id.slice(0, 8)}</td>
                  <td className="p-3 capitalize">{e.event_type}</td>
                  <td className="p-3 text-slate-600">{e.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <p className="p-6 text-slate-500 text-sm">No events yet.</p>}
        </div>
      )}

      {assetModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-xl my-8 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-4">{editingId ? "Edit asset" : "New asset"}</h2>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Asset code / tag *</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.asset_code || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, asset_code: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Name *</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.name || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Barcode</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.barcode || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, barcode: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">QR payload (URL or code)</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.qr_code_payload || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, qr_code_payload: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Category</span>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.category_id || ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const cat = id ? categoryById.get(id) : undefined;
                    setDraft((d) => {
                      const next: Partial<FaAsset> = { ...d, category_id: id };
                      if (cat) {
                        if (cat.default_useful_life_months != null && cat.default_useful_life_months > 0) {
                          next.useful_life_months = cat.default_useful_life_months;
                        }
                        if (
                          cat.default_reducing_balance_rate_percent != null &&
                          cat.default_reducing_balance_rate_percent > 0
                        ) {
                          next.reducing_balance_rate_percent = cat.default_reducing_balance_rate_percent;
                        }
                      }
                      return next;
                    });
                  }}
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent_id ? `↳ ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">
                  If the category has default useful life or RB rate, those fields update when you pick the category.
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Branch</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.branch_name || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, branch_name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Department</span>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.department_id || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, department_id: e.target.value || null }))}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Room / location</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.room_or_location || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, room_or_location: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Custodian (staff)</span>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.custodian_staff_id || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, custodian_staff_id: e.target.value || null }))}
                >
                  <option value="">—</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Supplier</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.supplier_name || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, supplier_name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Invoice ref</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.invoice_reference || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, invoice_reference: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Purchase date</span>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.purchase_date || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, purchase_date: e.target.value || null }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Cost</span>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.cost ?? 0}
                  onChange={(e) => setDraft((d) => ({ ...d, cost: Number(e.target.value) }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Funding source</span>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.funding_source || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, funding_source: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">In-service date</span>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.in_service_date || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, in_service_date: e.target.value || null }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Residual value</span>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.residual_value ?? 0}
                  onChange={(e) => setDraft((d) => ({ ...d, residual_value: Number(e.target.value) }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Next impairment review (optional)</span>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.impairment_review_due_date || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, impairment_review_due_date: e.target.value || null }))}
                />
                <span className="text-[11px] text-slate-500">Workflow reminder only — does not post journals.</span>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Method</span>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.depreciation_method || "straight_line"}
                  onChange={(e) => setDraft((d) => ({ ...d, depreciation_method: e.target.value as DepreciationMethod }))}
                >
                  <option value="straight_line">Straight-line</option>
                  <option value="reducing_balance">Reducing balance</option>
                  <option value="units_of_production">Units of production</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Useful life (months)</span>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.useful_life_months ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      useful_life_months: e.target.value ? parseInt(e.target.value, 10) : null,
                    }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">RB annual %</span>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.reducing_balance_rate_percent ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      reducing_balance_rate_percent: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Total units (UoP)</span>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={draft.units_total ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      units_total: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Description</span>
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  rows={2}
                  value={draft.description || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" className="px-4 py-2 text-slate-700" onClick={() => setAssetModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={readOnly}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg disabled:opacity-50"
                onClick={saveAsset}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal && actionModal.type !== "transfer" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-semibold text-slate-900 mb-2 capitalize">{actionModal.type}</h3>
            <p className="text-sm text-slate-600 mb-4">{actionModal.asset.name}</p>
            {actionModal.type === "dispose" ? (
              <label className="block text-sm">
                Proceeds (cash)
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={actionProceeds}
                  onChange={(e) => setActionProceeds(e.target.value)}
                />
              </label>
            ) : (
              <label className="block text-sm">
                Amount
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1"
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value)}
                />
              </label>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" className="px-4 py-2 text-slate-700" onClick={() => setActionModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-slate-900 text-white rounded-lg"
                onClick={submitLifecycleAction}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal && actionModal.type === "transfer" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-3">
            <h3 className="font-semibold text-slate-900">Transfer asset</h3>
            <p className="text-sm text-slate-600">{actionModal.asset.name}</p>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Branch"
              value={actionBranch}
              onChange={(e) => setActionBranch(e.target.value)}
            />
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={actionDept}
              onChange={(e) => setActionDept(e.target.value)}
            >
              <option value="">Department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Room / location"
              value={actionRoom}
              onChange={(e) => setActionRoom(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-4 py-2 text-slate-700" onClick={() => setActionModal(null)}>
                Cancel
              </button>
              <button type="button" className="px-4 py-2 bg-slate-900 text-white rounded-lg" onClick={submitLifecycleAction}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
