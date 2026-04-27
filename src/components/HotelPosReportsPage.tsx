import { ReportsPage } from "./ReportsPage";

export function HotelPosReportsPage() {
  return (
    <div className="space-y-4">
      <div className="px-6 pt-6 md:px-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">POS Analytics</h1>
        <p className="text-sm text-slate-600 mt-1">Sales trends, cashier performance, and operational reporting.</p>
      </div>
      <ReportsPage />
    </div>
  );
}
