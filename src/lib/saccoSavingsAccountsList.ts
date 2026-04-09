/**
 * List / register of `sacco_member_savings_accounts` with linked member numbers.
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type SaccoSavingsAccountListMemberEmbed = {
  member_number: string;
  full_name: string;
};

/** Row shape from select with embedded member; optional columns depend on migrations (2003/2004). */
export type SaccoSavingsAccountListRow = {
  id: string;
  organization_id: string;
  sacco_member_id: string;
  savings_product_code: string;
  account_number: string;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  date_account_opened?: string | null;
  client_no?: string | null;
  client_full_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  marital_status?: string | null;
  address?: string | null;
  telephone?: string | null;
  email?: string | null;
  occupation?: string | null;
  next_of_kin?: string | null;
  nok_phone?: string | null;
  sub_account?: string | null;
  posted_by_staff_id?: string | null;
  posted_by_name?: string | null;
  edited_by_staff_id?: string | null;
  edited_by_name?: string | null;
  sacco_members?: SaccoSavingsAccountListMemberEmbed | null;
};

export async function fetchSavingsAccountsList(organizationId: string): Promise<SaccoSavingsAccountListRow[]> {
  const { data, error } = await sb
    .from("sacco_member_savings_accounts")
    .select("*, sacco_members(member_number, full_name)")
    .eq("organization_id", organizationId)
    .order("account_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SaccoSavingsAccountListRow[];
}
