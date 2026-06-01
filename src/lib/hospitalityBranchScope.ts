/** Staff without a branch assignment see org-wide data (managers). Branch staff are isolated. */
export function getStaffHospitalityBranchId(user: {
  isSuperAdmin?: boolean;
  hospitality_branch_id?: string | null;
} | null | undefined): string | null {
  if (!user || user.isSuperAdmin) return null;
  const id = user.hospitality_branch_id?.trim();
  return id || null;
}

export function shouldScopeToHospitalityBranch(user: Parameters<typeof getStaffHospitalityBranchId>[0]): boolean {
  return getStaffHospitalityBranchId(user) != null;
}

/** Apply branch filter on Supabase queries when staff is assigned to a branch. */
export function applyHospitalityBranchFilter<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  user: Parameters<typeof getStaffHospitalityBranchId>[0],
  column = "hospitality_branch_id"
): T {
  const branchId = getStaffHospitalityBranchId(user);
  if (!branchId) return query;
  return query.eq(column, branchId);
}
