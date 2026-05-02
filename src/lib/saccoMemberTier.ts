/** Shareholding tiers — board-style declining rates (% p.a.). Silver rate is nominally board-approved but encoded as default below. */

export type SaccoMembershipTier = "bronze" | "silver" | "gold" | "diamond" | "platinum";

const TIER_RATES_PA_DECLINING: Record<SaccoMembershipTier, number> = {
  bronze: 24,
  silver: 21,
  gold: 18,
  diamond: 15,
  platinum: 12,
};

/** Tier labels aligned to share balances (money units counted as “shares” on member record / share accounts). */
/** Share bands: Bronze &lt;100; Silver 101–200; Gold 201–300; Diamond 301–500; Platinum &gt;500. Exactly 100 is treated as Bronze (below Silver start). */
export function sharesToTier(sharesBalance: number): SaccoMembershipTier {
  const s = Math.max(0, sharesBalance);
  if (s < 101) return "bronze";
  if (s <= 200) return "silver";
  if (s <= 300) return "gold";
  if (s <= 500) return "diamond";
  return "platinum";
}

export function tierLabel(tier: SaccoMembershipTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Default declining interest % p.a. for tier (Silver is typically board-approved — override in UI if needed). */
export function tierDefaultDecliningRatePa(tier: SaccoMembershipTier): number {
  return TIER_RATES_PA_DECLINING[tier];
}

export function tierBandsDescription(): string {
  return "Bronze: fewer than 101 shares (<101) · Silver: 101–200 · Gold: 201–300 · Diamond: 301–500 · Platinum: greater than 500.";
}
