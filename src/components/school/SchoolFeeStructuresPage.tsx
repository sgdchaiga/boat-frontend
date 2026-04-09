import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type LineItem = { code: string; label: string; amount: number; priority: number };

type FeeRow = {
  id: string;
  class_name: string;
  stream: string | null;
  class_id: string | null;
  stream_id: string | null;
  academic_year: string;
  term_name: string;
  currency: string;
  line_items: LineItem[] | null;
  is_active: boolean;
};

type CatRow = { id: string; name: string };

type FeeEditState = {
  class_id: string;
  stream_id: string;
  class_name: string;
  stream: string;
  academic_year: string;
  term_name: string;
  lines: LineItem[];
  is_active: boolean;
};

const defaultLines = (): LineItem[] => [
  { code: "TUITION", label: "Tuition", amount: 0, priority: 1 },
  { code: "BOARD", label: "Boarding", amount: 0, priority: 2 },
  { code: "MEALS", label: "Meals", amount: 0, priority: 3 },
];

const linesFromRow = (r: FeeRow): LineItem[] => {
  const raw = r.line_items;
  if (!Array.isArray(raw) || raw.length === 0) return defaultLines();
  return raw.map((l) => ({
    code: String(l.code ?? ""),
    label: String(l.label ?? ""),
    amount: Number(l.amount) || 0,
    priority: Math.max(1, Number(l.priority) || 1),
  }));
};

/** Show blank when amount is 0 so the user can type without clearing a leading zero. */
function amountFieldValue(amount: number): string | number {
  return Number(amount) === 0 ? "" : amount;
}

type Props = { readOnly?: boolean };

export function SchoolFeeStructuresPage({ readOnly }: Props) {
  const { user, isSuperAdmin } = useAuth();
  const canEditFeeLines = !readOnly && (user?.role === "admin" || isSuperAdmin);
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [classes, setClasses] = useState<CatRow[]>([]);
  const [streams, setStreams] = useState<CatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    class_id: "",
    stream_id: "",
    class_name: "",
    stream: "",
    academic_year: new Date().getFullYear().toString(),
    term_name: "Term 1",
    lines: defaultLines(),
  });
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editFee, setEditFee] = useState<FeeEditState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    const [fRes, cRes, sRes] = await Promise.all([
      supabase.from("fee_structures").select("*").eq("organization_id", orgId).order("academic_year", { ascending: false }),
      supabase
        .from("classes")
        .select("id,name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("streams")
        .select("id,name")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    setErr(fRes.error?.message || cRes.error?.message || sRes.error?.message || null);
    setRows((fRes.data as FeeRow[]) || []);
    setClasses((cRes.data as CatRow[]) || []);
    setStreams((sRes.data as CatRow[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  const setLine = (index: number, patch: Partial<LineItem>) => {
    setForm((f) => {
      const next = [...f.lines];
      next[index] = { ...next[index], ...patch };
      return { ...f, lines: next };
    });
  };

  const addLine = () => {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { code: "", label: "", amount: 0, priority: f.lines.length + 1 }],
    }));
  };

  const removeLine = (index: number) => {
    if (!canEditFeeLines) return;
    setForm((f) => ({
      ...f,
      lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== index) : f.lines,
    }));
  };

  const editSetLine = (index: number, patch: Partial<LineItem>) => {
    setEditFee((ef) => {
      if (!ef) return ef;
      const next = [...ef.lines];
      next[index] = { ...next[index], ...patch };
      return { ...ef, lines: next };
    });
  };

  const editAddLine = () => {
    setEditFee((ef) =>
      ef ? { ...ef, lines: [...ef.lines, { code: "", label: "", amount: 0, priority: ef.lines.length + 1 }] } : ef
    );
  };

  const editRemoveLine = (index: number) => {
    if (!canEditFeeLines) return;
    setEditFee((ef) => {
      if (!ef) return ef;
      return {
        ...ef,
        lines: ef.lines.length > 1 ? ef.lines.filter((_, i) => i !== index) : ef.lines,
      };
    });
  };

  const buildPayload = (src: typeof form | FeeEditState) => {
    let class_name = src.class_name.trim();
    let stream: string | null = null;
    if (src.class_id) {
      const c = classes.find((x) => x.id === src.class_id);
      if (c) class_name = c.name;
    }
    if (src.stream_id) {
      const s = streams.find((x) => x.id === src.stream_id);
      stream = s ? s.name : null;
    } else if (streams.length === 0) {
      stream = src.stream.trim() || null;
    }
    return { class_name, stream };
  };

  const validateLines = (lines: LineItem[]): { error: string } | { lines: LineItem[] } => {
    const cleaned = lines
      .map((l) => ({
        code: l.code.trim(),
        label: l.label.trim(),
        amount: Number(l.amount) || 0,
        priority: Math.max(1, Number(l.priority) || 1),
      }))
      .filter((l) => l.code || l.label);
    if (cleaned.length === 0) return { error: "Add at least one fee line with a code or label." };
    if (cleaned.some((l) => !l.code || !l.label)) return { error: "Each line needs both a code and a label." };
    return { lines: cleaned };
  };

  const save = async () => {
    if (readOnly) return;
    const { class_name, stream } = buildPayload(form);

    if (classes.length > 0) {
      if (!form.class_id) {
        setErr("Select a class from the catalog.");
        return;
      }
    } else if (!class_name) {
      setErr("Class name, academic year, and term are required.");
      return;
    }

    if (!form.academic_year.trim() || !form.term_name.trim()) {
      setErr("Academic year and term are required.");
      return;
    }
    const vl = validateLines(form.lines);
    if ("error" in vl) {
      setErr(vl.error);
      return;
    }
    setErr(null);
    const { error } = await supabase.from("fee_structures").insert({
      class_id: form.class_id || null,
      stream_id: form.stream_id || null,
      class_name,
      stream,
      academic_year: form.academic_year.trim(),
      term_name: form.term_name.trim(),
      line_items: vl.lines,
    });
    if (error) setErr(error.message);
    else {
      setForm({
        class_id: "",
        stream_id: "",
        class_name: "",
        stream: "",
        academic_year: new Date().getFullYear().toString(),
        term_name: "Term 1",
        lines: defaultLines(),
      });
      load();
    }
  };

  const startEditFee = (r: FeeRow) => {
    setEditingFeeId(r.id);
    setEditFee({
      class_id: r.class_id ?? "",
      stream_id: r.stream_id ?? "",
      class_name: r.class_name,
      stream: r.stream ?? "",
      academic_year: r.academic_year,
      term_name: r.term_name,
      lines: linesFromRow(r),
      is_active: r.is_active,
    });
  };

  const cancelEditFee = () => {
    setEditingFeeId(null);
    setEditFee(null);
  };

  const saveEditFee = async () => {
    if (readOnly || !editingFeeId || !editFee) return;
    const { class_name, stream } = buildPayload(editFee);

    if (classes.length > 0) {
      if (!editFee.class_id) {
        setErr("Select a class from the catalog.");
        return;
      }
    } else if (!class_name) {
      setErr("Class name, academic year, and term are required.");
      return;
    }
    if (!editFee.academic_year.trim() || !editFee.term_name.trim()) {
      setErr("Academic year and term are required.");
      return;
    }
    const vl = validateLines(editFee.lines);
    if ("error" in vl) {
      setErr(vl.error);
      return;
    }
    setErr(null);
    const { error } = await supabase
      .from("fee_structures")
      .update({
        class_id: editFee.class_id || null,
        stream_id: editFee.stream_id || null,
        class_name,
        stream,
        academic_year: editFee.academic_year.trim(),
        term_name: editFee.term_name.trim(),
        line_items: vl.lines,
        is_active: editFee.is_active,
      })
      .eq("id", editingFeeId);
    if (error) setErr(error.message);
    else {
      cancelEditFee();
      load();
    }
  };

  const formatLineItemsPreview = (items: LineItem[] | null) => {
    if (!Array.isArray(items) || items.length === 0) return "—";
    return [...items]
      .sort((a, b) => (Number(a.priority) || 1) - (Number(b.priority) || 1))
      .map((l) => `${l.label || l.code} (P${Math.max(1, Number(l.priority) || 1)}): ${Number(l.amount).toLocaleString()}`)
      .join(" · ");
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Fee structures</h1>
        <PageNotes ariaLabel="Fee structures">
          <p>
            Per class/stream and term. Add fee lines (tuition, boarding, meals, development, etc.) with amounts. These drive totals when generating
            term invoices.
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {classes.length > 0 ? (
              <select
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={form.class_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const c = classes.find((x) => x.id === id);
                  setForm((f) => ({ ...f, class_id: id, class_name: c?.name ?? "" }));
                }}
              >
                <option value="">Select class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Class name"
                value={form.class_name}
                onChange={(e) => setForm((f) => ({ ...f, class_name: e.target.value }))}
              />
            )}
            {streams.length > 0 ? (
              <select
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={form.stream_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const s = streams.find((x) => x.id === id);
                  setForm((f) => ({ ...f, stream_id: id, stream: s?.name ?? "" }));
                }}
              >
                <option value="">Stream (optional)</option>
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Stream (optional)"
                value={form.stream}
                onChange={(e) => setForm((f) => ({ ...f, stream: e.target.value }))}
              />
            )}
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Academic year"
              value={form.academic_year}
              onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
            />
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
              placeholder="Term name"
              value={form.term_name}
              onChange={(e) => setForm((f) => ({ ...f, term_name: e.target.value }))}
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-medium text-slate-800">Fee lines</span>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900"
              >
                <Plus className="w-3.5 h-3.5" />
                Add line
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-slate-700 w-[22%]">Code</th>
                    <th className="text-left p-2 font-semibold text-slate-700 w-[38%]">Description</th>
                    <th className="text-right p-2 font-semibold text-slate-700 w-[16%]">Priority</th>
                    <th className="text-right p-2 font-semibold text-slate-700 w-[22%]">Amount</th>
                    <th className="w-16 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="p-2 align-top">
                        <input
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono"
                          placeholder="e.g. TUITION"
                          value={line.code}
                          onChange={(e) => setLine(i, { code: e.target.value })}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <input
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          placeholder="e.g. Tuition fee"
                          value={line.label}
                          onChange={(e) => setLine(i, { label: e.target.value })}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right"
                          value={line.priority}
                          onChange={(e) => setLine(i, { priority: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right"
                          value={amountFieldValue(line.amount)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLine(i, { amount: v === "" ? 0 : Number(v) });
                          }}
                        />
                      </td>
                      <td className="p-2 align-top text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          disabled={!canEditFeeLines || form.lines.length <= 1}
                          title={!canEditFeeLines ? "Only admin can remove fee lines" : "Remove line"}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800">
            Save structure
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Class</th>
              <th className="text-left p-3 font-semibold text-slate-700">Stream</th>
              <th className="text-left p-3 font-semibold text-slate-700">Year / term</th>
              <th className="text-left p-3 font-semibold text-slate-700">Fee lines</th>
              {!readOnly && <th className="text-right p-3 font-semibold text-slate-700 w-28">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="p-6 text-slate-500">
                  No fee structures yet.
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingFeeId === r.id && editFee ? (
                  <tr key={r.id} className="border-b border-slate-100 bg-indigo-50/40">
                    <td className="p-3" colSpan={readOnly ? 4 : 5}>
                      <div className="space-y-3 max-w-4xl">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {classes.length > 0 ? (
                            <select
                              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                              value={editFee!.class_id}
                              onChange={(e) => {
                                const id = e.target.value;
                                const c = classes.find((x) => x.id === id);
                                setEditFee((ef) => (ef ? { ...ef, class_id: id, class_name: c?.name ?? "" } : ef));
                              }}
                            >
                              <option value="">Select class…</option>
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                              value={editFee!.class_name}
                              onChange={(e) => setEditFee((ef) => (ef ? { ...ef, class_name: e.target.value } : ef))}
                              placeholder="Class name"
                            />
                          )}
                          {streams.length > 0 ? (
                            <select
                              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                              value={editFee!.stream_id}
                              onChange={(e) => {
                                const id = e.target.value;
                                const s = streams.find((x) => x.id === id);
                                setEditFee((ef) => (ef ? { ...ef, stream_id: id, stream: s?.name ?? "" } : ef));
                              }}
                            >
                              <option value="">Stream (optional)</option>
                              {streams.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                              value={editFee!.stream}
                              onChange={(e) => setEditFee((ef) => (ef ? { ...ef, stream: e.target.value } : ef))}
                              placeholder="Stream (optional)"
                            />
                          )}
                          <input
                            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                            value={editFee!.academic_year}
                            onChange={(e) => setEditFee((ef) => (ef ? { ...ef, academic_year: e.target.value } : ef))}
                            placeholder="Academic year"
                          />
                          <input
                            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-2"
                            value={editFee!.term_name}
                            onChange={(e) => setEditFee((ef) => (ef ? { ...ef, term_name: e.target.value } : ef))}
                            placeholder="Term name"
                          />
                          <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-3">
                            <input
                              type="checkbox"
                              checked={editFee!.is_active}
                              onChange={(e) => setEditFee((ef) => (ef ? { ...ef, is_active: e.target.checked } : ef))}
                            />
                            Active (inactive structures are hidden from new invoices)
                          </label>
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-slate-700">Fee lines</span>
                            <button
                              type="button"
                              onClick={editAddLine}
                              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add line
                            </button>
                          </div>
                          <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                  <th className="text-left p-2 font-semibold text-slate-700">Code</th>
                                  <th className="text-left p-2 font-semibold text-slate-700">Description</th>
                                  <th className="text-right p-2 font-semibold text-slate-700">Priority</th>
                                  <th className="text-right p-2 font-semibold text-slate-700">Amount</th>
                                  <th className="w-12 p-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {editFee!.lines.map((line, i) => (
                                  <tr key={i} className="border-b border-slate-100 last:border-0">
                                    <td className="p-1.5">
                                      <input
                                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                                        value={line.code}
                                        onChange={(e) => editSetLine(i, { code: e.target.value })}
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                                        value={line.label}
                                        onChange={(e) => editSetLine(i, { label: e.target.value })}
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right"
                                        value={line.priority}
                                        onChange={(e) => editSetLine(i, { priority: Math.max(1, Number(e.target.value) || 1) })}
                                      />
                                    </td>
                                    <td className="p-1.5">
                                      <input
                                        type="number"
                                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right"
                                        value={amountFieldValue(line.amount)}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          editSetLine(i, { amount: v === "" ? 0 : Number(v) });
                                        }}
                                      />
                                    </td>
                                    <td className="p-1.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => editRemoveLine(i)}
                                        disabled={!canEditFeeLines || editFee!.lines.length <= 1}
                                        title={!canEditFeeLines ? "Only admin can remove fee lines" : "Remove line"}
                                        className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                                        aria-label="Remove line"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={saveEditFee} className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditFee}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 text-slate-900 align-top">
                      {r.class_name}
                      {r.class_id && <span className="ml-1 text-[10px] text-slate-400">· catalog</span>}
                    </td>
                    <td className="p-3 text-slate-600 align-top">{r.stream ?? "—"}</td>
                    <td className="p-3 text-slate-700 align-top whitespace-nowrap">
                      {r.academic_year} · {r.term_name}
                    </td>
                    <td className="p-3 text-slate-700 align-top max-w-md">
                      <span className="text-xs leading-relaxed">{formatLineItemsPreview(r.line_items)}</span>
                      {!r.is_active && <span className="ml-2 text-[10px] text-amber-700 font-medium">Inactive</span>}
                    </td>
                    {!readOnly && (
                      <td className="p-3 text-right align-top">
                        <button
                          type="button"
                          onClick={() => startEditFee(r)}
                          className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
