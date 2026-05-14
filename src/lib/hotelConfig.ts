/**
 * Business/organization config for headers, invoices, and reports.
 * Stored in localStorage per organization; editable in Admin > Business Configuration.
 */

/** Legacy single-key storage (pre per-organization keys). Migrated on first read when `organizationId` is set. */
const LEGACY_STORAGE_KEY = "guestpro_hotel_config";

function storageKey(organizationId: string | null): string {
  if (!organizationId) return LEGACY_STORAGE_KEY;
  return `guestpro_business_config_${organizationId}`;
}

function parseStored(raw: string | null): HotelConfig | null {
  if (!raw) return null;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export interface HotelConfig {
  hotel_name: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  timezone: string;
  /**
   * `auto`: selecting a table opens a POS table session immediately; session closes when the table has no active kitchen orders.
   * `manual`: waiter must tap Open session (legacy).
   */
  pos_table_session_mode?: "auto" | "manual";
  /** Linear kitchen order statuses (first must be `pending`, last `served` or `completed`). */
  pos_kitchen_status_flow?: string[];
  /** Linear bar / counter order statuses (same rules as kitchen). */
  pos_bar_status_flow?: string[];
  /**
   * When set, **Kitchen Orders** only lists lines whose product belongs to this department.
   * When unset, departments are auto-detected (kitchen / restaurant / dish_menu).
   */
  pos_kitchen_orders_department_id?: string | null;
  /**
   * When set, **Bar Orders** only lists lines for this department (e.g. a specific bar).
   * When unset, the first department whose name contains "bar" is used.
   */
  pos_bar_department_id?: string | null;
  /**
   * When set, **Sauna Orders** (spa / events counter) uses this department only.
   * When unset, the first department whose name contains "sauna" or "spa" is used.
   */
  pos_sauna_department_id?: string | null;
}

const DEFAULT_CONFIG: HotelConfig = {
  hotel_name: "BOAT Hotel",
  address: "",
  phone: "",
  email: "",
  currency: "USD",
  timezone: "Africa/Kampala",
  pos_table_session_mode: "manual",
  pos_kitchen_status_flow: ["pending", "preparing", "ready", "served"],
  pos_bar_status_flow: ["pending", "preparing", "ready", "served"],
};

/**
 * @param organizationId Logged-in user's organization — scopes config so each business has its own settings.
 */
export function loadHotelConfig(organizationId?: string | null): HotelConfig {
  const orgId = organizationId ?? null;
  const key = storageKey(orgId);
  const primary = parseStored(localStorage.getItem(key));
  if (primary) return primary;

  if (orgId) {
    const legacy = parseStored(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) {
      try {
        localStorage.setItem(key, JSON.stringify(legacy));
      } catch (_) {
        /* quota */
      }
      return legacy;
    }
  }

  const fallback = parseStored(localStorage.getItem(LEGACY_STORAGE_KEY));
  return fallback ?? DEFAULT_CONFIG;
}

export function saveHotelConfig(config: HotelConfig, organizationId?: string | null): void {
  localStorage.setItem(storageKey(organizationId ?? null), JSON.stringify(config));
}

/**
 * Hydrate invoice/header fields from the organizations row when local config is still the generic default
 * or empty, so Admin → Business configuration matches the current tenant in Supabase.
 */
export function mergeHotelConfigWithOrg(
  base: HotelConfig,
  org: { name?: string | null; address?: string | null } | null
): HotelConfig {
  if (!org) return base;
  const nameFromOrg = (org.name || "").trim();
  const addrFromOrg = (org.address || "").trim();
  const isGenericName =
    !base.hotel_name?.trim() ||
    base.hotel_name === DEFAULT_CONFIG.hotel_name;
  const addressEmpty = !base.address?.trim();
  return {
    ...base,
    hotel_name: isGenericName && nameFromOrg ? nameFromOrg : base.hotel_name,
    address: addressEmpty && addrFromOrg ? addrFromOrg : base.address,
  };
}

/** Legacy key used when no organization is linked (same as pre–per-org behavior). */
export { LEGACY_STORAGE_KEY, DEFAULT_CONFIG };
