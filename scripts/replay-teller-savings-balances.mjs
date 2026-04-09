/**
 * Replays posted teller transactions into sacco_member_savings_accounts.balance
 * for a date range (same rules as src/lib/saccoTellerDb.ts — keep deltas in sync).
 *
 * Run from project root:
 *   node scripts/replay-teller-savings-balances.mjs --org=<uuid> --from=2026-01-01 --to=2026-03-24
 *
 * Env (loads .env from project root if present):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (recommended for updates; bypasses RLS)
 *   or VITE_SUPABASE_ANON_KEY   (may fail if RLS blocks updates)
 *
 * Flags:
 *   --dry-run          Print planned deltas; no DB writes
 *   --reverse-first    For each affected account, subtract the sum of deltas in
 *                      this range from current balance, then apply txns in order.
 *                      Use before re-running the same range (avoids double-counting
 *                      if those movements were already applied once).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  env.split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  });
}

/** Mirror of saccoTellerDb.tellerDeltaForSavingsAccountBalance */
function tellerDeltaForSavingsAccountBalance(txnType, amount) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0) return null;
  switch (String(txnType)) {
    case "cash_deposit":
    case "cheque_received":
    case "cheque_clearing":
      return a;
    case "cash_withdrawal":
    case "cheque_paid":
      return -a;
    case "adjustment":
      return a;
    default:
      return null;
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, reverseFirst: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reverse-first") out.reverseFirst = true;
    else if (a.startsWith("--org=")) out.organizationId = a.slice(6).trim();
    else if (a.startsWith("--from=")) out.fromRaw = a.slice(7).trim();
    else if (a.startsWith("--to=")) out.toRaw = a.slice(5).trim();
  }
  return out;
}

/** YYYY-MM-DD → day bounds UTC; otherwise Date.parse */
function toRangeIso(fromRaw, toRaw) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  let fromIso;
  let toIso;
  if (dateOnly.test(fromRaw)) {
    fromIso = `${fromRaw}T00:00:00.000Z`;
  } else {
    const d = new Date(fromRaw);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid --from: ${fromRaw}`);
    fromIso = d.toISOString();
  }
  if (dateOnly.test(toRaw)) {
    toIso = `${toRaw}T23:59:59.999Z`;
  } else {
    const d = new Date(toRaw);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid --to: ${toRaw}`);
    toIso = d.toISOString();
  }
  return { fromIso, toIso };
}

async function fetchPostedTxnsInRange(sb, organizationId, fromIso, toIso) {
  const pageSize = 500;
  const all = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await sb
      .from("sacco_teller_transactions")
      .select("id, created_at, txn_type, amount, sacco_member_savings_account_id, status")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .not("sacco_member_savings_account_id", "is", null)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function aggregateDeltasByAccount(rows) {
  const map = new Map();
  for (const t of rows) {
    const acctId = t.sacco_member_savings_account_id;
    if (!acctId) continue;
    const d = tellerDeltaForSavingsAccountBalance(t.txn_type, t.amount);
    if (d === null || d === 0) continue;
    map.set(acctId, (map.get(acctId) ?? 0) + d);
  }
  return map;
}

async function applyReverseFirst(sb, organizationId, byAccount, dryRun) {
  for (const [acctId, totalDelta] of byAccount) {
    const { data: acct, error: e1 } = await sb
      .from("sacco_member_savings_accounts")
      .select("balance")
      .eq("id", acctId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (e1) throw e1;
    if (!acct) {
      console.warn(`[reverse-first] Account not found, skip: ${acctId}`);
      continue;
    }
    const prev = Number(acct.balance ?? 0);
    const next = Math.max(0, prev - totalDelta);
    console.log(`[reverse-first] ${acctId}: balance ${prev} → ${next} (subtract ${totalDelta})`);
    if (!dryRun) {
      const { error: e2 } = await sb
        .from("sacco_member_savings_accounts")
        .update({ balance: next })
        .eq("id", acctId)
        .eq("organization_id", organizationId);
      if (e2) throw e2;
    }
  }
}

async function applyOneTxn(sb, organizationId, txn, dryRun) {
  const acctId = txn.sacco_member_savings_account_id;
  if (!acctId) return { skipped: true };
  const delta = tellerDeltaForSavingsAccountBalance(txn.txn_type, txn.amount);
  if (delta === null || delta === 0) return { skipped: true, reason: "no_delta" };

  const { data: acct, error: e1 } = await sb
    .from("sacco_member_savings_accounts")
    .select("balance")
    .eq("id", acctId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (e1) throw e1;
  if (!acct) {
    console.warn(`[apply] Account not found for txn ${txn.id}: ${acctId}`);
    return { skipped: true, reason: "no_account" };
  }
  const prev = Number(acct.balance ?? 0);
  const next = Math.max(0, prev + delta);
  if (dryRun) {
    console.log(
      `[dry-run] ${txn.created_at} ${txn.id} ${acctId} ${txn.txn_type} amt=${txn.amount} → delta=${delta} balance ${prev} → ${next}`
    );
    return { applied: true, dryRun: true };
  }
  const { error: e2 } = await sb
    .from("sacco_member_savings_accounts")
    .update({ balance: next })
    .eq("id", acctId)
    .eq("organization_id", organizationId);
  if (e2) throw e2;
  return { applied: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.organizationId || !args.fromRaw || !args.toRaw) {
    console.error(`Usage:
  node scripts/replay-teller-savings-balances.mjs --org=<organization_id> --from=<YYYY-MM-DD|ISO> --to=<YYYY-MM-DD|ISO> [--dry-run] [--reverse-first]

Examples:
  node scripts/replay-teller-savings-balances.mjs --org=00000000-0000-0000-0000-000000000001 --from=2026-01-01 --to=2026-03-24 --dry-run
`);
    process.exit(1);
  }

  const { fromIso, toIso } = toRangeIso(args.fromRaw, args.toRaw);
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY");
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[replay] Using VITE_SUPABASE_ANON_KEY — prefer SUPABASE_SERVICE_ROLE_KEY for unrestricted updates.");
  }

  const sb = createClient(url, key);
  const orgId = args.organizationId;

  console.log(`[replay] org=${orgId}`);
  console.log(`[replay] created_at range: ${fromIso} … ${toIso}`);
  console.log(`[replay] dry-run=${args.dryRun} reverse-first=${args.reverseFirst}`);

  const rows = await fetchPostedTxnsInRange(sb, orgId, fromIso, toIso);
  const affecting = rows.filter((t) => {
    const d = tellerDeltaForSavingsAccountBalance(t.txn_type, t.amount);
    return d !== null && d !== 0;
  });

  console.log(`[replay] posted txns with savings account in range: ${rows.length} (balance-affecting: ${affecting.length})`);

  if (affecting.length === 0) {
    console.log("[replay] Nothing to do.");
    return;
  }

  if (args.reverseFirst) {
    const byAccount = aggregateDeltasByAccount(affecting);
    console.log(`[reverse-first] ${byAccount.size} account(s) with aggregated deltas in range`);
    await applyReverseFirst(sb, orgId, byAccount, args.dryRun);
  }

  let applied = 0;
  let skipped = 0;
  for (const txn of affecting) {
    const r = await applyOneTxn(sb, orgId, txn, args.dryRun);
    if (r.skipped) skipped += 1;
    else applied += 1;
  }

  console.log(`[replay] done. applied=${applied} skipped=${skipped}${args.dryRun ? " (dry-run)" : ""}`);
}

main().catch((err) => {
  console.error("[replay] Fatal:", err?.message ?? err);
  process.exit(1);
});
