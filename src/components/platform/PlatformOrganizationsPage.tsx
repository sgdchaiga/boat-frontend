import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Copy, Search, X } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";

type Org = {
  id: string;
  name: string;
  slug: string | null;
  business_type: string;
  created_at: string;
  enable_fixed_assets?: boolean | null;
  school_enable_reports?: boolean | null;
  school_enable_fixed_deposit?: boolean | null;
  school_enable_accounting?: boolean | null;
  school_enable_inventory?: boolean | null;
  school_enable_purchases?: boolean | null;
  enable_communications?: boolean | null;
  enable_wallet?: boolean | null;
  enable_payroll?: boolean | null;
  enable_budget?: boolean | null;
  enable_agent?: boolean | null;
  enable_hotel_assessment?: boolean | null;
  enable_manufacturing?: boolean | null;
  clearing_enabled?: boolean | null;
  clearing_status?: "inactive" | "active" | "suspended" | "pending" | string | null;
  clearing_org_sacco_id?: string | null;
  clearing_default_payer_sacco_id?: string | null;
  clearing_merchant_sacco_id?: string | null;
  clearing_synced_at?: string | null;
  enable_reports?: boolean | null;
  enable_accounting?: boolean | null;
  enable_inventory?: boolean | null;
  enable_purchases?: boolean | null;
  purchases_require_po_approval?: boolean | null;
  purchases_require_bill_approval?: boolean | null;
  /** Platform: hotel automated room charges (check-in + night audit). */
  hotel_enable_smart_room_charges?: boolean | null;
  desktop_device_limit?: number | null;
};

type Plan = { id: string; code: string; name: string; business_type_code?: string | null };
type SubRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  status: string;
  period_start: string;
  period_end: string | null;
  subscription_plans: Plan | null;
};

function plansMatchingBusinessType(plansList: Plan[], businessTypeCode: string): Plan[] {
  const bt = businessTypeCode || "hotel";
  return plansList.filter((p) => (p.business_type_code || "hotel") === bt);
}

type BusinessTypeRow = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean | null;
  sort_order?: number | null;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/** Shareable filter for the platform orgs table (`?page=platform_organizations&org_q=…`). */
const ORG_SEARCH_URL_KEY = "org_q";

function readOrgSearchFromUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get(ORG_SEARCH_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

function syncOrgSearchToUrl(value: string) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const v = value.trim();
    if (v) url.searchParams.set(ORG_SEARCH_URL_KEY, v);
    else url.searchParams.delete(ORG_SEARCH_URL_KEY);
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* ignore */
  }
}

async function getEdgeInvokeErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof Error)) return null;
  const maybeWithContext = error as Error & {
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  const context = maybeWithContext.context;
  if (!context) return error.message || null;
  try {
    if (typeof context.json === "function") {
      const payload = (await context.json()) as { message?: string; error?: string } | null;
      if (payload?.message) return payload.message;
      if (payload?.error) return payload.error;
    }
  } catch {
    // fall through to text parsing
  }
  try {
    if (typeof context.text === "function") {
      const raw = await context.text();
      if (!raw) return error.message || null;
      try {
        const payload = JSON.parse(raw) as { message?: string; error?: string };
        return payload.message || payload.error || error.message || null;
      } catch {
        return raw.slice(0, 300);
      }
    }
  } catch {
    // fall back to base error below
  }
  return error.message || null;
}

export function PlatformOrganizationsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({});
  const [latestSub, setLatestSub] = useState<Record<string, SubRow>>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "sub" | "copy" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newBiz, setNewBiz] = useState("hotel");
  const [newPlanId, setNewPlanId] = useState("");
  const [createFirstAdmin, setCreateFirstAdmin] = useState(true);
  const [firstAdminName, setFirstAdminName] = useState("");
  const [firstAdminEmail, setFirstAdminEmail] = useState("");
  const [firstAdminPhone, setFirstAdminPhone] = useState("");
  const [firstAdminPassword, setFirstAdminPassword] = useState("");
  const [firstAdminConfirmPassword, setFirstAdminConfirmPassword] = useState("");

  const [editOrg, setEditOrg] = useState<Org | null>(null);
  const [editBiz, setEditBiz] = useState("hotel");
  const [subStatus, setSubStatus] = useState("active");
  const [subPlanId, setSubPlanId] = useState("");
  const [subStart, setSubStart] = useState("");
  const [subEnd, setSubEnd] = useState("");
  const [editOrgName, setEditOrgName] = useState("");
  const [editOrgSlug, setEditOrgSlug] = useState("");
  const [copySourceOrg, setCopySourceOrg] = useState<Org | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copySlug, setCopySlug] = useState("");
  const [editEnableFixedAssets, setEditEnableFixedAssets] = useState(false);
  const [editSchoolReports, setEditSchoolReports] = useState(false);
  const [editSchoolFixedDeposit, setEditSchoolFixedDeposit] = useState(false);
  const [editSchoolAccounting, setEditSchoolAccounting] = useState(false);
  const [editSchoolInventory, setEditSchoolInventory] = useState(false);
  const [editSchoolPurchases, setEditSchoolPurchases] = useState(false);
  const [editEnableCommunications, setEditEnableCommunications] = useState(true);
  const [editEnableWallet, setEditEnableWallet] = useState(true);
  const [editEnablePayroll, setEditEnablePayroll] = useState(true);
  const [editEnableBudget, setEditEnableBudget] = useState(true);
  const [editEnableAgent, setEditEnableAgent] = useState(true);
  const [editEnableReports, setEditEnableReports] = useState(true);
  const [editEnableAccounting, setEditEnableAccounting] = useState(true);
  const [editEnableInventory, setEditEnableInventory] = useState(true);
  const [editEnablePurchases, setEditEnablePurchases] = useState(true);
  const [editPurchasesRequirePoApproval, setEditPurchasesRequirePoApproval] = useState(true);
  const [editPurchasesRequireBillApproval, setEditPurchasesRequireBillApproval] = useState(true);
  const [editHotelSmartRoomCharges, setEditHotelSmartRoomCharges] = useState(true);
  const [editEnableHotelAssessment, setEditEnableHotelAssessment] = useState(true);
  const [editEnableManufacturing, setEditEnableManufacturing] = useState(true);
  const [editDesktopDeviceLimit, setEditDesktopDeviceLimit] = useState(1);
  const [orgSearch, setOrgSearch] = useState(readOrgSearchFromUrl);
  const [clearingBusyByOrgId, setClearingBusyByOrgId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    syncOrgSearchToUrl(orgSearch);
  }, [orgSearch]);

  const filteredOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return orgs;
    const businessTypeLabels = Object.fromEntries(
      businessTypes.map((b) => [b.code, (b.name || b.code).toLowerCase()])
    );
    return orgs.filter((org) => {
      const sub = latestSub[org.id];
      const planName = sub?.subscription_plans?.name?.toLowerCase() ?? "";
      const planCode = sub?.subscription_plans?.code?.toLowerCase() ?? "";
      const status = (sub?.status ?? "").toLowerCase();
      const period = (sub?.period_end ?? "").toLowerCase();
      const btDisplay = businessTypeLabels[org.business_type] ?? org.business_type.toLowerCase();
      return (
        org.name.toLowerCase().includes(q) ||
        (org.slug ?? "").toLowerCase().includes(q) ||
        org.business_type.toLowerCase().includes(q) ||
        btDisplay.includes(q) ||
        org.id.toLowerCase().includes(q) ||
        planName.includes(q) ||
        planCode.includes(q) ||
        status.includes(q) ||
        period.includes(q)
      );
    });
  }, [orgs, latestSub, orgSearch, businessTypes]);

  const toggleOrgModule = async (
    orgId: string,
    key:
      | "enable_payroll"
      | "enable_budget"
      | "enable_agent"
      | "enable_hotel_assessment"
      | "enable_manufacturing",
    nextValue: boolean
  ) => {
    setErr(null);
    const { error } = await supabase.from("organizations").update({ [key]: nextValue }).eq("id", orgId);
    if (error) {
      setErr(error.message);
      return;
    }
    setOrgs((prev) =>
      prev.map((o) =>
        o.id === orgId
          ? {
              ...o,
              [key]: nextValue,
            }
          : o
      )
    );
  };

  const toggleClearingActivation = async (org: Org, enabled: boolean) => {
    if (!(org.business_type === "sacco" || org.business_type === "vsla")) {
      setErr("Clearing activation is only supported for SACCO and VSLA organizations.");
      return;
    }

    setErr(null);
    setClearingBusyByOrgId((prev) => ({ ...prev, [org.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("clearing-admin-org-activation", {
        body: {
          organization_id: org.id,
          enabled,
        },
      });
      if (error) {
        throw new Error(error.message || "Failed to invoke clearing admin function.");
      }
      const parsed = data as { ok?: boolean; error?: string; message?: string; data?: Partial<Org> } | null;
      if (!parsed?.ok) {
        throw new Error(parsed?.message || parsed?.error || "Failed to update clearing activation.");
      }
      const row = parsed.data;
      if (row) {
        setOrgs((prev) =>
          prev.map((o) =>
            o.id === org.id
              ? {
                  ...o,
                  clearing_enabled: row.clearing_enabled ?? o.clearing_enabled,
                  clearing_status: row.clearing_status ?? o.clearing_status,
                  clearing_org_sacco_id: row.clearing_org_sacco_id ?? o.clearing_org_sacco_id,
                  clearing_default_payer_sacco_id:
                    row.clearing_default_payer_sacco_id ?? o.clearing_default_payer_sacco_id,
                  clearing_merchant_sacco_id:
                    row.clearing_merchant_sacco_id ?? o.clearing_merchant_sacco_id,
                  clearing_synced_at: row.clearing_synced_at ?? o.clearing_synced_at,
                }
              : o
          )
        );
      } else {
        await load();
      }
    } catch (e) {
      const edgeMsg = await getEdgeInvokeErrorMessage(e);
      setErr(edgeMsg || "Failed to update clearing activation.");
    } finally {
      setClearingBusyByOrgId((prev) => ({ ...prev, [org.id]: false }));
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data: o } = await supabase.from("organizations").select("*").order("name");
    setOrgs((o as Org[]) || []);

    const { data: staffRows } = await supabase.from("staff").select("organization_id");
    const counts: Record<string, number> = {};
    (staffRows || []).forEach((r: { organization_id: string | null }) => {
      if (r.organization_id) counts[r.organization_id] = (counts[r.organization_id] || 0) + 1;
    });
    setStaffCounts(counts);

    const { data: subs } = await supabase
      .from("organization_subscriptions")
      .select("*, subscription_plans(id,code,name,business_type_code)")
      .order("created_at", { ascending: false });

    const byOrg: Record<string, SubRow> = {};
    (subs as SubRow[] | null)?.forEach((s) => {
      if (!byOrg[s.organization_id]) byOrg[s.organization_id] = s;
    });
    setLatestSub(byOrg);

    const [pRes, btRes] = await Promise.all([
      supabase.from("subscription_plans").select("id,code,name,business_type_code").order("sort_order"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("business_types").select("id,code,name,is_active,sort_order").eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    ]);
    const plansData = (pRes.data as Plan[]) || [];
    setPlans(plansData);
    let btRows: BusinessTypeRow[] = [];
    if (!btRes.error && btRes.data?.length) {
      btRows = btRes.data as BusinessTypeRow[];
      setBusinessTypes(btRows);
    } else {
      // Graceful fallback if table missing: use current org values only.
      const codes = Array.from(new Set(((o as Org[]) || []).map((x) => x.business_type).filter(Boolean)));
      btRows = codes.map((code) => ({ id: code, code, name: code }));
      setBusinessTypes(btRows);
    }
    const firstBt = btRows[0]?.code || "hotel";
    const plansForFirst = plansMatchingBusinessType(plansData, firstBt);
    if (plansForFirst[0]) setNewPlanId(plansForFirst[0].id);
    else if (plansData[0]) setNewPlanId(plansData[0].id);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** When creating an org, keep the selected plan in sync with business type. */
  useEffect(() => {
    if (modal !== "add") return;
    const match = plansMatchingBusinessType(plans, newBiz);
    if (!match.length) return;
    setNewPlanId((prev) => (match.some((p) => p.id === prev) ? prev : match[0].id));
  }, [newBiz, modal, plans]);

  /** When editing subscription, changing business type limits plans to that type. */
  useEffect(() => {
    if (modal !== "sub") return;
    const match = plansMatchingBusinessType(plans, editBiz);
    if (!match.length) return;
    setSubPlanId((prev) => (match.some((p) => p.id === prev) ? prev : match[0].id));
  }, [editBiz, modal, plans]);

  const openAdd = () => {
    setErr(null);
    setNewName("");
    setNewSlug("");
    const bt = businessTypes[0]?.code || "hotel";
    setNewBiz(bt);
    const match = plansMatchingBusinessType(plans, bt);
    setNewPlanId(match[0]?.id ?? plans[0]?.id ?? "");
    setCreateFirstAdmin(true);
    setFirstAdminName("");
    setFirstAdminEmail("");
    setFirstAdminPhone("");
    setFirstAdminPassword("");
    setFirstAdminConfirmPassword("");
    setModal("add");
  };

  const saveOrg = async () => {
    if (!newName.trim()) {
      setErr("Name is required");
      return;
    }
    if (createFirstAdmin && (!firstAdminName.trim() || !firstAdminEmail.trim())) {
      setErr("First admin name and email are required.");
      return;
    }
    if (createFirstAdmin && firstAdminPassword.length < 6) {
      setErr("First admin password must be at least 6 characters.");
      return;
    }
    if (createFirstAdmin && firstAdminPassword !== firstAdminConfirmPassword) {
      setErr("First admin passwords do not match.");
      return;
    }
    setSaving(true);
    setErr(null);
    const slug = newSlug.trim() || slugify(newName);
    const { data: inserted, error: e1 } = await supabase
      .from("organizations")
      .insert({
        name: newName.trim(),
        slug,
        business_type: newBiz,
      })
      .select("id")
      .single();
    if (e1) {
      setErr(e1.message);
      setSaving(false);
      return;
    }
    if (newPlanId && inserted?.id) {
      const { error: e2 } = await supabase.from("organization_subscriptions").insert({
        organization_id: inserted.id,
        plan_id: newPlanId,
        status: "trial",
        period_start: new Date().toISOString().slice(0, 10),
        period_end: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      });
      if (e2) setErr(e2.message);
    }
    if (inserted?.id && createFirstAdmin) {
      const signupClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );
      const { data: signUpData, error: signUpErr } = await signupClient.auth.signUp({
        email: firstAdminEmail.trim(),
        password: firstAdminPassword,
        options: {
          data: {
            full_name: firstAdminName.trim(),
            role: "admin",
            phone: firstAdminPhone.trim() || "",
          },
        },
      });
      if (signUpErr) {
        setErr(`Organization created, but failed to create first admin login: ${signUpErr.message}`);
        setSaving(false);
        setModal(null);
        load();
        return;
      }
      const authUserId = signUpData.user?.id;
      if (!authUserId) {
        setErr("Organization created, but failed to create first admin login.");
        setSaving(false);
        setModal(null);
        load();
        return;
      }
      const firstAdminPayload = {
        id: authUserId,
        full_name: firstAdminName.trim(),
        email: firstAdminEmail.trim(),
        phone: firstAdminPhone.trim() || null,
        role: "admin",
        is_active: true,
        organization_id: inserted.id,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: staffErr } = await (supabase as any).from("staff").insert(firstAdminPayload);
      if (staffErr) {
        setErr(`Organization created, but failed to create first admin: ${staffErr.message}`);
      }
    }
    setSaving(false);
    setModal(null);
    load();
  };

  const openSubEdit = (org: Org) => {
    const sub = latestSub[org.id];
    const biz = org.business_type || "hotel";
    const candidates = plansMatchingBusinessType(plans, biz);
    let planId = sub?.plan_id || "";
    if (planId && !candidates.some((p) => p.id === planId)) {
      planId = candidates[0]?.id || planId;
    } else if (!planId) {
      planId = candidates[0]?.id || "";
    }
    setEditOrg(org);
    setEditOrgName(org.name);
    setEditOrgSlug(org.slug ?? "");
    setEditBiz(biz);
    setSubStatus(sub?.status || "active");
    setSubPlanId(planId);
    setSubStart(sub?.period_start || new Date().toISOString().slice(0, 10));
    setSubEnd(sub?.period_end || "");
    setEditEnableFixedAssets(!!org.enable_fixed_assets);
    setEditSchoolReports(!!org.school_enable_reports);
    setEditSchoolFixedDeposit(!!org.school_enable_fixed_deposit);
    setEditSchoolAccounting(!!org.school_enable_accounting);
    setEditSchoolInventory(!!org.school_enable_inventory);
    setEditSchoolPurchases(!!org.school_enable_purchases);
    setEditEnableCommunications(org.enable_communications !== false);
    setEditEnableWallet(org.enable_wallet !== false);
    setEditEnablePayroll(org.enable_payroll !== false);
    setEditEnableBudget(org.enable_budget !== false);
    setEditEnableAgent(org.enable_agent !== false);
    setEditEnableReports(org.enable_reports !== false);
    setEditEnableAccounting(org.enable_accounting !== false);
    setEditEnableInventory(org.enable_inventory !== false);
    setEditEnablePurchases(org.enable_purchases !== false);
    setEditPurchasesRequirePoApproval(org.purchases_require_po_approval !== false);
    setEditPurchasesRequireBillApproval(org.purchases_require_bill_approval !== false);
    setEditHotelSmartRoomCharges(org.hotel_enable_smart_room_charges !== false);
    setEditEnableHotelAssessment(org.enable_hotel_assessment !== false);
    setEditEnableManufacturing(org.enable_manufacturing !== false);
    setEditDesktopDeviceLimit(Math.max(1, Number(org.desktop_device_limit ?? 1)));
    setErr(null);
    setModal("sub");
  };

  const saveSubscription = async () => {
    if (!editOrg) return;
    setSaving(true);
    setErr(null);
    if (!editOrgName.trim()) {
      setErr("Organization name is required.");
      setSaving(false);
      return;
    }
    const slugTrim = editOrgSlug.trim();
    const orgUpdate = await supabase
      .from("organizations")
      .update({
        name: editOrgName.trim(),
        ...(slugTrim ? { slug: slugify(slugTrim) } : { slug: null }),
        business_type: editBiz,
        enable_fixed_assets: editEnableFixedAssets,
        school_enable_reports: editSchoolReports,
        school_enable_fixed_deposit: editSchoolFixedDeposit,
        school_enable_accounting: editSchoolAccounting,
        school_enable_inventory: editSchoolInventory,
        school_enable_purchases: editSchoolPurchases,
        enable_communications: editEnableCommunications,
        enable_wallet: editEnableWallet,
        enable_payroll: editEnablePayroll,
        enable_budget: editEnableBudget,
        enable_agent: editEnableAgent,
        enable_hotel_assessment: editEnableHotelAssessment,
        enable_manufacturing: editEnableManufacturing,
        enable_reports: editEnableReports,
        enable_accounting: editEnableAccounting,
        enable_inventory: editEnableInventory,
        enable_purchases: editEnablePurchases,
        purchases_require_po_approval: editPurchasesRequirePoApproval,
        purchases_require_bill_approval: editPurchasesRequireBillApproval,
        hotel_enable_smart_room_charges: editHotelSmartRoomCharges,
        desktop_device_limit: Math.max(1, Math.floor(editDesktopDeviceLimit || 1)),
      })
      .eq("id", editOrg.id);
    if (orgUpdate.error) {
      setSaving(false);
      setErr(orgUpdate.error.message);
      return;
    }

    const sub = latestSub[editOrg.id];
    let error: { message: string } | null = null;
    if (sub) {
      if (!subPlanId) {
        setSaving(false);
        setModal(null);
        load();
        return;
      }
      const res = await supabase
        .from("organization_subscriptions")
        .update({
          plan_id: subPlanId,
          status: subStatus,
          period_start: subStart,
          period_end: subEnd || null,
        })
        .eq("id", sub.id);
      error = res.error;
    } else if (subPlanId) {
      const res = await supabase.from("organization_subscriptions").insert({
        organization_id: editOrg.id,
        plan_id: subPlanId,
        status: subStatus,
        period_start: subStart,
        period_end: subEnd || null,
      });
      error = res.error;
    }
    setSaving(false);
    if (error) setErr(error.message);
    else {
      setModal(null);
      load();
    }
  };

  const openCopyTemplate = (org: Org) => {
    setErr(null);
    setCopySourceOrg(org);
    setCopyName(`${org.name} (copy)`);
    setCopySlug(`${(org.slug || slugify(org.name)).slice(0, 60)}-copy`);
    setModal("copy");
  };

  const runCopyTemplate = async () => {
    if (!copySourceOrg) return;
    if (!copyName.trim() || !copySlug.trim()) {
      setErr("New organization name and slug are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase.rpc("copy_organization_template", {
      p_source_organization_id: copySourceOrg.id,
      p_new_name: copyName.trim(),
      p_new_slug: slugify(copySlug.trim()),
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setModal(null);
    setCopySourceOrg(null);
    load();
  };

  if (loading) {
    return <div className="p-8 text-slate-600">Loading organizations…</div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Organizations</h1>
          <PageNotes ariaLabel="Organizations help">
            <p>Tenants, staff count, and subscription status.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" />
          Add organization
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="relative flex flex-1 min-w-[min(100%,280px)] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden />
          <input
            type="search"
            value={orgSearch}
            onChange={(e) => setOrgSearch(e.target.value)}
            placeholder="Search name, slug, type, plan, status…"
            className="w-full border border-slate-300 rounded-lg pl-10 pr-10 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            autoComplete="off"
            aria-label="Search organizations"
          />
          {orgSearch.trim() ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              aria-label="Clear search"
              onClick={() => setOrgSearch("")}
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          ) : null}
        </label>
        {orgSearch.trim() ? (
          <>
            <span className="text-sm text-slate-600 tabular-nums">
              {filteredOrgs.length} of {orgs.length}
            </span>
            <button
              type="button"
              onClick={() => setOrgSearch("")}
              className="text-sm text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>

      {err ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3 font-semibold text-slate-700">Name</th>
                <th className="text-left p-3 font-semibold text-slate-700">Business type</th>
                <th className="text-left p-3 font-semibold text-slate-700">Staff</th>
                <th className="text-left p-3 font-semibold text-slate-700">Payroll</th>
                <th className="text-left p-3 font-semibold text-slate-700">Budget</th>
                <th className="text-left p-3 font-semibold text-slate-700">Agent Hub</th>
                <th className="text-left p-3 font-semibold text-slate-700">Assessment</th>
                <th className="text-left p-3 font-semibold text-slate-700">Manufacturing</th>
                <th className="text-left p-3 font-semibold text-slate-700">Clearing</th>
                <th className="text-left p-3 font-semibold text-slate-700">Plan</th>
                <th className="text-left p-3 font-semibold text-slate-700">Status</th>
                <th className="text-left p-3 font-semibold text-slate-700">Period end</th>
                <th className="p-3 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {filteredOrgs.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-600 text-sm">
                    {orgSearch.trim()
                      ? "No organizations match your search."
                      : "No organizations yet."}
                  </td>
                </tr>
              ) : null}
              {filteredOrgs.map((org) => {
                const sub = latestSub[org.id];
                return (
                  <tr key={org.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 font-medium text-slate-900">{org.name}</td>
                    <td className="p-3 text-slate-600 capitalize">{org.business_type}</td>
                    <td className="p-3 text-slate-600">{staffCounts[org.id] ?? 0}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            org.enable_payroll === false
                              ? "bg-red-100 text-red-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {org.enable_payroll === false ? "Off" : "On"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleOrgModule(org.id, "enable_payroll", !(org.enable_payroll !== false))}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          {org.enable_payroll === false ? "Turn On" : "Turn Off"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            org.enable_budget === false
                              ? "bg-red-100 text-red-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {org.enable_budget === false ? "Off" : "On"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleOrgModule(org.id, "enable_budget", !(org.enable_budget !== false))}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          {org.enable_budget === false ? "Turn On" : "Turn Off"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            org.enable_agent === false ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {org.enable_agent === false ? "Off" : "On"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleOrgModule(org.id, "enable_agent", !(org.enable_agent !== false))}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          {org.enable_agent === false ? "Turn On" : "Turn Off"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            org.enable_hotel_assessment === false
                              ? "bg-red-100 text-red-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {org.enable_hotel_assessment === false ? "Off" : "On"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            toggleOrgModule(
                              org.id,
                              "enable_hotel_assessment",
                              !(org.enable_hotel_assessment !== false)
                            )
                          }
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          {org.enable_hotel_assessment === false ? "Turn On" : "Turn Off"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            org.enable_manufacturing === false
                              ? "bg-red-100 text-red-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {org.enable_manufacturing === false ? "Off" : "On"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            toggleOrgModule(
                              org.id,
                              "enable_manufacturing",
                              !(org.enable_manufacturing !== false)
                            )
                          }
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          {org.enable_manufacturing === false ? "Turn On" : "Turn Off"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      {org.business_type === "sacco" || org.business_type === "vsla" ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              org.clearing_enabled && org.clearing_status === "active"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {org.clearing_enabled && org.clearing_status === "active" ? "Active" : "Inactive"}
                          </span>
                          <button
                            type="button"
                            disabled={!!clearingBusyByOrgId[org.id]}
                            onClick={() =>
                              void toggleClearingActivation(org, !(org.clearing_enabled && org.clearing_status === "active"))
                            }
                            className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {clearingBusyByOrgId[org.id]
                              ? "Saving…"
                              : org.clearing_enabled && org.clearing_status === "active"
                                ? "Deactivate"
                                : "Activate"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">
                      {sub?.subscription_plans?.name ?? "—"}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          sub?.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : sub?.status === "trial"
                              ? "bg-blue-100 text-blue-800"
                              : sub?.status === "past_due"
                                ? "bg-red-100 text-red-800"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {sub?.status ?? "none"}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {sub?.period_end ?? "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openSubEdit(org)}
                          className="p-2 text-slate-600 hover:bg-slate-200 rounded-lg"
                          title="Edit name, subscription, and flags"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openCopyTemplate(org)}
                          className="p-2 text-slate-600 hover:bg-slate-200 rounded-lg"
                          title="Duplicate settings and chart of accounts only (no transactions or staff)"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal === "add" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div
            role="dialog"
            aria-labelledby="org-add-title"
            className="bg-white rounded-xl max-w-md w-full max-h-[90vh] shadow-xl flex flex-col my-auto"
          >
            <div className="px-6 pt-6 pb-2 shrink-0 border-b border-slate-100">
              <h2 id="org-add-title" className="text-lg font-bold text-slate-900">
                New organization
              </h2>
            </div>
            <div className="px-6 py-4 overflow-y-auto overflow-x-hidden overscroll-contain max-h-[calc(90vh_-_10rem)] min-h-0">
            {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Slug (optional)</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="auto from name"
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={newBiz}
              onChange={(e) => setNewBiz(e.target.value)}
            >
              {businessTypes.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium text-slate-700 mb-1">Initial plan</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
              value={newPlanId}
              onChange={(e) => setNewPlanId(e.target.value)}
            >
              {plansMatchingBusinessType(plans, newBiz).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
            {plansMatchingBusinessType(plans, newBiz).length === 0 && (
              <p className="text-amber-700 text-xs mb-4">
                No subscription plans for this business type. Add plans under Subscription plans (superuser).
              </p>
            )}

            <div className="border border-slate-200 rounded-lg p-3 mb-4">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-3">
                <input
                  type="checkbox"
                  checked={createFirstAdmin}
                  onChange={(e) => setCreateFirstAdmin(e.target.checked)}
                />
                Create first admin for this organization
              </label>
              {createFirstAdmin && (
                <div className="space-y-3">
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    placeholder="First admin full name"
                    value={firstAdminName}
                    onChange={(e) => setFirstAdminName(e.target.value)}
                  />
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    placeholder="First admin email"
                    value={firstAdminEmail}
                    onChange={(e) => setFirstAdminEmail(e.target.value)}
                  />
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    placeholder="First admin phone (optional)"
                    value={firstAdminPhone}
                    onChange={(e) => setFirstAdminPhone(e.target.value)}
                  />
                  <input
                    type="password"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    placeholder="First admin password (min 6 chars)"
                    value={firstAdminPassword}
                    onChange={(e) => setFirstAdminPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <input
                    type="password"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    placeholder="Confirm first admin password"
                    value={firstAdminConfirmPassword}
                    onChange={(e) => setFirstAdminConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-slate-500">
                    This creates both the login account and the initial staff admin record linked to the new organization.
                  </p>
                </div>
              )}
            </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex gap-2 justify-end shrink-0 bg-slate-50/80">
              <button
                type="button"
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
                onClick={saveOrg}
              >
                {saving ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "sub" && editOrg && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div
            role="dialog"
            aria-labelledby="org-sub-title"
            className="bg-white rounded-xl max-w-md w-full max-h-[90vh] shadow-xl flex flex-col my-auto"
          >
            <div className="px-6 pt-6 pb-2 shrink-0 border-b border-slate-100">
              <h2 id="org-sub-title" className="text-lg font-bold text-slate-900">
                Subscription
              </h2>
              <p className="text-sm text-slate-500 mt-1">{editOrg.name}</p>
            </div>
            <div className="px-6 py-4 overflow-y-auto overflow-x-hidden overscroll-contain max-h-[calc(90vh_-_10rem)] min-h-0">
            {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
            <label className="block text-sm font-medium text-slate-700 mb-1">Organization name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editOrgName}
              onChange={(e) => setEditOrgName(e.target.value)}
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Slug (optional, unique)</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editOrgSlug}
              onChange={(e) => setEditOrgSlug(e.target.value)}
              placeholder="url-safe identifier"
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editBiz}
              onChange={(e) => setEditBiz(e.target.value)}
            >
              {businessTypes.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={subPlanId}
              onChange={(e) => setSubPlanId(e.target.value)}
            >
              {plansMatchingBusinessType(plans, editBiz).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium text-slate-700 mb-1">Desktop device seats</label>
            <input
              type="number"
              min={1}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editDesktopDeviceLimit}
              onChange={(e) => setEditDesktopDeviceLimit(Math.max(1, Number(e.target.value || 1)))}
            />
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={editEnableFixedAssets}
                onChange={(e) => setEditEnableFixedAssets(e.target.checked)}
              />
              Enable fixed assets module (standalone register, depreciation, GL)
            </label>
            {(editBiz === "hotel" || editBiz === "mixed") && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editHotelSmartRoomCharges}
                  onChange={(e) => setEditHotelSmartRoomCharges(e.target.checked)}
                />
                Hotel — automated room charges (first night at check-in + Run Daily Charges / scheduled night audit).
                When off, property staff post room revenue only via Billing → Add Charge.
              </label>
            )}
            {(editBiz === "hotel" || editBiz === "mixed") && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableHotelAssessment}
                  onChange={(e) => setEditEnableHotelAssessment(e.target.checked)}
                />
                Hotel / mixed — Assessment & onboarding (prospect tooling and reports)
              </label>
            )}
            <div className="border border-slate-200 rounded-lg p-3 mb-4 space-y-2 bg-slate-50/80">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Core Modules (all org types)</p>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnablePayroll}
                  onChange={(e) => setEditEnablePayroll(e.target.checked)}
                />
                Enable Payroll module
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableBudget}
                  onChange={(e) => setEditEnableBudget(e.target.checked)}
                />
                Enable Budget module
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableReports}
                  onChange={(e) => setEditEnableReports(e.target.checked)}
                />
                Enable Reports module
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableAccounting}
                  onChange={(e) => setEditEnableAccounting(e.target.checked)}
                />
                Enable Accounting module
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableInventory}
                  onChange={(e) => setEditEnableInventory(e.target.checked)}
                />
                Enable Inventory module
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnablePurchases}
                  onChange={(e) => setEditEnablePurchases(e.target.checked)}
                />
                Enable Purchases module
              </label>
              <div className="pl-6 space-y-2 border-l-2 border-slate-200 ml-1 py-1">
                <p className="text-xs font-medium text-slate-600">Purchase order → GRN/bill workflow</p>
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={editPurchasesRequirePoApproval}
                    onChange={(e) => setEditPurchasesRequirePoApproval(e.target.checked)}
                  />
                  <span>Require PO approval before convert to GRN/bill</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={editPurchasesRequireBillApproval}
                    onChange={(e) => setEditPurchasesRequireBillApproval(e.target.checked)}
                  />
                  <span>Require GRN/bill approval after convert from PO</span>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableManufacturing}
                  onChange={(e) => setEditEnableManufacturing(e.target.checked)}
                />
                Enable Manufacturing module (BOM, work orders, production, costing — hotel / restaurant / mixed / dedicated manufacturing orgs)
              </label>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 mb-4 space-y-2 bg-slate-50/80">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Other Modules (all org types)</p>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableCommunications}
                  onChange={(e) => setEditEnableCommunications(e.target.checked)}
                />
                Communications (SMS / WhatsApp hub)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableWallet}
                  onChange={(e) => setEditEnableWallet(e.target.checked)}
                />
                Wallet
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editEnableAgent}
                  onChange={(e) => setEditEnableAgent(e.target.checked)}
                />
                Agent Hub
              </label>
            </div>
            {editBiz === "school" && (
              <div className="border border-slate-200 rounded-lg p-3 mb-4 space-y-2 bg-slate-50/80">
                <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  School — BOAT modules
                </p>
                <p className="text-xs text-slate-500 mb-2">
                  Turn linked areas on or off for this school. Core billing and fee tables are always available.
                </p>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSchoolReports}
                    onChange={(e) => setEditSchoolReports(e.target.checked)}
                  />
                  Reports
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSchoolFixedDeposit}
                    onChange={(e) => setEditSchoolFixedDeposit(e.target.checked)}
                  />
                  Fixed deposits
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSchoolAccounting}
                    onChange={(e) => setEditSchoolAccounting(e.target.checked)}
                  />
                  Accounting
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSchoolInventory}
                    onChange={(e) => setEditSchoolInventory(e.target.checked)}
                  />
                  Inventory
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSchoolPurchases}
                    onChange={(e) => setEditSchoolPurchases(e.target.checked)}
                  />
                  Purchases
                </label>
              </div>
            )}
            {plansMatchingBusinessType(plans, editBiz).length === 0 && (
              <p className="text-amber-700 text-xs mb-3">
                No plans for this business type. Create plans under Subscription plans.
              </p>
            )}
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={subStatus}
              onChange={(e) => setSubStatus(e.target.value)}
            >
              <option value="trial">trial</option>
              <option value="active">active</option>
              <option value="past_due">past_due</option>
              <option value="cancelled">cancelled</option>
              <option value="expired">expired</option>
            </select>
            <label className="block text-sm font-medium text-slate-700 mb-1">Period start</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={subStart}
              onChange={(e) => setSubStart(e.target.value)}
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Period end</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
              value={subEnd}
              onChange={(e) => setSubEnd(e.target.value)}
            />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex gap-2 justify-end shrink-0 bg-slate-50/80">
              <button
                type="button"
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
                onClick={saveSubscription}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "copy" && copySourceOrg && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain">
          <div
            role="dialog"
            aria-labelledby="org-copy-title"
            className="bg-white rounded-xl max-w-md w-full max-h-[90vh] shadow-xl flex flex-col my-auto"
          >
            <div className="px-6 pt-6 pb-2 shrink-0 border-b border-slate-100">
              <h2 id="org-copy-title" className="text-lg font-bold text-slate-900">
                Duplicate organization template
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Creates a new tenant with the same feature flags, latest subscription row, chart of accounts, journal
                defaults, role types, and payroll org settings. Does not copy staff, customers, invoices, inventory, or
                other transactional data.
              </p>
              <p className="text-sm text-slate-600 mt-2 font-medium">From: {copySourceOrg.name}</p>
            </div>
            <div className="px-6 py-4 overflow-y-auto overflow-x-hidden overscroll-contain max-h-[calc(90vh_-_10rem)] min-h-0">
              {err && <p className="text-red-600 text-sm mb-3">{err}</p>}
              <label className="block text-sm font-medium text-slate-700 mb-1">New organization name</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
              />
              <label className="block text-sm font-medium text-slate-700 mb-1">New slug (unique)</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
                value={copySlug}
                onChange={(e) => setCopySlug(e.target.value)}
                placeholder="e.g. acme-shop-2"
              />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex gap-2 justify-end shrink-0 bg-slate-50/80">
              <button
                type="button"
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                onClick={() => {
                  setModal(null);
                  setCopySourceOrg(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
                onClick={() => void runCopyTemplate()}
              >
                {saving ? "Duplicating…" : "Create copy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
