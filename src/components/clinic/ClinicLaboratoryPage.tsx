import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import {
  computeNextLabOrderNumber,
  fetchClinicConsultations,
  fetchClinicLabOrders,
  fetchClinicPatients,
  insertClinicLabOrder,
  updateClinicLabOrderItem,
  updateClinicLabOrderStatus,
} from "@/lib/clinicData";
import type {
  ClinicLabAbnormalFlag,
  ClinicLabOrder,
  ClinicLabOrderItem,
  ClinicLabOrderStatus,
  ClinicConsultation,
  ClinicPatient,
} from "./clinicTypes";

export type ClinicLaboratoryTab = "orders" | "results";

export interface ClinicLaboratoryPageProps {
  readOnly?: boolean;
  initialTab?: ClinicLaboratoryTab;
  highlightLabOrderId?: string;
  onConsumedNavigateIntent?: () => void;
}

function statusBadge(status: ClinicLabOrderStatus) {
  const map: Record<ClinicLabOrderStatus, string> = {
    ordered: "bg-slate-100 text-slate-800 border-slate-200",
    in_progress: "bg-amber-50 text-amber-900 border-amber-200",
    completed: "bg-emerald-50 text-emerald-900 border-emerald-200",
    cancelled: "bg-red-50 text-red-800 border-red-200",
  };
  return map[status] ?? map.ordered;
}

export function ClinicLaboratoryPage({
  readOnly,
  initialTab = "orders",
  highlightLabOrderId,
  onConsumedNavigateIntent,
}: ClinicLaboratoryPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [tab, setTab] = useState<ClinicLaboratoryTab>(initialTab);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [consultations, setConsultations] = useState<ClinicConsultation[]>([]);
  const [orders, setOrders] = useState<ClinicLabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const [newPatientId, setNewPatientId] = useState("");
  const [newConsultationId, setNewConsultationId] = useState("");
  const [newClinicalNotes, setNewClinicalNotes] = useState("");
  const [newTestsText, setNewTestsText] = useState("");

  const reload = useCallback(async () => {
    if (!orgId) {
      setPatients([]);
      setConsultations([]);
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [p, c, o] = await Promise.all([
        fetchClinicPatients(orgId, superAdmin),
        fetchClinicConsultations(orgId, superAdmin),
        fetchClinicLabOrders(orgId, superAdmin),
      ]);
      setPatients(p);
      setConsultations(c);
      setOrders(o);
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : "Failed to load laboratory data");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!highlightLabOrderId) return;
    setExpandedOrderId(highlightLabOrderId);
    setTab("results");
    onConsumedNavigateIntent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightLabOrderId]);

  const consultationsForPatient = useMemo(() => {
    if (!newPatientId) return [];
    return consultations
      .filter((c) => c.patientId === newPatientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [consultations, newPatientId]);

  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? "—";

  const ordersNeedingResults = useMemo(
    () =>
      orders.filter(
        (o) =>
          (o.status === "ordered" || o.status === "in_progress") &&
          o.items.some((i) => !(i.resultValue || "").trim())
      ),
    [orders]
  );

  const completedOrders = useMemo(() => orders.filter((o) => o.status === "completed"), [orders]);

  const parseTestNames = (raw: string): string[] => {
    const lines = raw
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(lines)];
  };

  const createOrder = async () => {
    if (!orgId || readOnly) return;
    const tests = parseTestNames(newTestsText);
    if (!newPatientId || tests.length === 0) return;
    setSaving(true);
    setLoadError(null);
    try {
      const orderNumber = await computeNextLabOrderNumber(orgId, superAdmin);
      await insertClinicLabOrder({
        orgId,
        patientId: newPatientId,
        consultationId: newConsultationId || null,
        orderNumber,
        clinicalNotes: newClinicalNotes,
        testNames: tests,
        initialStatus: "ordered",
      });
      setNewTestsText("");
      setNewClinicalNotes("");
      setNewConsultationId("");
      await reload();
      setTab("results");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to create lab order");
    } finally {
      setSaving(false);
    }
  };

  const setOrderStatus = async (orderId: string, status: ClinicLabOrderStatus) => {
    if (readOnly) return;
    setSaving(true);
    setLoadError(null);
    try {
      await updateClinicLabOrderStatus(orderId, status);
      await reload();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (
    itemId: string,
    patch: { resultValue: string; resultUnit: string; referenceRange: string; abnormalFlag: ClinicLabAbnormalFlag | "" }
  ) => {
    if (readOnly) return;
    setSaving(true);
    setLoadError(null);
    try {
      await updateClinicLabOrderItem({ itemId, ...patch });
      await reload();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to save result line");
    } finally {
      setSaving(false);
    }
  };

  const tryCompleteOrder = async (order: ClinicLabOrder) => {
    if (readOnly) return;
    const pending = order.items.some((i) => !(i.resultValue || "").trim());
    if (pending) {
      alert("Enter a result value for every test before marking the order completed.");
      return;
    }
    await setOrderStatus(order.id, "completed");
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <FlaskConical className="w-8 h-8 text-emerald-700 shrink-0" />
        <h1 className="text-3xl font-bold text-slate-900">Laboratory</h1>
        <PageNotes ariaLabel="Laboratory help">
          <p>
            Create <strong className="font-medium text-slate-800">lab orders</strong> for a patient (optionally linked to a consultation).
            Record <strong className="font-medium text-slate-800">results</strong> per test, then mark the order completed when all lines are
            filled.
          </p>
        </PageNotes>
      </div>
      <p className="text-sm text-slate-500 mb-6">Lab orders and result entry for your clinic.</p>

      {readOnly && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Read-only mode.</p>
      )}

      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition ${
            tab === "orders" ? "border-emerald-700 text-emerald-800 bg-white" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Lab orders
        </button>
        <button
          type="button"
          onClick={() => setTab("results")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition ${
            tab === "results" ? "border-emerald-700 text-emerald-800 bg-white" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Lab results
        </button>
        <button
          type="button"
          onClick={() => void reload()}
          className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-2 py-2"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
      )}

      {tab === "orders" && (
        <div className="space-y-8">
          <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-700" />
              New lab order
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-sm md:col-span-2">
                <span className="text-slate-600">Patient</span>
                <select
                  value={newPatientId}
                  onChange={(e) => {
                    setNewPatientId(e.target.value);
                    setNewConsultationId("");
                  }}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                  disabled={readOnly}
                >
                  <option value="">Select patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.patientNumber} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="text-slate-600">Consultation (optional)</span>
                <select
                  value={newConsultationId}
                  onChange={(e) => setNewConsultationId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                  disabled={readOnly || !newPatientId}
                >
                  <option value="">None</option>
                  {consultationsForPatient.map((c) => (
                    <option key={c.id} value={c.id}>
                      {new Date(c.updatedAt).toLocaleString()} · {c.step} · {c.diagnosis?.slice(0, 40) || "—"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="text-slate-600">Clinical / collection notes</span>
                <textarea
                  value={newClinicalNotes}
                  onChange={(e) => setNewClinicalNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  disabled={readOnly}
                  placeholder="e.g. fasting, urgent, specimen type…"
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="text-slate-600">Tests requested (one per line or comma-separated)</span>
                <textarea
                  value={newTestsText}
                  onChange={(e) => setNewTestsText(e.target.value)}
                  rows={4}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                  disabled={readOnly}
                  placeholder={"Full blood count\nLipid profile\nBlood glucose"}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={readOnly || saving || !newPatientId || !newTestsText.trim()}
              onClick={() => void createOrder()}
              className="mt-4 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Create lab order"}
            </button>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-3">All lab orders</h2>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-slate-600">No lab orders yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <li key={o.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">
                        {o.orderNumber} · {patientName(o.patientId)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {new Date(o.updatedAt).toLocaleString()} · {o.items.length} test(s)
                      </div>
                      <span
                        className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${statusBadge(o.status)}`}
                      >
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-sm text-emerald-700 font-medium hover:underline"
                        onClick={() => {
                          setExpandedOrderId(o.id);
                          setTab("results");
                        }}
                      >
                        Results
                      </button>
                      {!readOnly && o.status !== "cancelled" && o.status !== "completed" ? (
                        <>
                          {o.status === "ordered" ? (
                            <button
                              type="button"
                              className="text-sm text-slate-700 hover:underline"
                              onClick={() => void setOrderStatus(o.id, "in_progress")}
                              disabled={saving}
                            >
                              Start processing
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="text-sm text-red-700 hover:underline"
                            onClick={() => void setOrderStatus(o.id, "cancelled")}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "results" && (
        <div className="space-y-8">
          <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-1">Pending results</h2>
            <p className="text-xs text-slate-500 mb-4">Orders that still need result values on one or more lines.</p>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : ordersNeedingResults.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing pending — create an order or complete existing ones.</p>
            ) : (
              <ul className="space-y-4">
                {ordersNeedingResults.map((o) => (
                  <li key={o.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex flex-wrap justify-between gap-2 mb-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {o.orderNumber} · {patientName(o.patientId)}
                        </div>
                        <div className="text-xs text-slate-500">{o.clinicalNotes ? o.clinicalNotes : "—"}</div>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border h-fit ${statusBadge(o.status)}`}>
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                    <ResultLinesEditor
                      order={o}
                      readOnly={readOnly}
                      saving={saving}
                      expanded={expandedOrderId === o.id || ordersNeedingResults.length === 1}
                      onToggle={() => setExpandedOrderId((id) => (id === o.id ? null : o.id))}
                      onSaveLine={saveItem}
                      onMarkComplete={() => void tryCompleteOrder(o)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-3">Completed orders</h2>
            {completedOrders.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {completedOrders.map((o) => (
                  <li key={o.id} className="py-3">
                    <div className="font-medium text-slate-900">
                      {o.orderNumber} · {patientName(o.patientId)}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{new Date(o.updatedAt).toLocaleString()}</div>
                    <button
                      type="button"
                      className="mt-2 text-sm text-emerald-700 hover:underline"
                      onClick={() => setExpandedOrderId((id) => (id === o.id ? null : o.id))}
                    >
                      {expandedOrderId === o.id ? "Hide" : "View"} results
                    </button>
                    {expandedOrderId === o.id ? (
                      <div className="mt-3 pl-2 border-l-2 border-emerald-200 space-y-2">
                        {o.items.map((it) => (
                          <div key={it.id} className="text-sm">
                            <span className="font-medium text-slate-800">{it.testName}:</span>{" "}
                            <span className="text-slate-700">{it.resultValue || "—"}</span>
                            {it.resultUnit ? <span className="text-slate-500"> {it.resultUnit}</span> : null}
                            {it.referenceRange ? (
                              <span className="text-slate-400 text-xs"> (ref {it.referenceRange})</span>
                            ) : null}
                            {it.abnormalFlag ? (
                              <span className="ml-2 text-xs font-semibold text-amber-800">{it.abnormalFlag}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ResultLinesEditor({
  order,
  readOnly,
  saving,
  expanded,
  onToggle,
  onSaveLine,
  onMarkComplete,
}: {
  order: ClinicLabOrder;
  readOnly?: boolean;
  saving: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaveLine: (
    itemId: string,
    patch: { resultValue: string; resultUnit: string; referenceRange: string; abnormalFlag: ClinicLabAbnormalFlag | "" }
  ) => void | Promise<void>;
  onMarkComplete: () => void | Promise<void>;
}) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="text-sm text-emerald-700 font-medium hover:underline mb-2">
        {expanded ? "Collapse" : "Expand"} result entry
      </button>
      {expanded ? (
        <div className="space-y-4 mt-2">
          {order.items.map((it) => (
            <ResultLineRow key={it.id} item={it} readOnly={readOnly} saving={saving} onSave={onSaveLine} />
          ))}
          {!readOnly ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onMarkComplete()}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              Mark order completed
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultLineRow({
  item,
  readOnly,
  saving,
  onSave,
}: {
  item: ClinicLabOrderItem;
  readOnly?: boolean;
  saving: boolean;
  onSave: (
    itemId: string,
    patch: { resultValue: string; resultUnit: string; referenceRange: string; abnormalFlag: ClinicLabAbnormalFlag | "" }
  ) => void | Promise<void>;
}) {
  const [resultValue, setResultValue] = useState(item.resultValue);
  const [resultUnit, setResultUnit] = useState(item.resultUnit);
  const [referenceRange, setReferenceRange] = useState(item.referenceRange);
  const [abnormalFlag, setAbnormalFlag] = useState<ClinicLabAbnormalFlag | "">(item.abnormalFlag || "");

  useEffect(() => {
    setResultValue(item.resultValue);
    setResultUnit(item.resultUnit);
    setReferenceRange(item.referenceRange);
    setAbnormalFlag(item.abnormalFlag || "");
  }, [item.id, item.resultValue, item.resultUnit, item.referenceRange, item.abnormalFlag]);

  return (
    <div className="rounded-md bg-slate-50 border border-slate-100 p-3">
      <div className="font-medium text-slate-900 text-sm mb-2">{item.testName}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label className="text-xs">
          <span className="text-slate-500">Result</span>
          <input
            value={resultValue}
            onChange={(e) => setResultValue(e.target.value)}
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            disabled={readOnly}
          />
        </label>
        <label className="text-xs">
          <span className="text-slate-500">Unit</span>
          <input
            value={resultUnit}
            onChange={(e) => setResultUnit(e.target.value)}
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            disabled={readOnly}
            placeholder="e.g. g/dL"
          />
        </label>
        <label className="text-xs sm:col-span-2 lg:col-span-1">
          <span className="text-slate-500">Reference range</span>
          <input
            value={referenceRange}
            onChange={(e) => setReferenceRange(e.target.value)}
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            disabled={readOnly}
            placeholder="e.g. 12–16"
          />
        </label>
        <label className="text-xs">
          <span className="text-slate-500">Flag</span>
          <select
            value={abnormalFlag}
            onChange={(e) => setAbnormalFlag((e.target.value || "") as ClinicLabAbnormalFlag | "")}
            className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
            disabled={readOnly}
          >
            <option value="">—</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>
      {!readOnly ? (
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            void onSave(item.id, {
              resultValue,
              resultUnit,
              referenceRange,
              abnormalFlag,
            })
          }
          className="mt-2 text-sm text-emerald-700 font-medium hover:underline disabled:opacity-40"
        >
          Save line
        </button>
      ) : null}
    </div>
  );
}
