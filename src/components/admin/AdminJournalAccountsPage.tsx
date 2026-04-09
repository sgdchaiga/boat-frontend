import { useEffect, useMemo, useState } from "react";
import { BookOpen, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import {
  loadJournalAccountSettings,
  saveJournalAccountSettings,
  fetchJournalGlSettings,
  upsertJournalGlSettings,
  getJournalAccountRolesForBusinessType,
  type JournalAccountSettings,
} from "../../lib/journalAccountSettings";
import { clearJournalAccountCache } from "../../lib/journal";
import {
  upsertFixedAssetCategoryGlRow,
  type FixedAssetCategoryGlRow,
} from "../../lib/fixedAssetCategoryGlSettings";
import { GlAccountPicker, type GlAccountOption } from "../common/GlAccountPicker";
import { PageNotes } from "../common/PageNotes";

type GLAccount = { id: string; account_code: string; account_name: string; account_type: string };

type FaCategoryRow = { id: string; name: string; parent_id: string | null };

type CategoryGlDraft = Pick<
  FixedAssetCategoryGlRow,
  | "fixed_asset_cost_gl_account_id"
  | "accumulated_depreciation_gl_account_id"
  | "depreciation_expense_gl_account_id"
  | "revaluation_reserve_gl_account_id"
  | "impairment_loss_gl_account_id"
  | "gain_on_disposal_gl_account_id"
  | "loss_on_disposal_gl_account_id"
>;

const FA_CATEGORY_GL_FIELDS: { key: keyof CategoryGlDraft; label: string; accountType: string }[] = [
  { key: "fixed_asset_cost_gl_account_id", label: "Fixed assets — cost (PPE)", accountType: "asset" },
  { key: "accumulated_depreciation_gl_account_id", label: "Accumulated depreciation (contra)", accountType: "asset" },
  { key: "depreciation_expense_gl_account_id", label: "Depreciation expense", accountType: "expense" },
  { key: "revaluation_reserve_gl_account_id", label: "Revaluation reserve (equity)", accountType: "equity" },
  { key: "impairment_loss_gl_account_id", label: "Impairment loss", accountType: "expense" },
  { key: "gain_on_disposal_gl_account_id", label: "Gain on disposal", accountType: "income" },
  { key: "loss_on_disposal_gl_account_id", label: "Loss on disposal", accountType: "expense" },
];

function emptyCategoryGlDraft(): CategoryGlDraft {
  return {
    fixed_asset_cost_gl_account_id: null,
    accumulated_depreciation_gl_account_id: null,
    depreciation_expense_gl_account_id: null,
    revaluation_reserve_gl_account_id: null,
    impairment_loss_gl_account_id: null,
    gain_on_disposal_gl_account_id: null,
    loss_on_disposal_gl_account_id: null,
  };
}

function categoryDisplayName(c: FaCategoryRow, byId: Map<string, FaCategoryRow>): string {
  if (!c.parent_id) return c.name;
  const p = byId.get(c.parent_id);
  return p ? `${p.name} → ${c.name}` : c.name;
}

export function AdminJournalAccountsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const businessType = user?.business_type ?? undefined;
  const btLower = (businessType || "").toLowerCase();
  const isRetailLike = btLower === "retail" || btLower === "other";
  const isSchool = btLower === "school";
  const isSacco = btLower === "sacco";
  const isHotelLike = btLower === "hotel" || btLower === "mixed" || btLower === "restaurant";
  const enableFixedAssets = user?.enable_fixed_assets === true;
  const showHotelPosDeptTable = isHotelLike;

  const journalRoleRows = useMemo(
    () => getJournalAccountRolesForBusinessType(businessType),
    [businessType]
  );

  const journalGroups = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const r of journalRoleRows) {
      if (!seen.has(r.group)) {
        seen.add(r.group);
        order.push(r.group);
      }
    }
    return order.map((title) => ({
      title,
      rows: journalRoleRows.filter((r) => r.group === title),
    }));
  }, [journalRoleRows]);

  const [settings, setSettings] = useState<JournalAccountSettings>(loadJournalAccountSettings());
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [faCategories, setFaCategories] = useState<FaCategoryRow[]>([]);
  const [categoryGl, setCategoryGl] = useState<Record<string, CategoryGlDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const faCategoryById = useMemo(() => new Map(faCategories.map((c) => [c.id, c])), [faCategories]);

  useEffect(() => {
    loadAccounts();
  }, [orgId, superAdmin, enableFixedAssets]);

  const loadAccounts = async () => {
    setAccountsError(null);
    const { data, error } = await supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type")
      .order("account_code");
    if (error) {
      console.error("gl_accounts load error:", error);
      setAccountsError(error.message);
      setAccounts([]);
    } else {
      setAccounts((data || []) as GLAccount[]);
    }
    if (orgId) {
      const fromDb = await fetchJournalGlSettings(orgId);
      setSettings(fromDb ?? loadJournalAccountSettings());
    } else {
      setSettings(loadJournalAccountSettings());
    }

    if (orgId && enableFixedAssets) {
      const { data: cats } = await filterByOrganizationId(
        supabase.from("fixed_asset_categories").select("id, name, parent_id").order("sort_order").order("name"),
        orgId,
        superAdmin
      );
      const list = (cats || []) as FaCategoryRow[];
      setFaCategories(list);
      const { data: glRows } = await supabase
        .from("fixed_asset_category_gl_settings")
        .select("*")
        .eq("organization_id", orgId);
      const byCat = new Map((glRows || []).map((r) => [(r as FixedAssetCategoryGlRow).category_id, r as FixedAssetCategoryGlRow]));
      const next: Record<string, CategoryGlDraft> = {};
      for (const c of list) {
        const r = byCat.get(c.id);
        next[c.id] = {
          fixed_asset_cost_gl_account_id: r?.fixed_asset_cost_gl_account_id ?? null,
          accumulated_depreciation_gl_account_id: r?.accumulated_depreciation_gl_account_id ?? null,
          depreciation_expense_gl_account_id: r?.depreciation_expense_gl_account_id ?? null,
          revaluation_reserve_gl_account_id: r?.revaluation_reserve_gl_account_id ?? null,
          impairment_loss_gl_account_id: r?.impairment_loss_gl_account_id ?? null,
          gain_on_disposal_gl_account_id: r?.gain_on_disposal_gl_account_id ?? null,
          loss_on_disposal_gl_account_id: r?.loss_on_disposal_gl_account_id ?? null,
        };
      }
      setCategoryGl(next);
    } else {
      setFaCategories([]);
      setCategoryGl({});
    }
    setLoading(false);
  };

  const setAccount = (role: keyof JournalAccountSettings, value: string | null) => {
    setSettings((prev) => ({ ...prev, [role]: value || null }));
  };

  const setDefaultVatPercent = (value: string) => {
    if (value.trim() === "") {
      setSettings((prev) => ({ ...prev, default_vat_percent: null }));
      return;
    }
    const n = parseFloat(value);
    setSettings((prev) => ({ ...prev, default_vat_percent: Number.isFinite(n) ? n : null }));
  };

  const setCategoryAccount = (categoryId: string, key: keyof CategoryGlDraft, value: string | null) => {
    setCategoryGl((prev) => ({
      ...prev,
      [categoryId]: { ...(prev[categoryId] ?? emptyCategoryGlDraft()), [key]: value || null },
    }));
  };

  /** Picker for department table cells (same behaviour as grouped rows: type filter + orphan saved id). */
  const renderDeptAccountPicker = (roleKey: keyof JournalAccountSettings, accountType: string) => {
    const valueId = (settings[roleKey] as string | null | undefined) ?? "";
    const byType = accounts.filter(
      (a) => (a.account_type || "").toLowerCase() === accountType.toLowerCase()
    );
    const selectedAcc = valueId ? accounts.find((a) => a.id === valueId) : undefined;
    let options: GlAccountOption[] = byType.map((a) => ({
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
    }));
    if (valueId && selectedAcc && !byType.some((a) => a.id === valueId)) {
      options = [
        ...options,
        { id: selectedAcc.id, account_code: selectedAcc.account_code, account_name: selectedAcc.account_name },
      ];
    } else if (valueId && !selectedAcc) {
      options = [
        ...options,
        {
          id: valueId,
          account_code: "?",
          account_name: "Saved account missing from chart — choose another",
        },
      ];
    }
    return (
      <GlAccountPicker
        value={valueId}
        onChange={(v) => setAccount(roleKey, v || null)}
        options={options}
        emptyOption={{ label: `Auto (first ${accountType} account)` }}
        placeholder="Type code or name to search…"
        className="w-full min-w-[200px]"
      />
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (
        isSacco &&
        !settings.teller_allow_per_transaction_counterparty_gl &&
        !settings.teller_default_counterparty_gl_id
      ) {
        alert(
          "When teller staff cannot choose GL per transaction, set a default counterparty GL account (or turn “choose per transaction” back on)."
        );
        setSaving(false);
        return;
      }
      if (orgId) {
        await upsertJournalGlSettings(orgId, settings);
        if (enableFixedAssets) {
          for (const c of faCategories) {
            const draft = categoryGl[c.id] ?? emptyCategoryGlDraft();
            await upsertFixedAssetCategoryGlRow(orgId, c.id, draft);
          }
        }
      }
      saveJournalAccountSettings(settings);
      clearJournalAccountCache();
      alert("Journal account settings saved. New automatic journal entries will use these accounts.");
    } catch (e) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : e instanceof Error
            ? e.message
            : String(e);
      const details =
        e && typeof e === "object" && "details" in e && (e as { details?: string }).details
          ? ` — ${String((e as { details?: string }).details)}`
          : "";
      alert(`Failed to save: ${msg}${details}`);
      console.error("Journal settings save error:", e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-slate-500 py-8">Loading…</div>;

  return (
    <div className="space-y-6">
      {accountsError ? (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-sm">
          <strong className="font-semibold">Could not load GL accounts.</strong> {accountsError}
        </div>
      ) : null}
      {!accountsError && accounts.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-xl px-4 py-3 text-sm space-y-2">
          <p>
            <strong className="font-semibold">No GL accounts available for the pickers.</strong> Add accounts under{" "}
            <strong>Accounting → Chart of Accounts</strong>, or seed the chart for this organization.
          </p>
          <p className="text-amber-900/90">
            Each account must have <strong>organization_id</strong> set to your property&apos;s ID — otherwise row-level security hides them. If you
            imported SQL without <code className="text-xs bg-amber-100/80 px-1 rounded">organization_id</code>, update those rows in the database or
            re-run the seed with your org UUID.
          </p>
          {!orgId ? (
            <p className="text-amber-900/90">
              Your user has no <strong>organization</strong> on file (e.g. missing staff record). Journal settings need a staff login linked to the
              hotel organization.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Double-entry account settings</h2>
          <PageNotes ariaLabel="Journal account settings help">
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                {isRetailLike ? (
                  <>
                    Choose GL accounts for <strong>retail / general</strong> sales, POS receipts, and cost of goods / inventory. Vendor bills,
                    expenses, and invoices use the core accounts below. Hotel-only POS sections (bar · kitchen · room) are hidden. Leave a row on Auto
                    to use the first matching account from your chart.
                  </>
                ) : isSacco ? (
                  <>
                    Map core <strong>SACCO</strong> buckets — cash &amp; bank, loans receivable, interest income, member deposits / liabilities — so
                    teller, cashbook, and loan workflows post balanced journals into the same engine as the rest of BOAT.
                  </>
                ) : isSchool ? (
                  <>
                    Map <strong>school</strong> core buckets — revenue, cash, payables, VAT, and GRN/stock. Hotel and F&amp;B POS shortcuts are omitted.
                    Use Fixed assets below if you capitalize assets.
                  </>
                ) : (
                  <>
                    Use the <strong>department table</strong> for Bar / Kitchen / Room — set <strong>sales revenue</strong>, <strong>COGS</strong>, and{" "}
                    <strong>stock</strong> per department (e.g. bar sales vs kitchen sales). Payment method GLs and default revenue sit above the table.
                    VAT (if used) is one line on the journal. Room charges and payables use the default revenue and core accounts below.
                  </>
                )}
              </p>
              <p className="text-xs border-l-2 border-brand-600/40 pl-3 py-1 bg-slate-50/80 rounded-r-md">
                <strong className="text-slate-800">GRN/Bills — Shop stock / inventory</strong> is for goods received (not the same as POS departmental
                stock rows). <strong className="text-slate-800">Expense (default)</strong> applies to vendor credits and legacy expenses.{" "}
                <strong>Purchases → Expenses</strong> uses the expense GL per line. <strong className="text-slate-800">VAT</strong> and{" "}
                <strong>Default VAT %</strong> apply when totals are VAT-inclusive. Leave a row on Auto to pick the first matching account type from your
                chart.
              </p>
            </div>
          </PageNotes>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {isSacco ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100 pb-2">
            Teller — cash deposit / withdrawal (GL)
          </h3>
          <p className="text-sm text-slate-600">
            Cash teller journals pair till cash with another GL line (e.g. member savings liability, fees). Choose whether staff pick that account on
            each transaction or always use one default from here.
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={settings.teller_allow_per_transaction_counterparty_gl}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  teller_allow_per_transaction_counterparty_gl: e.target.checked,
                }))
              }
            />
            <span className="text-sm text-slate-800">
              <strong>Allow staff to choose counterparty GL</strong> on each deposit and withdrawal (different accounts per transaction when needed).
            </span>
          </label>
          {!settings.teller_allow_per_transaction_counterparty_gl ? (
            <div className="flex flex-wrap items-start gap-4 pt-2">
              <label className="w-52 font-medium text-slate-700 pt-2.5 shrink-0">Default counterparty GL</label>
              <div className="flex-1 min-w-[220px] max-w-xl">
                <GlAccountPicker
                  value={settings.teller_default_counterparty_gl_id ?? ""}
                  onChange={(v) =>
                    setSettings((prev) => ({
                      ...prev,
                      teller_default_counterparty_gl_id: v || null,
                    }))
                  }
                  options={accounts.map((a) => ({
                    id: a.id,
                    account_code: a.account_code,
                    account_name: a.account_name,
                  }))}
                  emptyOption={{ label: "Select default GL account…" }}
                  placeholder="Type code or name to search…"
                  className="w-full"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Used for every cash deposit and withdrawal when per-transaction selection is off.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-8">
        {showHotelPosDeptTable ? (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100 pb-2">
              Hotel POS — by department (Bar · Kitchen · Room)
            </h3>
            <p className="text-sm text-slate-600">
              Map <strong>sales revenue</strong>, <strong>COGS</strong>, and <strong>stock</strong> per department. Products use their assigned
              department; names are mapped to Bar / Kitchen / Room (e.g. departments containing &quot;bar&quot;, &quot;kitchen&quot;, &quot;room&quot;).
              POS splits the sale total across these revenue accounts in proportion to line totals. Leave a cell on Auto to use the first account of
              that type from your chart.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-2.5 border-b border-slate-200 w-44">Department</th>
                    <th className="px-3 py-2.5 border-b border-slate-200 min-w-[220px]">Sales revenue</th>
                    <th className="px-3 py-2.5 border-b border-slate-200 min-w-[220px]">Purchases (COGS)</th>
                    <th className="px-3 py-2.5 border-b border-slate-200 min-w-[220px]">Stock (inventory)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 bg-white">
                    <td className="px-3 py-3 font-medium text-slate-800 align-top">Bar</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_revenue_bar_id", "income")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_cogs_bar_id", "expense")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_inventory_bar_id", "asset")}</td>
                  </tr>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    <td className="px-3 py-3 font-medium text-slate-800 align-top">Kitchen / F&amp;B</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_revenue_kitchen_id", "income")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_cogs_kitchen_id", "expense")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_inventory_kitchen_id", "asset")}</td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-3 py-3 font-medium text-slate-800 align-top">Room / minibar</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_revenue_room_id", "income")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_cogs_room_id", "expense")}</td>
                    <td className="px-3 py-2 align-top">{renderDeptAccountPicker("pos_inventory_room_id", "asset")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {journalGroups.map(({ title, rows }) => (
          <div key={title} className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100 pb-2">
              {title}
            </h3>
            <div className="space-y-6">
              {rows.map(({ id, label, accountType }) => {
                const roleKey = `${id}_id` as keyof JournalAccountSettings;
                const valueId = (settings[roleKey] as string | null | undefined) ?? "";
                const byType = accounts.filter(
                  (a) => (a.account_type || "").toLowerCase() === accountType.toLowerCase()
                );
                const selectedAcc = valueId ? accounts.find((a) => a.id === valueId) : undefined;

                let options: GlAccountOption[];
                let emptyOption: { label: string };

                if (id === "vat") {
                  options = accounts.map((a) => ({
                    id: a.id,
                    account_code: a.account_code,
                    account_name: a.account_name,
                  }));
                  if (valueId && selectedAcc && !options.some((o) => o.id === valueId)) {
                    options = [
                      ...options,
                      { id: selectedAcc.id, account_code: selectedAcc.account_code, account_name: selectedAcc.account_name },
                    ];
                  } else if (valueId && !selectedAcc) {
                    options = [
                      ...options,
                      {
                        id: valueId,
                        account_code: "?",
                        account_name: "Saved account missing from chart — choose another",
                      },
                    ];
                  }
                  emptyOption = { label: "— None —" };
                } else {
                  options = byType;
                  if (valueId && selectedAcc && !byType.some((a) => a.id === valueId)) {
                    options = [...byType, selectedAcc];
                  } else if (valueId && !selectedAcc) {
                    options = [
                      ...byType,
                      {
                        id: valueId,
                        account_code: "?",
                        account_name: "Saved account missing from chart — choose another",
                      },
                    ];
                  }
                  emptyOption = { label: `Auto (first ${accountType} account)` };
                }

                return (
                  <div key={id} className="space-y-3">
                    <div className="flex flex-wrap items-start gap-4">
                      <label className="w-52 font-medium text-slate-700 pt-2.5 shrink-0">{label}</label>
                      <div className="flex-1 min-w-[220px] max-w-xl">
                        <GlAccountPicker
                          value={valueId}
                          onChange={(v) => setAccount(roleKey, v || null)}
                          options={options}
                          emptyOption={emptyOption}
                          placeholder="Type code or name to search…"
                          className="w-full"
                        />
                      </div>
                    </div>
                    {id === "vat" ? (
                      <div className="flex flex-wrap items-start gap-4 pl-0 sm:pl-0">
                        <label className="w-52 font-medium text-slate-700 pt-2.5 shrink-0">
                          Default VAT % (expenses)
                        </label>
                        <div className="flex-1 min-w-[220px] max-w-xs">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            max={100}
                            value={settings.default_vat_percent ?? ""}
                            onChange={(e) => setDefaultVatPercent(e.target.value)}
                            placeholder="e.g. 18"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            Used for <strong>Purchases → Expenses</strong> and <strong>POS</strong> when totals include VAT.
                            Leave empty to use 18% for expenses only; POS VAT split is skipped if unset.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {enableFixedAssets && orgId && faCategories.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fixed assets — by category</h3>
            <PageNotes ariaLabel="Fixed assets by category help">
              <p className="text-sm text-slate-700">
                Create categories under <strong>Accounting → Fixed assets → Categories</strong> (e.g. Land, Buildings, Plant &amp; machinery). For each
                category, you can override the default accounts from the <strong>Fixed assets</strong> section above. Leave a picker on{" "}
                <strong>Auto</strong> to use the org default for that role.
              </p>
            </PageNotes>
          </div>
          {faCategories.map((c) => (
              <div key={c.id} className="border border-slate-200 rounded-lg p-4 space-y-4 bg-slate-50/40">
                <h4 className="font-medium text-slate-900">{categoryDisplayName(c, faCategoryById)}</h4>
                <div className="space-y-4">
                  {FA_CATEGORY_GL_FIELDS.map(({ key, label, accountType }) => {
                    const draft = categoryGl[c.id] ?? emptyCategoryGlDraft();
                    const valueId = draft[key] ?? "";
                    const byType = accounts.filter(
                  (a) => (a.account_type || "").toLowerCase() === accountType.toLowerCase()
                );
                    const selectedAcc = valueId ? accounts.find((a) => a.id === valueId) : undefined;
                    let options: GlAccountOption[] = byType.map((a) => ({
                      id: a.id,
                      account_code: a.account_code,
                      account_name: a.account_name,
                    }));
                    if (valueId && selectedAcc && !byType.some((a) => a.id === valueId)) {
                      options = [
                        ...options,
                        { id: selectedAcc.id, account_code: selectedAcc.account_code, account_name: selectedAcc.account_name },
                      ];
                    } else if (valueId && !selectedAcc) {
                      options = [
                        ...options,
                        {
                          id: valueId,
                          account_code: "?",
                          account_name: "Saved account missing from chart — choose another",
                        },
                      ];
                    }
                    return (
                      <div key={key} className="flex flex-wrap items-start gap-4">
                        <label className="w-52 font-medium text-slate-700 pt-2.5 shrink-0 text-sm">{label}</label>
                        <div className="flex-1 min-w-[220px] max-w-xl">
                          <GlAccountPicker
                            value={valueId}
                            onChange={(v) => setCategoryAccount(c.id, key, v || null)}
                            options={options}
                            emptyOption={{ label: `Auto (use org default ${accountType})` }}
                            placeholder="Type code or name to search…"
                            className="w-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      ) : enableFixedAssets && orgId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950">
          <strong>Fixed assets — by category:</strong> add at least one category under{" "}
          <strong>Fixed assets → Categories</strong> to map GL accounts per class (Land, Buildings, etc.).
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <BookOpen className="w-4 h-4" />
        <span>Configure accounts under Accounting → Chart of Accounts, then assign them here.</span>
      </div>
    </div>
  );
}
