import { useCallback, useEffect, useState } from "react";
import { Trash2, UserCog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";

type Row = { user_id: string; label: string | null; created_at: string };

export function PlatformSuperUsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("platform_admins")
      .select("user_id,label,created_at")
      .order("created_at");
    if (!error) setRows((data as Row[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addAdmin = async () => {
    const uid = newId.trim();
    if (!uid || uid.length < 30) {
      setErr("Paste a valid Auth user UUID (Dashboard → Authentication → Users).");
      return;
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("platform_admins").insert({
      user_id: uid,
      label: newLabel.trim() || null,
    });
    if (error) setErr(error.message);
    else {
      setNewId("");
      setNewLabel("");
      load();
    }
    setSaving(false);
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this platform super user? They will lose console access.")) return;
    await supabase.from("platform_admins").delete().eq("user_id", userId);
    load();
  };

  if (loading) return <div className="p-8 text-slate-600">Loading…</div>;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <UserCog className="w-8 h-8 text-slate-800" />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Platform super users</h1>
          <PageNotes ariaLabel="Platform super users help">
            <p>
              Full access to organizations and subscriptions. First user must be added via SQL Editor; then others can be added here.
            </p>
          </PageNotes>
        </div>
      </div>

      <div className="mt-6 bg-brand-950 text-white rounded-xl p-4 text-sm font-mono break-all">
        <p className="text-slate-400 text-xs font-sans mb-2">Bootstrap (run once in Supabase SQL):</p>
        <code className="text-emerald-300">
          INSERT INTO public.platform_admins (user_id, label) VALUES (&apos;YOUR_AUTH_USER_UUID&apos;,
          &apos;Primary&apos;);
        </code>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="font-semibold text-slate-900 mb-3">Add super user</h2>
        {err && <p className="text-red-600 text-sm mb-2">{err}</p>}
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-2 font-mono text-sm"
          placeholder="User UUID from Supabase Auth"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
          placeholder="Label (optional)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <button
          type="button"
          disabled={saving}
          onClick={addAdmin}
          className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add platform admin"}
        </button>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold">User ID</th>
              <th className="text-left p-3 font-semibold">Label</th>
              <th className="text-left p-3 font-semibold">Since</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-b border-slate-100">
                <td className="p-3 font-mono text-xs break-all max-w-xs">{r.user_id}</td>
                <td className="p-3 text-slate-600">{r.label ?? "—"}</td>
                <td className="p-3 text-slate-500">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => remove(r.user_id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-slate-500">No platform admins yet.</p>
        )}
      </div>
    </div>
  );
}
