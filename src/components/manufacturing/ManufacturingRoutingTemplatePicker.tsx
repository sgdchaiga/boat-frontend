import { useState } from "react";
import { supabase } from "../../lib/supabase";

const templates = [
  { id: "milling", name: "Grain milling", steps: ["Receive and inspect grain", "Clean and sort", "Mill", "Sieve and grade", "Weigh and pack"] },
  { id: "bakery", name: "Bakery", steps: ["Weigh ingredients", "Mix", "Form and prepare", "Bake", "Cool and inspect", "Pack"] },
  { id: "metal", name: "Metal fabrication", steps: ["Inspect material", "Measure and cut", "Form and assemble", "Finish", "Inspect finished work"] },
];
type DraftStep = { name: string; centerId: string; minutes: string };

export function ManufacturingRoutingTemplatePicker({ bomId, organizationId, centers, disabled, onApplied }: {
  bomId: string; organizationId: string | null; centers: Array<{ id: string; name: string }>;
  disabled: boolean; onApplied: () => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const apply = async () => {
    if (disabled || busy || !bomId || !organizationId || !steps.length) return;
    if (steps.some((step) => !step.name.trim() || !step.minutes.trim() || !Number.isFinite(Number(step.minutes)) || Number(step.minutes) < 0)) {
      setMessage("Every step needs a name and a planned time of zero or more minutes."); return;
    }
    setBusy(true); setMessage("");
    try {
      const { error } = await supabase.from("manufacturing_routing_operations").insert(steps.map((step, index) => ({
        organization_id: organizationId, bom_id: bomId, sequence_no: index + 1,
        operation_name: step.name.trim(), work_center_id: step.centerId || null,
        planned_minutes: Number(step.minutes), instructions: null,
      })));
      if (error) throw error;
      setSteps([]); setTemplateId(""); setMessage("Starter routing saved.");
      await onApplied();
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error ? String(error.message) : "Could not save the starter routing.");
    } finally { setBusy(false); }
  };
  return <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
    <h3 className="text-sm font-semibold">Start with an industry routing</h3>
    <p className="mt-1 text-xs text-slate-600">For a BOM with no routing yet. Review the stages, work centres and planned minutes for your process before saving. Times start at zero until you enter an estimate.</p>
    <select aria-label="Industry routing" disabled={disabled || busy} value={templateId} onChange={(event) => {
      const id = event.target.value; setTemplateId(id); setMessage("");
      setSteps((templates.find((template) => template.id === id)?.steps || []).map((name) => ({ name, centerId: "", minutes: "0" })));
    }} className="mt-2 min-h-11 w-full rounded border bg-white px-3 py-2 text-sm disabled:opacity-50">
      <option value="">Choose a starter routing...</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
    </select>
    {steps.length > 0 && <div className="mt-3 space-y-3">{steps.map((step, index) => <div key={index} className="grid gap-2 rounded border bg-white p-3 md:grid-cols-3">
      <label className="text-xs">Step {index + 1}<input value={step.name} disabled={disabled || busy} onChange={(event) => setSteps((current) => current.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} className="mt-1 min-h-11 w-full rounded border px-2 text-sm" /></label>
      <label className="text-xs">Work centre<select value={step.centerId} disabled={disabled || busy} onChange={(event) => setSteps((current) => current.map((row, i) => i === index ? { ...row, centerId: event.target.value } : row))} className="mt-1 min-h-11 w-full rounded border px-2 text-sm"><option value="">No work centre</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="text-xs">Planned minutes<input type="number" min="0" step="0.01" value={step.minutes} disabled={disabled || busy} onChange={(event) => setSteps((current) => current.map((row, i) => i === index ? { ...row, minutes: event.target.value } : row))} className="mt-1 min-h-11 w-full rounded border px-2 text-sm" /></label>
    </div>)}<button type="button" disabled={disabled || busy || !organizationId} onClick={() => void apply()} className="app-btn-primary min-h-11 disabled:opacity-50">{busy ? "Saving..." : "Save starter routing"}</button></div>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
