import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { buildWalletAutoReference } from "@/lib/autoReference";
import { randomUuid } from "@/lib/randomUuid";

type WalletCustomerKind = "hotel" | "retail" | "student";

type WalletRow = {
  id: string;
  wallet_number: string;
  kyc_level: string;
  status: string;
  customer_kind: WalletCustomerKind;
  hotel_customer_id: string | null;
  retail_customer_id: string | null;
  student_id: string | null;
};
type BalanceRow = { current_balance: number };
type LimitRow = {
  max_balance: number | null;
  max_txn_amount: number | null;
  daily_limit: number | null;
  monthly_limit: number | null;
};
type TxRow = {
  id: string;
  created_at: string;
  txn_type: string;
  amount: number;
  direction: string;
  status: string;
  reference: string | null;
  narration: string | null;
  auto_post_status: string | null;
  journal_entry_id: string | null;
};
type HotelCust = { id: string; first_name: string; last_name: string; email: string | null };
type RetailCust = { id: string; name: string; email: string | null };
type StudentRow = { id: string; first_name: string; last_name: string; admission_number: string; class_name: string };

type PendingTx = {
  txKind: "deposit" | "withdrawal" | "transfer";
  amount: string;
  customer_kind: WalletCustomerKind;
  customer_id: string;
  to_ref?: string;
  narration: string;
  queued_at: string;
};

const PENDING_KEY = "boat_wallet_pending_tx";

const WALLET_SELECT =
  "id,wallet_number,kyc_level,status,customer_kind,hotel_customer_id,retail_customer_id,student_id";

function customerLabel(
  kind: WalletCustomerKind,
  h?: HotelCust | null,
  r?: RetailCust | null,
  s?: StudentRow | null
): string {
  if (kind === "hotel" && h) return `${h.first_name} ${h.last_name}`.trim() || h.id;
  if (kind === "retail" && r) return r.name || r.id;
  if (kind === "student" && s) {
    const n = `${s.first_name} ${s.last_name}`.trim();
    return `${n} (${s.admission_number})`;
  }
  return "—";
}

function encodeRecipientRef(kind: WalletCustomerKind, id: string): string {
  return `${kind}:${id}`;
}

function parseRecipientRef(raw: string): { kind: WalletCustomerKind; id: string } | null {
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const kind = raw.slice(0, i) as WalletCustomerKind;
  const id = raw.slice(i + 1);
  if (!id || (kind !== "hotel" && kind !== "retail" && kind !== "student")) return null;
  return { kind, id };
}

type Props = { readOnly?: boolean };

export function WalletPage({ readOnly }: Props) {
  const { user, isSuperAdmin } = useAuth();
  const isSchool = user?.business_type === "school";
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [balance, setBalance] = useState(0);
  const [limits, setLimits] = useState<LimitRow | null>(null);
  const [tx, setTx] = useState<TxRow[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<HotelCust[]>([]);
  const [retailCustomers, setRetailCustomers] = useState<RetailCust[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ctx, setCtx] = useState<{ customer_kind: WalletCustomerKind; customer_id: string }>({
    customer_kind: "retail",
    customer_id: "",
  });
  const [form, setForm] = useState({
    txKind: "deposit" as "deposit" | "withdrawal" | "transfer",
    amount: "",
    to_recipient: "",
    narration: "",
  });

  const walletRefNote =
    "Reference is auto-generated: 02-YYYYMMDD-NNN (page 02 · UTC date · Nth wallet transaction that day for your organization).";

  const selectedHotel = useMemo(
    () => hotelCustomers.find((c) => c.id === ctx.customer_id),
    [hotelCustomers, ctx.customer_id, ctx.customer_kind]
  );
  const selectedRetail = useMemo(
    () => retailCustomers.find((c) => c.id === ctx.customer_id),
    [retailCustomers, ctx.customer_id, ctx.customer_kind]
  );
  const selectedStudent = useMemo(
    () => students.find((c) => c.id === ctx.customer_id),
    [students, ctx.customer_id, ctx.customer_kind]
  );

  const pendingCount = useMemo(() => {
    if (typeof window === "undefined") return 0;
    try {
      const items = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "[]") as PendingTx[];
      return items.length;
    } catch {
      return 0;
    }
  }, [tx.length, syncing]);

  const ensureWallet = useCallback(
    async (kind: WalletCustomerKind, customerId: string) => {
      const orgId = user?.organization_id;
      if (!orgId || !customerId) return { data: null as WalletRow | null, error: "Missing org or customer." };

      if (kind === "student") {
        const existing = await supabase
          .from("wallets")
          .select(WALLET_SELECT)
          .eq("organization_id", orgId)
          .eq("student_id", customerId)
          .maybeSingle();
        if (existing.error) return { data: null, error: existing.error.message };
        if (existing.data) return { data: existing.data as WalletRow, error: null as string | null };
        const created = await supabase
          .from("wallets")
          .insert({
            organization_id: orgId,
            customer_kind: "student",
            student_id: customerId,
            wallet_number: `W-S-${customerId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
          })
          .select(WALLET_SELECT)
          .single();
        if (created.error) return { data: null, error: created.error.message };
        return { data: created.data as WalletRow, error: null };
      }

      const sel =
        kind === "hotel"
          ? supabase
              .from("wallets")
              .select(WALLET_SELECT)
              .eq("organization_id", orgId)
              .eq("hotel_customer_id", customerId)
              .maybeSingle()
          : supabase
              .from("wallets")
              .select(WALLET_SELECT)
              .eq("organization_id", orgId)
              .eq("retail_customer_id", customerId)
              .maybeSingle();
      const existing = await sel;
      if (existing.error) return { data: null, error: existing.error.message };
      if (existing.data) return { data: existing.data as WalletRow, error: null as string | null };

      const insert =
        kind === "hotel"
          ? {
              organization_id: orgId,
              customer_kind: "hotel" as const,
              hotel_customer_id: customerId,
              wallet_number: `W-H-${customerId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
            }
          : {
              organization_id: orgId,
              customer_kind: "retail" as const,
              retail_customer_id: customerId,
              wallet_number: `W-R-${customerId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
            };
      const created = await supabase.from("wallets").insert(insert).select(WALLET_SELECT).single();
      if (created.error) return { data: null, error: created.error.message };
      return { data: created.data as WalletRow, error: null };
    },
    [user?.organization_id]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    const staffId = user?.id;
    if (!orgId || !staffId) {
      setLoading(false);
      return;
    }

    if (user?.business_type === "school") {
      const sRes = await supabase
        .from("students")
        .select("id,first_name,last_name,admission_number,class_name")
        .eq("organization_id", orgId)
        .order("last_name")
        .order("first_name");
      const listErr = sRes.error?.message ?? null;
      const list = (sRes.data as StudentRow[]) || [];
      setStudents(list);
      setHotelCustomers([]);
      setRetailCustomers([]);

      let kind: WalletCustomerKind = "student";
      let cid = ctx.customer_id;
      const studentOk = Boolean(cid && list.some((s) => s.id === cid));
      if (!cid || !studentOk) {
        cid = list[0]?.id ?? "";
      }

      if (!cid) {
        setErr(listErr);
        setWallet(null);
        setBalance(0);
        setLimits(null);
        setTx([]);
        setLoading(false);
        return;
      }

      const ensured = await ensureWallet(kind, cid);
      if (ensured.error || !ensured.data) {
        setErr(listErr ?? ensured.error);
        setWallet(null);
        setLoading(false);
        return;
      }
      const w = ensured.data;
      setWallet(w);
      setCtx((prev) =>
        prev.customer_id === cid && prev.customer_kind === kind ? prev : { customer_kind: kind, customer_id: cid }
      );

      const [bRes, lRes, tRes] = await Promise.all([
        supabase.from("wallet_balances").select("current_balance").eq("wallet_id", w.id).maybeSingle(),
        supabase.from("wallet_limits").select("max_balance,max_txn_amount,daily_limit,monthly_limit").eq("wallet_id", w.id).maybeSingle(),
        supabase
          .from("wallet_transactions")
          .select("id,created_at,txn_type,amount,direction,status,reference,narration,auto_post_status,journal_entry_id")
          .eq("wallet_id", w.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      setErr(bRes.error?.message || lRes.error?.message || tRes.error?.message || listErr);
      setBalance(Number((bRes.data as BalanceRow | null)?.current_balance ?? 0));
      setLimits((lRes.data as LimitRow | null) ?? null);
      setTx((tRes.data as TxRow[]) || []);
      setLoading(false);
      return;
    }

    const [hRes, rRes] = await Promise.all([
      filterByOrganizationId(
        supabase.from("hotel_customers").select("id,first_name,last_name,email").order("last_name").order("first_name"),
        orgId,
        isSuperAdmin
      ),
      filterByOrganizationId(supabase.from("retail_customers").select("id,name,email").order("name"), orgId, isSuperAdmin),
    ]);
    const listErr = hRes.error?.message ?? rRes.error?.message ?? null;
    const hotels = (hRes.data as HotelCust[]) || [];
    const retails = (rRes.data as RetailCust[]) || [];
    setHotelCustomers(hotels);
    setRetailCustomers(retails);
    setStudents([]);

    let kind: WalletCustomerKind = ctx.customer_kind === "student" ? "retail" : ctx.customer_kind;
    let cid = ctx.customer_id;
    const retailOk = Boolean(cid && kind === "retail" && retails.some((c) => c.id === cid));
    const hotelOk = Boolean(cid && kind === "hotel" && hotels.some((c) => c.id === cid));
    if (!cid || (!retailOk && !hotelOk)) {
      if (retails.length > 0) {
        kind = "retail";
        cid = retails[0].id;
      } else if (hotels.length > 0) {
        kind = "hotel";
        cid = hotels[0].id;
      } else {
        setErr(listErr);
        setWallet(null);
        setBalance(0);
        setLimits(null);
        setTx([]);
        setLoading(false);
        return;
      }
    } else if (kind === "retail" && !retails.some((c) => c.id === cid) && retails[0]) {
      cid = retails[0].id;
    } else if (kind === "hotel" && !hotels.some((c) => c.id === cid) && hotels[0]) {
      cid = hotels[0].id;
    }

    const ensured = await ensureWallet(kind, cid);
    if (ensured.error || !ensured.data) {
      setErr(listErr ?? ensured.error);
      setWallet(null);
      setLoading(false);
      return;
    }
    const w = ensured.data;
    setWallet(w);
    setCtx((prev) =>
      prev.customer_id === cid && prev.customer_kind === kind ? prev : { customer_kind: kind, customer_id: cid }
    );

    const [bRes, lRes, tRes] = await Promise.all([
      supabase.from("wallet_balances").select("current_balance").eq("wallet_id", w.id).maybeSingle(),
      supabase.from("wallet_limits").select("max_balance,max_txn_amount,daily_limit,monthly_limit").eq("wallet_id", w.id).maybeSingle(),
      supabase
        .from("wallet_transactions")
        .select("id,created_at,txn_type,amount,direction,status,reference,narration,auto_post_status,journal_entry_id")
        .eq("wallet_id", w.id)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setErr(bRes.error?.message || lRes.error?.message || tRes.error?.message || listErr);
    setBalance(Number((bRes.data as BalanceRow | null)?.current_balance ?? 0));
    setLimits((lRes.data as LimitRow | null) ?? null);
    setTx((tRes.data as TxRow[]) || []);
    setLoading(false);
  }, [user?.organization_id, user?.id, user?.business_type, isSuperAdmin, ctx.customer_id, ctx.customer_kind, ensureWallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const queueOffline = (item: PendingTx) => {
    if (typeof window === "undefined") return;
    const list = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "[]") as PendingTx[];
    list.push(item);
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  };

  const post = async (payload: {
    walletId: string;
    txKind: "deposit" | "withdrawal" | "transfer";
    amount: number;
    toRecipientRef?: string;
    narration: string;
  }) => {
    if (!user?.id) return { ok: false as const, message: "Not signed in." };
    const orgId = user.organization_id;
    if (!orgId) return { ok: false as const, message: "No organization." };
    let autoRef: string;
    try {
      autoRef = await buildWalletAutoReference(supabase, orgId);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Could not generate reference." };
    }
    let counterparty_wallet_id: string | null = null;
    if (payload.txKind === "transfer") {
      const ref = payload.toRecipientRef ? parseRecipientRef(payload.toRecipientRef) : null;
      if (!ref) return { ok: false as const, message: "Select recipient customer." };
      const toW = await ensureWallet(ref.kind, ref.id);
      if (toW.error || !toW.data) return { ok: false as const, message: toW.error || "Recipient wallet missing." };
      if (toW.data.id === payload.walletId) return { ok: false as const, message: "Cannot transfer to the same wallet." };
      counterparty_wallet_id = toW.data.id;
    }
    const rpc = await supabase.rpc("wallet_post_transaction", {
      p_wallet_id: payload.walletId,
      p_txn_type: payload.txKind,
      p_amount: payload.amount,
      p_counterparty_wallet_id: counterparty_wallet_id,
      p_reference: autoRef,
      p_narration: payload.narration || null,
      p_created_by: user.id,
      p_idempotency_key: randomUuid(),
      p_metadata: {},
    });
    if (rpc.error) return { ok: false as const, message: rpc.error.message };
    return { ok: true as const };
  };

  const submit = async () => {
    if (readOnly) return;
    if (!wallet) {
      setErr("Select a customer with a wallet.");
      return;
    }
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setErr("Amount must be positive.");
      return;
    }
    setErr(null);
    const res = await post({
      walletId: wallet.id,
      txKind: form.txKind,
      amount,
      toRecipientRef: form.txKind === "transfer" ? form.to_recipient : undefined,
      narration: form.narration,
    });
    if (!res.ok) {
      queueOffline({
        txKind: form.txKind,
        amount: form.amount,
        customer_kind: ctx.customer_kind,
        customer_id: ctx.customer_id,
        to_ref: form.txKind === "transfer" ? form.to_recipient : undefined,
        narration: form.narration,
        queued_at: new Date().toISOString(),
      });
      setErr(`${res.message} Saved offline; will sync later.`);
      return;
    }
    setForm({ txKind: "deposit", amount: "", to_recipient: "", narration: "" });
    void load();
  };

  const syncPending = async () => {
    if (typeof window === "undefined" || !user?.organization_id) return;
    setSyncing(true);
    const list = JSON.parse(window.localStorage.getItem(PENDING_KEY) || "[]") as PendingTx[];
    const remain: PendingTx[] = [];
    for (const p of list) {
      const amount = Number(p.amount);
      if (!(amount > 0)) continue;
      const w = await ensureWallet(p.customer_kind, p.customer_id);
      if (w.error || !w.data) {
        remain.push(p);
        continue;
      }
      const res = await post({
        walletId: w.data.id,
        txKind: p.txKind,
        amount,
        toRecipientRef: p.to_ref,
        narration: p.narration,
      });
      if (!res.ok) remain.push(p);
    }
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(remain));
    setSyncing(false);
    void load();
  };

  const recipientOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (isSchool) {
      for (const s of students) {
        if (s.id === ctx.customer_id) continue;
        opts.push({
          value: encodeRecipientRef("student", s.id),
          label: `Student: ${`${s.first_name} ${s.last_name}`.trim()} (${s.admission_number})`,
        });
      }
      return opts;
    }
    for (const c of retailCustomers) {
      if (ctx.customer_kind === "retail" && c.id === ctx.customer_id) continue;
      opts.push({ value: encodeRecipientRef("retail", c.id), label: `Retail: ${c.name}` });
    }
    for (const c of hotelCustomers) {
      if (ctx.customer_kind === "hotel" && c.id === ctx.customer_id) continue;
      opts.push({
        value: encodeRecipientRef("hotel", c.id),
        label: `Hotel: ${`${c.first_name} ${c.last_name}`.trim()}`,
      });
    }
    return opts;
  }, [isSchool, students, hotelCustomers, retailCustomers, ctx.customer_id, ctx.customer_kind]);

  const todayTotal = useMemo(
    () =>
      tx
        .filter((r) => new Date(r.created_at).toDateString() === new Date().toDateString())
        .reduce((s, r) => s + Number(r.amount || 0), 0),
    [tx]
  );

  const customerDisplayName =
    wallet == null
      ? "—"
      : customerLabel(wallet.customer_kind, selectedHotel, selectedRetail, selectedStudent);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Wallet</h1>
        <PageNotes ariaLabel="Wallet module">
          <p>
            {isSchool ? (
              <>
                For schools, each wallet is linked to a student. Deposits and withdrawals post to your wallet liability and clearing accounts
                under Admin → Journal account settings (Wallet group). Transfers move balance between student wallets.
              </>
            ) : (
              <>
                Each wallet belongs to a hotel or retail customer. Deposits and withdrawals post to your wallet liability and clearing accounts
                set under Admin → Journal account settings (Wallet group). Transfers move balance between customer wallets (liability to liability).
              </>
            )}
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {isSchool ? (
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-3"
            value={ctx.customer_id}
            onChange={(e) => setCtx({ customer_kind: "student", customer_id: e.target.value })}
          >
            <option value="">Select student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.first_name} ${s.last_name}`.trim()} · {s.admission_number} · {s.class_name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={ctx.customer_kind === "student" ? "retail" : ctx.customer_kind}
              onChange={(e) => {
                const customer_kind = e.target.value as "hotel" | "retail";
                const first =
                  customer_kind === "hotel" ? hotelCustomers[0]?.id ?? "" : retailCustomers[0]?.id ?? "";
                setCtx({ customer_kind, customer_id: first });
              }}
            >
              <option value="retail">Retail customer</option>
              <option value="hotel">Hotel / property customer</option>
            </select>
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
              value={ctx.customer_id}
              onChange={(e) => setCtx((c) => ({ ...c, customer_id: e.target.value }))}
            >
              <option value="">Select customer</option>
              {ctx.customer_kind === "hotel"
                ? hotelCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${c.first_name} ${c.last_name}`.trim()}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))
                : retailCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))}
            </select>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : !ctx.customer_id ? (
        <p className="text-slate-600">
          {isSchool ? "Add students in the School module to open wallets." : "Add customers (hotel or retail) to open wallets."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{isSchool ? "Student" : "Customer"}</p>
              <p className="font-medium text-slate-900 truncate">{customerDisplayName}</p>
              <p className="text-xs font-mono text-slate-500 mt-1">{wallet?.wallet_number}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Balance</p>
              <p className="text-xl font-semibold">{balance.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">KYC level</p>
              <p>{wallet?.kyc_level}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Today total</p>
              <p>{todayTotal.toLocaleString()}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={form.txKind}
              onChange={(e) => setForm((f) => ({ ...f, txKind: e.target.value as typeof f.txKind }))}
            >
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="transfer">Transfer</option>
            </select>
            {form.txKind === "transfer" ? (
              <select
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={form.to_recipient}
                onChange={(e) => setForm((f) => ({ ...f, to_recipient: e.target.value }))}
              >
                <option value="">{isSchool ? "Recipient student" : "Recipient customer"}</option>
                {recipientOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <div />
            )}
            <input
              type="number"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Amount"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <div />
            <p className="md:col-span-2 text-xs text-slate-600">{walletRefNote}</p>
            <input
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
              placeholder="Narration"
              value={form.narration}
              onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))}
            />
            <div className="md:col-span-2 flex gap-2">
              <button
                type="button"
                onClick={submit}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-60"
                disabled={readOnly}
              >
                Post transaction
              </button>
              <button
                type="button"
                onClick={() => void syncPending()}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm"
                disabled={syncing}
              >
                {syncing ? "Syncing..." : `Sync offline (${pendingCount})`}
              </button>
            </div>
            <p className="md:col-span-2 text-xs text-slate-600">
              Limits: txn {limits?.max_txn_amount?.toLocaleString() ?? "—"} · daily {limits?.daily_limit?.toLocaleString() ?? "—"} · monthly{" "}
              {limits?.monthly_limit?.toLocaleString() ?? "—"} · max balance {limits?.max_balance?.toLocaleString() ?? "—"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">GL post</th>
                  <th className="text-left p-3">Journal</th>
                  <th className="text-left p-3">Reference</th>
                </tr>
              </thead>
              <tbody>
                {tx.length === 0 ? (
                  <tr>
                    <td className="p-6 text-slate-500" colSpan={7}>
                      No wallet transactions yet.
                    </td>
                  </tr>
                ) : (
                  tx.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="p-3">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-3 capitalize">{r.txn_type}</td>
                      <td className="p-3 text-right">{Number(r.amount).toLocaleString()}</td>
                      <td className="p-3">{r.status}</td>
                      <td className="p-3">{r.auto_post_status ?? "queued"}</td>
                      <td className="p-3 font-mono text-xs">{r.journal_entry_id ? r.journal_entry_id.slice(0, 8) + "…" : "—"}</td>
                      <td className="p-3">{r.reference ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
