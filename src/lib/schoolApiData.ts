import { boatApi, isDesktopApiDataMode, staticBoatApiBaseUrl } from "@/lib/boatApi";
import { desktopApi } from "@/lib/desktopApi";

export function canUseSchoolApi(): boolean {
  if (!isDesktopApiDataMode()) return false;
  return Boolean(staticBoatApiBaseUrl()) || desktopApi.isAvailable();
}

export async function listSchoolRows<T>(resource: string, organizationId: string): Promise<T[]> {
  const result = await boatApi.school.list<T>(resource, organizationId);
  return result.data || [];
}

export async function createSchoolRow<T>(
  resource: string,
  organizationId: string,
  payload: Record<string, unknown>
): Promise<T> {
  const result = await boatApi.school.create<T>(resource, {
    ...payload,
    organization_id: organizationId,
  });
  return result.data;
}

export async function updateSchoolRow<T>(
  resource: string,
  organizationId: string,
  id: string,
  payload: Record<string, unknown>
): Promise<T> {
  const result = await boatApi.school.update<T>(resource, id, {
    ...payload,
    organization_id: organizationId,
  });
  return result.data;
}
