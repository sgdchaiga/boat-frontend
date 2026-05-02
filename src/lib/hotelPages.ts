/** Hotel / front-desk workspace routes — use with `?page=` and `onNavigate`. */
export const HOTEL_PAGE = {
  /** Room types, room numbers, and setup (hotel & mixed tenants only). */
  roomsSetup: "hotel_rooms_setup",
  posWaiter: "hotel_pos_waiter",
  posKitchenBar: "hotel_pos_kitchen_bar",
  posSupervisor: "hotel_pos_supervisor",
  posReports: "hotel_pos_reports",
} as const;

/** Assessment & onboarding (prospect hotels, scoring, proposals). */
export const HOTEL_ASSESSMENT_PAGE = {
  home: "hotel_assessment",
  run: "hotel_assessment_run",
} as const;

export type HotelPageId = (typeof HOTEL_PAGE)[keyof typeof HOTEL_PAGE];
