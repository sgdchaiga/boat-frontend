/** VSLA workspace route ids — use with `?page=` and `onNavigate`. */
export const VSLA_PAGE = {
  dashboard: "vsla_dashboard",
  members: "vsla_members",
  savings: "vsla_savings",
  meetings: "vsla_meetings",
  meetingMinutes: "vsla_meeting_minutes",
  loans: "vsla_loans",
  repayments: "vsla_repayments",
  finesSocial: "vsla_fines_social",
  cashbox: "vsla_cashbox",
  shareOut: "vsla_share_out",
  reports: "vsla_reports",
  controls: "vsla_controls",
  memberStatement: "vsla_member_statement",
} as const;

export type VslaPageId = (typeof VSLA_PAGE)[keyof typeof VSLA_PAGE];

/** Default landing page for `business_type === "vsla"`. */
export const VSLA_HOME_PAGE = VSLA_PAGE.dashboard;
