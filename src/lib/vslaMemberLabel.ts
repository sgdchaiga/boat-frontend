export type VslaMemberLike = {
  full_name: string | null | undefined;
  member_number?: string | null;
};

export function formatVslaMemberLabel(member: VslaMemberLike): string {
  const name = (member.full_name ?? "").trim() || "Unknown";
  const memberNumber = (member.member_number ?? "").trim();
  return memberNumber ? `${name} (${memberNumber})` : name;
}
