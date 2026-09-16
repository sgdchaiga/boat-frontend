import { lazy, Suspense, type ReactNode } from "react";
import { useManufacturingVersion } from "../../contexts/ManufacturingVersionContext";
const V1Overview = lazy(() => import("./ManufacturingPage").then((module) => ({ default: module.ManufacturingPage })));
const V1Orders = lazy(() => import("./ManufacturingWorkOrdersPage").then((module) => ({ default: module.ManufacturingWorkOrdersPage })));
const V1Entries = lazy(() => import("./ManufacturingProductionEntriesPage").then((module) => ({ default: module.ManufacturingProductionEntriesPage })));

const V2Overview = lazy(() => import("./v2/ManufacturingPage").then((module) => ({ default: module.ManufacturingPage })));
const V2Orders = lazy(() => import("./v2/ManufacturingWorkOrdersPage").then((module) => ({ default: module.ManufacturingWorkOrdersPage })));
const V2Entries = lazy(() => import("./v2/ManufacturingProductionEntriesPage").then((module) => ({ default: module.ManufacturingProductionEntriesPage })));

function VersionBoundary({ legacy, children }: { legacy?: ReactNode; children: ReactNode }) {
  const { version, loading, error, refresh } = useManufacturingVersion();
  if (loading) return <p role="status" className="p-6">Loading manufacturing...</p>;
  if (error) return <div role="alert" className="p-6"><p>{error}</p><button type="button" onClick={refresh} className="app-btn-primary mt-3">Retry</button></div>;
  if (version === 1) return <Suspense fallback={<p role="status" className="p-6">Loading manufacturing...</p>}>{legacy ?? <p className="p-6">This feature belongs to Manufacturing V2. Your business is using V1.</p>}</Suspense>;
  return <Suspense fallback={<p role="status" className="p-6">Loading Manufacturing V2...</p>}><div className="border-b bg-blue-50 px-6 py-2 text-xs font-semibold text-blue-800">Manufacturing V2</div>{children}</Suspense>;
}
export function ManufacturingV2Only({ children }: { children: ReactNode }) { return <VersionBoundary>{children}</VersionBoundary>; }
export function ManufacturingPage(props: { readOnly?: boolean; onNavigate?: (page: string, state?: Record<string, unknown>) => void }) {
  return <VersionBoundary legacy={<V1Overview {...props} />}><V2Overview {...props} /></VersionBoundary>;
}
export function ManufacturingWorkOrdersPage(props: { readOnly?: boolean }) {
  return <VersionBoundary legacy={<V1Orders {...props} />}><V2Orders {...props} /></VersionBoundary>;
}
export function ManufacturingProductionEntriesPage(props: { readOnly?: boolean; simpleMode?: boolean }) {
  return <VersionBoundary legacy={<V1Entries {...props} />}><V2Entries {...props} /></VersionBoundary>;
}
