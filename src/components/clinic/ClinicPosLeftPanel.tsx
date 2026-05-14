import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Pill } from "lucide-react";
import type { PosLabels } from "@/lib/posExperience";
import { CLINIC_POS_LEFT_SECTIONS } from "@/lib/posExperience";
import type { ClinicConsultation, ClinicPatient } from "./clinicTypes";

/** Mirrors retail POS `Product` / cart line shape used by `useCart`. */
export interface ClinicPosMedicine {
  id: string;
  name: string;
  sales_price: number | null;
  cost_price: number | null;
  track_inventory: boolean | null;
  department_id?: string | null;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
}

interface CartLine {
  product: ClinicPosMedicine;
  quantity: number;
  lineTotal: number;
  unitPriceOverride?: number | null;
}

export interface ClinicPosLeftPanelProps {
  labels: PosLabels;
  patients: ClinicPatient[];
  patientsLoading: boolean;
  patientQuery: string;
  setPatientQuery: (v: string) => void;
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  consultations: ClinicConsultation[];
  consultationsLoading: boolean;
  prescriptionQuery: string;
  setPrescriptionQuery: (v: string) => void;
  scanCode: string;
  setScanCode: (v: string) => void;
  handleScan: () => void;
  scanInputRef: RefObject<HTMLInputElement | null>;
  medicineSearch: string;
  setMedicineSearch: (v: string) => void;
  filteredMedicines: ClinicPosMedicine[];
  addMedicineToCart: (p: ClinicPosMedicine) => void;
  getUnitPrice: (p: ClinicPosMedicine, quantity?: number) => number;
  quickPickMedicines: ClinicPosMedicine[];
  cart: CartLine[];
  updateQty: (productId: string, qty: number) => void;
  setLineUnitPrice: (productId: string, unitPrice: number) => void;
  hasMoreProducts: boolean;
  catalogLoadingMore: boolean;
  onLoadMoreProducts: () => void;
}

function DispensingLineUnitPriceInput({
  productId,
  quantity,
  catalogUnit,
  unitPriceOverride,
  setLineUnitPrice,
  ariaLabel,
}: {
  productId: string;
  quantity: number;
  catalogUnit: number;
  unitPriceOverride?: number | null;
  setLineUnitPrice: (productId: string, unitPrice: number) => void;
  ariaLabel: string;
}) {
  const resolved =
    unitPriceOverride != null && Number.isFinite(unitPriceOverride) ? unitPriceOverride : catalogUnit;
  const normalized = Number.isFinite(resolved) ? Math.round(resolved * 100) / 100 : 0;
  const [draft, setDraft] = useState(() => String(normalized));

  useEffect(() => {
    const r =
      unitPriceOverride != null && Number.isFinite(unitPriceOverride) ? unitPriceOverride : catalogUnit;
    const n = Number.isFinite(r) ? Math.round(r * 100) / 100 : 0;
    setDraft(String(n));
  }, [productId, quantity, unitPriceOverride, catalogUnit]);

  return (
    <div className="flex flex-col items-stretch gap-0.5">
      <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:block">
        {CLINIC_POS_LEFT_SECTIONS.lineSalesPriceEach}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={1}
        className="w-full min-w-[3.25rem] rounded border border-slate-300 px-1 py-1 text-right text-xs tabular-nums text-slate-900 sm:min-w-[4rem]"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const raw = draft.trim();
          const n = parseFloat(raw);
          if (raw === "" || !Number.isFinite(n) || n < 0) {
            setDraft(String(normalized));
            return;
          }
          setLineUnitPrice(productId, n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function ClinicPosLeftPanel({
  labels,
  patients,
  patientsLoading,
  patientQuery,
  setPatientQuery,
  selectedPatientId,
  setSelectedPatientId,
  consultations,
  consultationsLoading,
  prescriptionQuery,
  setPrescriptionQuery,
  scanCode,
  setScanCode,
  handleScan,
  scanInputRef,
  medicineSearch,
  setMedicineSearch,
  filteredMedicines,
  addMedicineToCart,
  getUnitPrice,
  quickPickMedicines,
  cart,
  updateQty,
  setLineUnitPrice,
  hasMoreProducts,
  catalogLoadingMore,
  onLoadMoreProducts,
}: ClinicPosLeftPanelProps) {
  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return patients.slice(0, 40);
    return patients
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.patientNumber.toLowerCase().includes(q) ||
          (p.phone || "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [patients, patientQuery]);

  const patientScopedConsultations = useMemo(() => {
    if (!selectedPatientId) return [];
    return consultations.filter((c) => c.patientId === selectedPatientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [consultations, selectedPatientId]);

  const prescriptionMatches = useMemo(() => {
    const pq = prescriptionQuery.trim().toLowerCase();
    let rows = selectedPatientId ? patientScopedConsultations : consultations;
    if (pq) {
      rows = rows.filter((c) => (c.prescription || "").toLowerCase().includes(pq));
    }
    return rows.slice(0, 12);
  }, [consultations, patientScopedConsultations, prescriptionQuery, selectedPatientId]);

  const notesDigest = useMemo(() => {
    if (!selectedPatientId) return "";
    return patientScopedConsultations
      .map((c) => {
        const bits = [c.notes?.trim(), c.symptoms?.trim(), c.diagnosis?.trim()].filter(Boolean);
        return bits.length ? `— ${c.updatedAt.slice(0, 10)}\n${bits.join("\n")}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }, [patientScopedConsultations, selectedPatientId]);

  const showMedicineResults = medicineSearch.trim().length > 0;
  const medicineResultRows = filteredMedicines.slice(0, 8);

  const [showConsultationNotes, setShowConsultationNotes] = useState(false);
  const [showPrescriptionPanel, setShowPrescriptionPanel] = useState(false);

  const toggleBtnClass = (active: boolean) =>
    `inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-slate-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 ${
      active
        ? "border-emerald-500 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-900"
    }`;

  const railInputClass = "w-full rounded border border-slate-300 px-1.5 py-1 text-[11px] leading-tight placeholder:text-[10px] sm:text-xs";
  const railBtnClass =
    "w-full rounded border border-slate-300 px-1.5 py-1 text-[10px] font-medium text-slate-800 hover:bg-slate-50 sm:text-xs";

  return (
    <div className="contents min-h-0">
      {/* Search rail ~20% page width (clinic grid col 1); retail uses implicit placement */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 max-lg:min-h-[min(42vh,320px)]">
        <div className="flex min-h-0 min-w-0 flex-[0.88] flex-col overflow-hidden rounded-md border border-slate-200 bg-slate-50/80 p-1">
          <div className="flex shrink-0 items-start justify-between gap-0.5">
            <h2 className="text-[9px] font-bold uppercase leading-tight tracking-wide text-slate-600">
              {CLINIC_POS_LEFT_SECTIONS.patientSearch}
            </h2>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                type="button"
                className={toggleBtnClass(showConsultationNotes)}
                aria-pressed={showConsultationNotes}
                title={CLINIC_POS_LEFT_SECTIONS.consultationNotes}
                aria-label={`${showConsultationNotes ? "Hide" : "Show"} ${CLINIC_POS_LEFT_SECTIONS.consultationNotes}`}
                onClick={() => setShowConsultationNotes((v) => !v)}
              >
                <ClipboardList className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                className={toggleBtnClass(showPrescriptionPanel)}
                aria-pressed={showPrescriptionPanel}
                title={CLINIC_POS_LEFT_SECTIONS.prescriptionSearch}
                aria-label={`${showPrescriptionPanel ? "Hide" : "Show"} ${CLINIC_POS_LEFT_SECTIONS.prescriptionSearch}`}
                onClick={() => setShowPrescriptionPanel((v) => !v)}
              >
                <Pill className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
          <input
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
            placeholder="Search…"
            className={`${railInputClass} mt-1 shrink-0`}
            aria-label="Patient search"
          />
          <div className="mt-1 min-h-0 max-h-32 flex-1 overflow-y-auto rounded border border-slate-200 bg-white sm:max-h-40">
            {patientsLoading ? (
              <p className="p-1.5 text-[10px] text-slate-500">Loading…</p>
            ) : filteredPatients.length === 0 ? (
              <p className="p-1.5 text-[10px] text-slate-500">No match.</p>
            ) : (
              filteredPatients.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPatientId(p.id === selectedPatientId ? null : p.id)}
                  className={`w-full border-b border-slate-100 px-1.5 py-1 text-left text-[10px] last:border-b-0 hover:bg-emerald-50/80 sm:text-xs ${
                    selectedPatientId === p.id ? "bg-emerald-50 font-semibold text-emerald-900" : "text-slate-800"
                  }`}
                >
                  <span className="block truncate leading-tight">{p.name}</span>
                  <span className="block truncate text-[9px] text-slate-500">{p.patientNumber}</span>
                </button>
              ))
            )}
          </div>
          <div className="mt-1 min-h-0 max-h-28 shrink-0 overflow-y-auto border-t border-slate-200 pt-1">
            {showConsultationNotes ? (
              <div>
                <p className="mb-0.5 text-[8px] font-semibold uppercase text-slate-500">{CLINIC_POS_LEFT_SECTIONS.consultationNotes}</p>
                {!selectedPatientId ? (
                  <p className="text-[10px] text-slate-600">Select a patient.</p>
                ) : consultationsLoading ? (
                  <p className="text-[10px] text-slate-500">Loading…</p>
                ) : !notesDigest ? (
                  <p className="text-[10px] text-slate-600">No notes.</p>
                ) : (
                  <pre className="max-h-20 overflow-y-auto font-sans text-[9px] leading-snug whitespace-pre-wrap text-slate-800">{notesDigest}</pre>
                )}
              </div>
            ) : null}
            {showPrescriptionPanel ? (
              <div className={showConsultationNotes ? "mt-1.5 border-t border-slate-200 pt-1.5" : ""}>
                <p className="mb-0.5 text-[8px] font-semibold uppercase text-slate-500">{CLINIC_POS_LEFT_SECTIONS.prescriptionSearch}</p>
                <input
                  value={prescriptionQuery}
                  onChange={(e) => setPrescriptionQuery(e.target.value)}
                  placeholder="Rx filter…"
                  className={`${railInputClass} mb-1`}
                />
                <div className="max-h-20 overflow-y-auto rounded border border-slate-200 bg-white">
                  {consultationsLoading ? (
                    <p className="p-1 text-[10px] text-slate-500">Loading…</p>
                  ) : prescriptionMatches.length === 0 ? (
                    <p className="p-1 text-[10px] text-slate-500">None.</p>
                  ) : (
                    prescriptionMatches.map((c) => (
                      <div key={c.id} className="border-b border-slate-100 px-1 py-1 text-[9px] text-slate-800 last:border-b-0">
                        <p className="font-semibold text-slate-900">{c.updatedAt.slice(0, 10)}</p>
                        <p className="line-clamp-2 text-slate-600">{c.prescription || "—"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-[1.12] flex-col overflow-hidden rounded-md border border-slate-200 bg-slate-50/80 p-1">
          <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
            <input
              ref={scanInputRef}
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleScan();
              }}
              placeholder={labels.medicineScanPlaceholder}
              className={`${railInputClass} font-semibold`}
            />
            <button type="button" onClick={handleScan} className="app-btn-primary w-full py-1 text-[10px] hover:bg-brand-900 sm:text-xs">
              {labels.medicineScanButton}
            </button>
            <input
              value={medicineSearch}
              onChange={(e) => setMedicineSearch(e.target.value)}
              placeholder={labels.medicineSearchPlaceholder}
              className={railInputClass}
            />
            {showMedicineResults && (
              <div className="rounded border border-slate-300 bg-white">
                <p className="border-b border-slate-100 px-1 py-0.5 text-[8px] font-semibold uppercase text-slate-600">
                  {labels.medicineSearchResultsHeading}
                </p>
                <div className="max-h-32 overflow-y-auto">
                  {medicineResultRows.length === 0 ? (
                    <p className="px-1 py-1 text-[10px] text-slate-500">{labels.noMatchingMedicines}</p>
                  ) : (
                    medicineResultRows.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => addMedicineToCart(m)}
                        className="flex w-full items-start justify-between gap-0.5 border-b border-slate-100 px-1 py-1 text-left text-[10px] last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="min-w-0 flex-1 break-words leading-tight">{m.name}</span>
                        <span className="shrink-0 text-[9px] text-slate-500">{getUnitPrice(m).toFixed(0)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            {!showMedicineResults && hasMoreProducts ? (
              <button type="button" onClick={onLoadMoreProducts} disabled={catalogLoadingMore} className={railBtnClass}>
                {catalogLoadingMore ? "…" : labels.loadMoreMedicines}
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Middle column: remaining width after ~20% rail + ~25% payment */}
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 sm:p-3">
        <section className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80 p-2 sm:max-h-[min(32vh,260px)]">
          <h2 className="mb-2 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-600">{CLINIC_POS_LEFT_SECTIONS.quickAddMedicines}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {quickPickMedicines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addMedicineToCart(m)}
                  className="truncate rounded-lg border border-slate-300 px-2 py-2 text-left text-xs hover:bg-slate-50"
                >
                  <span className="block truncate font-medium text-slate-900">{m.name}</span>
                  <span className="block text-[11px] text-slate-500">{getUnitPrice(m).toFixed(0)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 sm:p-3">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-base font-semibold text-emerald-950 sm:text-lg">{labels.dispensingCartSummary}</p>
            <span className="text-xs text-emerald-800">
              {cart.length} medicine{cart.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-emerald-100 bg-white">
            {cart.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">{labels.emptyDispensing}</p>
            ) : (
              cart.map((item) => {
                const catalogUnit = getUnitPrice(item.product, item.quantity);
                return (
                <div
                  key={item.product.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(3.25rem,4rem)_minmax(3.25rem,4rem)_auto] items-center gap-2 border-b border-slate-100 px-2 py-2 last:border-b-0 sm:grid-cols-[1fr_4.5rem_4.5rem_auto] sm:px-4 sm:py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                      {item.product.name} ×{item.quantity}
                    </p>
                  </div>
                  <DispensingLineUnitPriceInput
                    productId={item.product.id}
                    quantity={item.quantity}
                    catalogUnit={catalogUnit}
                    unitPriceOverride={item.unitPriceOverride}
                    setLineUnitPrice={setLineUnitPrice}
                    ariaLabel={`Sales price per unit for ${item.product.name}`}
                  />
                  <span className="text-right text-sm font-bold text-slate-900 sm:text-base">{item.lineTotal.toFixed(0)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateQty(item.product.id, item.quantity - 1)}
                      className="h-8 w-8 rounded border border-slate-300 text-base font-bold text-slate-800 hover:bg-slate-100 sm:h-9 sm:w-9"
                      aria-label={`Decrease ${item.product.name}`}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => updateQty(item.product.id, item.quantity + 1)}
                      className="h-8 w-8 rounded border border-slate-300 text-base font-bold text-slate-800 hover:bg-slate-100 sm:h-9 sm:w-9"
                      aria-label={`Increase ${item.product.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
