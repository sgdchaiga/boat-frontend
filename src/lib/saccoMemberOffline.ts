import { randomUuid } from "@/lib/randomUuid";
import { supabase } from "@/lib/supabase";

export type MemberRequestKind = "savings_deposit" | "member_transfer" | "bill_payment";
export type MemberRequestStatus = "queued" | "syncing" | "submitted" | "failed";

export interface SaccoMemberRequest {
  id: string;
  organizationId: string;
  memberId: string;
  kind: MemberRequestKind;
  amount: number;
  destination?: string;
  provider?: string;
  accountReference?: string;
  note?: string;
  createdAt: string;
  status: MemberRequestStatus;
  error?: string;
}

const KEY = "boat.sacco.member.requests.v1";

function readAll(): SaccoMemberRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeAll(rows: SaccoMemberRequest[]) {
  window.localStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new CustomEvent("boat:sacco-member-queue"));
}

export function readMemberRequests(organizationId: string, memberId: string): SaccoMemberRequest[] {
  return readAll().filter((row) => row.organizationId === organizationId && row.memberId === memberId);
}

export function queueMemberRequest(input: Omit<SaccoMemberRequest, "id" | "createdAt" | "status">): SaccoMemberRequest {
  const row: SaccoMemberRequest = {
    ...input,
    id: randomUuid(),
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  writeAll([row, ...readAll()]);
  return row;
}

export async function syncMemberRequests(organizationId: string, memberId?: string): Promise<SaccoMemberRequest[]> {
  const all = readAll();
  const candidates = all.filter((row) =>
    row.organizationId === organizationId &&
    (!memberId || row.memberId === memberId) &&
    (row.status === "queued" || row.status === "failed")
  );
  if (!navigator.onLine || candidates.length === 0) return readMemberRequests(organizationId, memberId || "");

  for (const candidate of candidates) {
    candidate.status = "syncing";
    candidate.error = undefined;
    writeAll([...all]);
    const { error } = await supabase.from("sacco_member_requests").upsert({
      id: candidate.id,
      organization_id: candidate.organizationId,
      sacco_member_id: candidate.memberId,
      request_type: candidate.kind,
      amount: candidate.amount,
      destination: candidate.destination ?? null,
      provider: candidate.provider ?? null,
      account_reference: candidate.accountReference ?? null,
      note: candidate.note ?? null,
      status: "pending",
      requested_at: candidate.createdAt,
    });
    candidate.status = error ? "failed" : "submitted";
    candidate.error = error?.message;
    writeAll([...all]);
  }
  return memberId ? readMemberRequests(organizationId, memberId) : readAll().filter((r) => r.organizationId === organizationId);
}
