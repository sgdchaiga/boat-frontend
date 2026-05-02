import { useCallback, useEffect, useState } from "react";
import {
  fetchTellerDashboardSnapshot,
  fetchTellerInitData,
  type TellerDashboardSnapshot,
  type TellerInitData,
} from "@/lib/saccoTellerDb";

/**
 * Loads teller dashboard snapshot + member/savings/GL pick lists in one round-trip per load().
 */
export function useTellerInit(
  organizationId: string | null,
  staffId: string | undefined,
  isSuperAdmin: boolean
) {
  const [snap, setSnap] = useState<TellerDashboardSnapshot | null>(null);
  const [init, setInit] = useState<TellerInitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!organizationId) {
        setSnap(null);
        setInit(null);
        setLoading(false);
        setInitLoading(false);
        return;
      }
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
        setInitLoading(true);
      }
      setLoadError(null);
      try {
        const [data, initData] = await Promise.all([
          fetchTellerDashboardSnapshot(organizationId, staffId),
          fetchTellerInitData(organizationId, Boolean(isSuperAdmin)),
        ]);
        setSnap(data);
        setInit(initData);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load teller data");
        setSnap(null);
        setInit(null);
      } finally {
        if (!silent) {
          setLoading(false);
          setInitLoading(false);
        }
      }
    },
    [organizationId, staffId, isSuperAdmin]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { snap, init, loading, initLoading, loadError, load };
}
