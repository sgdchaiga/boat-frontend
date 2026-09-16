import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "../lib/supabase";

type VersionState = { version: 1 | 2; loading: boolean; error: string; refresh: () => void };
const VersionContext = createContext<VersionState>({ version: 1, loading: false, error: "", refresh: () => {} });
export const useManufacturingVersion = () => useContext(VersionContext);

export function ManufacturingVersionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ orgId: string | null; version: 1 | 2; loading: boolean; error: string }>({ orgId: null, version: 1, loading: false, error: "" });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    if (!orgId) { setState({ orgId, version: 1, loading: false, error: "" }); return; }
    setState({ orgId, version: 1, loading: true, error: "" });
    void (async () => {
      try {
        const { data, error } = await supabase.from("manufacturing_org_versions").select("version").eq("organization_id", orgId).maybeSingle();
        // Allows this application build to run before the optional V2 schema exists.
        if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
        if (active) setState({ orgId, version: !error && data?.version === 2 ? 2 : 1, loading: false, error: "" });
      } catch {
        if (active) setState({ orgId, version: 1, loading: false, error: "Could not verify the manufacturing version. Please retry before posting." });
      }
    })();
    return () => { active = false; };
  }, [orgId, revision]);
  const current = state.orgId === orgId ? state : { version: 1 as const, loading: !!orgId, error: "" };
  return <VersionContext.Provider value={{ ...current, refresh }}>{children}</VersionContext.Provider>;
}
