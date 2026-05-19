import { supabase } from "@/lib/supabase";

export type OrganizationMembership = {
  organization_id: string;
  role: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  last_accessed_at: string | null;
  organizations: {
    id: string;
    name: string;
    business_type: string | null;
    logo_url: string | null;
  } | null;
};

const ACTIVE_ORG_KEY_PREFIX = "boat.activeOrg.v1";

export function readStoredActiveOrganizationId(userId: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_ORG_KEY_PREFIX}:${userId}`);
  } catch {
    return null;
  }
}

export function writeStoredActiveOrganizationId(userId: string, organizationId: string | null): void {
  try {
    const key = `${ACTIVE_ORG_KEY_PREFIX}:${userId}`;
    if (!organizationId) localStorage.removeItem(key);
    else localStorage.setItem(key, organizationId);
  } catch {
    // ignore quota / private mode
  }
}

export function pickDefaultOrganizationId(
  memberships: OrganizationMembership[],
  storedId: string | null
): string | null {
  const active = memberships.filter((m) => m.is_active);
  if (active.length === 0) return null;
  if (storedId && active.some((m) => m.organization_id === storedId)) return storedId;
  const sorted = [...active].sort((a, b) => {
    const aTs = a.last_accessed_at ? new Date(a.last_accessed_at).getTime() : 0;
    const bTs = b.last_accessed_at ? new Date(b.last_accessed_at).getTime() : 0;
    return bTs - aTs;
  });
  return sorted[0]?.organization_id ?? null;
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  hotel: "Hotel",
  retail: "Retail",
  sacco: "SACCO",
  school: "School",
  clinic: "Clinic",
  manufacturing: "Manufacturing",
  vsla: "VSLA",
  restaurant: "Restaurant",
  mixed: "Mixed",
  other: "Business",
};

export type OrganizationMemberRow = {
  user_id: string;
  organization_id: string;
  role: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  email: string;
};

type FetchMembersOptions = {
  organizationId?: string;
  role?: string;
  limit?: number;
};

/** Load organization_members without PostgREST staff embed (no FK → avoids HTTP 400). */
export async function fetchOrganizationMembers(
  options: FetchMembersOptions = {}
): Promise<OrganizationMemberRow[]> {
  let q = supabase
    .from("organization_members")
    .select("user_id, organization_id, role, full_name, phone, is_active, created_at")
    .order("created_at", { ascending: false });

  if (options.organizationId) {
    q = q.eq("organization_id", options.organizationId);
  }
  if (options.role) {
    q = q.eq("role", options.role);
  }
  if (options.limit != null) {
    q = q.limit(options.limit);
  }

  const { data, error } = await q;
  if (error) throw error;

  const members = (data || []) as Omit<OrganizationMemberRow, "email">[];
  if (members.length === 0) return [];

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const { data: staffRows, error: staffError } = await supabase
    .from("staff")
    .select("id, email")
    .in("id", userIds);
  if (staffError) throw staffError;

  const emailByUserId = new Map<string, string>();
  for (const row of staffRows || []) {
    const s = row as { id: string; email: string };
    emailByUserId.set(s.id, s.email ?? "");
  }

  return members.map((m) => ({
    ...m,
    email: emailByUserId.get(m.user_id) ?? "",
  }));
}

type OrgEmbed = OrganizationMembership["organizations"];

function normalizeOrgEmbed(org: unknown): OrgEmbed {
  if (!org) return null;
  if (Array.isArray(org)) {
    const first = org[0] as OrgEmbed;
    return first ?? null;
  }
  return org as OrgEmbed;
}

/** Load memberships and organization display fields (names for org picker / switcher). */
export async function loadMembershipsForUser(userId: string): Promise<OrganizationMembership[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "organization_id, role, full_name, phone, is_active, last_accessed_at, organizations ( id, name, business_type, logo_url )"
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("last_accessed_at", { ascending: false, nullsFirst: false });
  if (error) throw error;

  const rows = (data || []) as (Omit<OrganizationMembership, "organizations"> & {
    organizations?: unknown;
  })[];

  const missingOrgIds = rows
    .filter((r) => !normalizeOrgEmbed(r.organizations)?.name?.trim())
    .map((r) => r.organization_id);

  const orgById = new Map<string, NonNullable<OrgEmbed>>();
  for (const r of rows) {
    const org = normalizeOrgEmbed(r.organizations);
    if (org?.id) orgById.set(org.id, org);
  }

  if (missingOrgIds.length > 0) {
    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, business_type, logo_url")
      .in("id", [...new Set(missingOrgIds)]);
    if (orgError) throw orgError;
    for (const o of orgRows || []) {
      const org = o as NonNullable<OrgEmbed>;
      orgById.set(org.id, org);
    }
  }

  return rows.map((r) => ({
    organization_id: r.organization_id,
    role: r.role,
    full_name: r.full_name,
    phone: r.phone,
    is_active: r.is_active,
    last_accessed_at: r.last_accessed_at,
    organizations: orgById.get(r.organization_id) ?? null,
  }));
}

export function organizationMembershipLabel(m: OrganizationMembership): string {
  const org = normalizeOrgEmbed(m.organizations);
  const name = org?.name?.trim() || "Organization";
  const type = org?.business_type;
  const typeLabel = type ? BUSINESS_TYPE_LABELS[type] || type : "";
  const role = m.role?.trim();
  const parts = [name, typeLabel, role].filter(Boolean);
  return parts.join(" · ");
}
