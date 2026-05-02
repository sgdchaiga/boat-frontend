import type { SupabaseClient } from "@supabase/supabase-js";

export type ClearingRpcResult =
  | { duplicate: true; transaction_id: string }
  | {
      duplicate: false;
      transaction_id: string;
      from_balance_after?: string;
      to_balance_after?: string;
      pool_balance_after?: string;
    };

export type RpcErrorShape = { message?: string; hint?: string; details?: string };

function asResult(raw: unknown): ClearingRpcResult {
  const o = raw as Record<string, unknown>;
  const duplicate = Boolean(o?.duplicate);
  const transaction_id = String(o?.transaction_id ?? "");
  if (!transaction_id) {
    throw new Error("clearing_rpc_missing_transaction_id");
  }
  const base = { duplicate, transaction_id };
  if (duplicate) return base;
  return {
    ...base,
    from_balance_after: o.from_balance_after != null ? String(o.from_balance_after) : undefined,
    to_balance_after: o.to_balance_after != null ? String(o.to_balance_after) : undefined,
    pool_balance_after: o.pool_balance_after != null ? String(o.pool_balance_after) : undefined,
  };
}

export class ClearingEngine {
  constructor(private readonly sb: SupabaseClient) {}

  /** SACCO → SACCO atomic transfer (liquidity + double-entry ledger). */
  async executeInterSaccoTransfer(params: {
    fromSaccoId: string;
    toSaccoId: string;
    amount: number;
    type: string;
    reference: string;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { data, error } = await this.sb.rpc("clearing_execute_inter_sacco_transfer", {
      p_from_sacco: params.fromSaccoId,
      p_to_sacco: params.toSaccoId,
      p_amount: params.amount,
      p_type: params.type,
      p_reference: params.reference,
      p_idempotency_key: params.idempotencyKey ?? null,
      p_metadata: params.metadata ?? {},
    });
    if (error) {
      const e = error as RpcErrorShape;
      throw Object.assign(new Error(e.message ?? "clearing_transfer_failed"), {
        code: "CLEARING_RPC_ERROR",
        hint: e.hint,
        details: e.details,
      });
    }
    return asResult(data);
  }

  /** Book a top-up: debits network pool SACCO, credits destination (bank / MoMo / agent reconciliation). */
  async creditFromPool(params: {
    toSaccoId: string;
    amount: number;
    type: string;
    reference: string;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { data, error } = await this.sb.rpc("clearing_credit_from_pool", {
      p_to_sacco: params.toSaccoId,
      p_amount: params.amount,
      p_type: params.type,
      p_reference: params.reference,
      p_idempotency_key: params.idempotencyKey ?? null,
      p_metadata: params.metadata ?? {},
    });
    if (error) {
      const e = error as RpcErrorShape;
      throw Object.assign(new Error(e.message ?? "clearing_topup_failed"), {
        code: "CLEARING_RPC_ERROR",
        hint: e.hint,
        details: e.details,
      });
    }
    return asResult(data);
  }

  async createSacco(row: { name: string; status?: string; shareholding?: Record<string, unknown> }) {
    const { data, error } = await this.sb
      .from("saccos")
      .insert({
        name: row.name,
        status: row.status ?? "active",
        shareholding: row.shareholding ?? {},
      })
      .select("id,name,status,shareholding,created_at")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message ?? "clearing_create_sacco_failed"), { code: "CLEARING_INSERT_ERROR" });
    }
    return data as {
      id: string;
      name: string;
      status: string;
      shareholding: Record<string, unknown>;
      created_at: string;
    };
  }

  async getSettlementAccount(saccoId: string) {
    const { data, error } = await this.sb
      .from("settlement_accounts")
      .select("id,sacco_id,balance,minimum_required_balance,last_updated")
      .eq("sacco_id", saccoId)
      .maybeSingle();
    if (error) {
      throw Object.assign(new Error(error.message ?? "clearing_fetch_settlement_failed"), {
        code: "CLEARING_FETCH_ERROR",
      });
    }
    return data;
  }

  async getShares(saccoId: string) {
    const { data, error } = await this.sb.from("sacco_shares").select("*").eq("sacco_id", saccoId).maybeSingle();
    if (error) {
      throw Object.assign(new Error(error.message ?? "clearing_fetch_shares_failed"), { code: "CLEARING_FETCH_ERROR" });
    }
    return data;
  }
}
