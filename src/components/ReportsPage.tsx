import { useEffect, useState } from 'react';
import { FileText, Download, TrendingUp, Users, DollarSign, BedDouble } from 'lucide-react';
import { PageNotes } from './common/PageNotes';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { filterByOrganizationId } from '../lib/supabaseOrgFilter';
import { computeReportRange, type DateRangeKey } from '../lib/reportsDateRange';
import { SchoolReportsOverview } from './school/reports/SchoolReportsOverview';

interface ReportStats {
  totalRevenue: number;
  totalReservations: number;
  totalGuests: number;
  averageOccupancy: number;
  completedStays: number;
  averageStayDuration: number;
}

interface DepartmentSalesRow {
  departmentId: string | null;
  departmentName: string;
  totalSales: number;
}

function HotelRetailReportsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const businessType = (user?.business_type || '').toLowerCase();
  const isRetailLike = businessType === 'retail' || businessType === 'restaurant';

  const [stats, setStats] = useState<ReportStats>({
    totalRevenue: 0,
    totalReservations: 0,
    totalGuests: 0,
    averageOccupancy: 0,
    completedStays: 0,
    averageStayDuration: 0,
  });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [rangeFrom, setRangeFrom] = useState<string>(''); // ISO string
  const [rangeTo, setRangeTo] = useState<string>('');     // ISO string
  const [exportFormat, setExportFormat] = useState<'pdf' | 'excel'>('pdf');
  const [departmentSales, setDepartmentSales] = useState<DepartmentSalesRow[]>([]);

  useEffect(() => {
    fetchReportData();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const fetchReportData = async () => {
    try {
      const { from, to } = computeReportRange(dateRange, customFrom, customTo);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      setRangeFrom(fromIso);
      setRangeTo(toIso);

      const [
        paymentsResult,
        reservationsResult,
        customersResult,
        roomsResult,
        staysResult,
        departmentsResult,
        posSalesResult,
        productsResult,
        retailSalesMovesResult,
      ] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from('payments')
            .select('amount')
            .eq('payment_status', 'completed')
            .gte('paid_at', fromIso)
            .lt('paid_at', toIso),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase.from('reservations').select('id').gte('created_at', fromIso).lt('created_at', toIso),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from('hotel_customers').select('id'), orgId, superAdmin),
        filterByOrganizationId(supabase.from('rooms').select('status'), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from('stays')
            .select('actual_check_in, actual_check_out')
            .not('actual_check_out', 'is', null)
            .gte('actual_check_in', fromIso)
            .lt('actual_check_in', toIso),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from('departments').select('id,name'), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from('kitchen_orders')
            .select('created_at, kitchen_order_items(quantity, product_id)')
            .gte('created_at', fromIso)
            .lt('created_at', toIso),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from('products').select('id, department_id, sales_price'), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from('product_stock_movements')
            .select('product_id, source_id, quantity_out, movement_date, source_type')
            .eq('source_type', 'sale')
            .gt('quantity_out', 0)
            .gte('movement_date', fromIso)
            .lt('movement_date', toIso),
          orgId,
          superAdmin
        ),
      ]);

      const payments = paymentsResult.data || [];
      const reservations = reservationsResult.data || [];
      const customers = customersResult.data || [];
      const rooms = roomsResult.data || [];
      const stays = staysResult.data || [];
      const departments = departmentsResult.data || [];
      const posOrders = posSalesResult.data || [];
      const retailMoves = (retailSalesMovesResult.data || []) as Array<{
        product_id: string;
        source_id: string | null;
        quantity_out: number | null;
      }>;
      const productMap = Object.fromEntries(
        ((productsResult?.data || []) as { id: string; department_id: string | null; sales_price: number | null }[]).map(
          (p) => [p.id, p]
        )
      );

      const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const totalRooms = rooms.length;
      const occupiedRooms = rooms.filter((r) => r.status === 'occupied').length;
      const averageOccupancy = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

      const stayDurations = stays.map((stay) => {
        const checkIn = new Date((stay as { actual_check_in: string }).actual_check_in);
        const checkOut = new Date((stay as { actual_check_out: string }).actual_check_out);
        return Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
      });
      const averageStayDuration = stayDurations.length > 0
        ? stayDurations.reduce((sum, duration) => sum + duration, 0) / stayDurations.length
        : 0;

      // POS daily sales categorized per department
      const deptTotals: Record<string, number> = {};
      if (!isRetailLike) {
        (posOrders as any[]).forEach((order) => {
          (order.kitchen_order_items || []).forEach((item: any) => {
            const prod = item.product_id ? productMap[item.product_id] : null;
            const depId = prod?.department_id ?? null;
            const price = prod?.sales_price ?? 0;
            const amount = Number(item.quantity) * Number(price);
            const key = depId ?? 'unknown';
            deptTotals[key] = (deptTotals[key] || 0) + amount;
          });
        });
      }

      if (isRetailLike || businessType === 'mixed') {
        const kitchenOrderIds = new Set((posOrders as any[]).map((o: any) => String(o.id)));
        retailMoves.forEach((mv) => {
          const sourceId = String(mv.source_id || '');
          if (!isRetailLike && sourceId && kitchenOrderIds.has(sourceId)) return;
          const qty = Number(mv.quantity_out || 0);
          if (qty <= 0) return;
          const prod = mv.product_id ? productMap[mv.product_id] : null;
          const depId = prod?.department_id ?? null;
          const price = prod?.sales_price ?? 0;
          const key = depId ?? 'unknown';
          deptTotals[key] = (deptTotals[key] || 0) + Number(price) * qty;
        });
      }

      const deptRows: DepartmentSalesRow[] = Object.entries(deptTotals).map(
        ([key, totalSales]) => {
          const dep =
            key === 'unknown'
              ? null
              : (departments as any[]).find((d) => d.id === key) || null;
          return {
            departmentId: dep ? dep.id : null,
            departmentName: dep ? dep.name : 'Unassigned',
            totalSales,
          };
        }
      ).sort((a, b) => b.totalSales - a.totalSales);

      setDepartmentSales(deptRows);

      setStats({
        totalRevenue,
        totalReservations: isRetailLike ? 0 : reservations.length,
        totalGuests: isRetailLike ? 0 : customers.length,
        averageOccupancy: isRetailLike ? 0 : averageOccupancy,
        completedStays: isRetailLike ? 0 : stays.length,
        averageStayDuration: isRetailLike ? 0 : averageStayDuration,
      });
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString();
  };

  const exportAsPdf = () => {
    if (!rangeFrom || !rangeTo) {
      alert('Report data not loaded yet.');
      return;
    }
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hotel Performance Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${formatDate(rangeFrom)} to ${formatDate(rangeTo)}`, 14, 28);

    let y = 40;
    const lines = [
      `Total Revenue: ${stats.totalRevenue.toFixed(2)}`,
      `Total Reservations: ${stats.totalReservations}`,
      `Total Guests: ${stats.totalGuests}`,
      `Average Occupancy: ${stats.averageOccupancy.toFixed(1)}%`,
      `Completed Stays: ${stats.completedStays}`,
      `Average Stay Duration: ${stats.averageStayDuration.toFixed(1)} days`,
    ];
    lines.forEach((line) => {
      doc.text(line, 14, y);
      y += 8;
    });

    // Department sales
    if (departmentSales.length > 0) {
      y += 6;
      doc.setFontSize(12);
      doc.text('Sales by Department', 14, y);
      y += 6;
      doc.setFontSize(10);
      departmentSales.forEach((row) => {
        doc.text(
          `${row.departmentName}: ${row.totalSales.toFixed(2)}`,
          14,
          y
        );
        y += 5;
      });
    }

    const fileLabel = `${formatDate(rangeFrom).replace(/\//g, '-')}_to_${formatDate(rangeTo).replace(/\//g, '-')}`;
    doc.save(`hotel_report_${fileLabel}.pdf`);
  };

  const exportAsCsv = () => {
    if (!rangeFrom || !rangeTo) {
      alert('Report data not loaded yet.');
      return;
    }
    const rows = [
      ['Metric', 'Value'],
      ['From', formatDate(rangeFrom)],
      ['To', formatDate(rangeTo)],
      ['Total Revenue', stats.totalRevenue.toFixed(2)],
      ['Total Reservations', String(stats.totalReservations)],
      ['Total Guests', String(stats.totalGuests)],
      ['Average Occupancy (%)', stats.averageOccupancy.toFixed(1)],
      ['Completed Stays', String(stats.completedStays)],
      ['Average Stay Duration (days)', stats.averageStayDuration.toFixed(1)],
    ];
    if (departmentSales.length > 0) {
      rows.push([]);
      rows.push(['Department', 'Total Sales']);
      departmentSales.forEach((row) => {
        rows.push([row.departmentName, row.totalSales.toFixed(2)]);
      });
    }
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hotel_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (exportFormat === 'pdf') {
      exportAsPdf();
    } else {
      exportAsCsv();
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-blue-50/40">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-blue-50/40">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
            <PageNotes ariaLabel="Reports help">
              <p>Business insights and analytics.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'pdf' | 'excel')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="pdf">PDF</option>
            <option value="excel">Excel (CSV)</option>
          </select>
          <button
            onClick={handleExport}
            className="app-btn-primary transition"
          >
            <Download className="w-5 h-5" />
            <span className="hidden sm:inline">Export Report</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">Date Range:</span>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="this_quarter">This Quarter</option>
              <option value="this_year">This Year</option>
              <option value="last_week">Last Week</option>
              <option value="last_month">Last Month</option>
              <option value="last_quarter">Last Quarter</option>
              <option value="last_year">Last Year</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {dateRange === 'custom' && (
            <div className="flex gap-2 items-center">
              <input
                type="date"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="text-slate-500 text-sm">to</span>
              <input
                type="date"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-emerald-100 p-3 rounded-lg">
              <DollarSign className="w-6 h-6 text-emerald-600" />
            </div>
            <TrendingUp className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-slate-600 text-sm mb-1">Total Revenue</p>
          <p className="text-3xl font-bold text-slate-900">{stats.totalRevenue.toFixed(2)}</p>
        </div>
        {!isRetailLike && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-100 p-3 rounded-lg">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Total Reservations</p>
          <p className="text-3xl font-bold text-slate-900">{stats.totalReservations}</p>
        </div>
        )}
        {!isRetailLike && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-violet-100 p-3 rounded-lg">
              <Users className="w-6 h-6 text-violet-600" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Total Guests</p>
          <p className="text-3xl font-bold text-slate-900">{stats.totalGuests}</p>
        </div>
        )}
        {!isRetailLike && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-100 p-3 rounded-lg">
              <BedDouble className="w-6 h-6 text-amber-600" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Average Occupancy</p>
          <p className="text-3xl font-bold text-slate-900">{stats.averageOccupancy.toFixed(1)}%</p>
        </div>
        )}
        {!isRetailLike && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-green-100 p-3 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Completed Stays</p>
          <p className="text-3xl font-bold text-slate-900">{stats.completedStays}</p>
        </div>
        )}
        {!isRetailLike && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-pink-100 p-3 rounded-lg">
              <FileText className="w-6 h-6 text-pink-600" />
            </div>
          </div>
          <p className="text-slate-600 text-sm mb-1">Avg Stay Duration</p>
          <p className="text-3xl font-bold text-slate-900">{stats.averageStayDuration.toFixed(1)} days</p>
        </div>
        )}
      </div>

      <div className="mt-8 bg-white rounded-xl p-6 border border-slate-200">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Report Summary</h2>
        <div className="space-y-3 text-sm text-slate-700">
          {!isRetailLike ? (
          <p>
            <span className="font-medium">Performance Overview:</span> The hotel generated {stats.totalRevenue.toFixed(2)} in revenue
            from {stats.totalReservations} reservations during the selected period.
          </p>
          ) : (
          <p>
            <span className="font-medium">Sales Overview:</span> The business generated {stats.totalRevenue.toFixed(2)} in payments
            during the selected period.
          </p>
          )}
          {!isRetailLike && (
          <p>
            <span className="font-medium">Occupancy:</span> Average occupancy rate stands at {stats.averageOccupancy.toFixed(1)}%,
            with {stats.completedStays} completed stays.
          </p>
          )}
          {!isRetailLike && (
          <p>
            <span className="font-medium">Guest Behavior:</span> Guests typically stay for an average of {stats.averageStayDuration.toFixed(1)} days.
            Total guest database contains {stats.totalGuests} registered guests.
          </p>
          )}
        </div>
      </div>

      {departmentSales.length > 0 && (
        <div className="mt-8 bg-white rounded-xl p-6 border border-slate-200">
          <h2 className="text-xl font-bold text-slate-900 mb-4">
            Daily Sales by Department
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4">Department</th>
                  <th className="text-right py-2 pl-4">Total Sales</th>
                </tr>
              </thead>
              <tbody>
                {departmentSales.map((row) => (
                  <tr key={row.departmentId ?? row.departmentName} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.departmentName}</td>
                    <td className="py-2 pl-4 text-right">
                      {row.totalSales.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const businessType = (user?.business_type || "").toLowerCase();
  const isSchool = businessType === "school";

  if (isSchool) {
    return <SchoolReportsOverview onNavigate={onNavigate} />;
  }

  return (
    <div className="space-y-6">
      <div className="px-6 md:px-8 pt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">Item Reports</h2>
              <p className="text-sm text-slate-600 mt-1">
                Analyze sales and purchases by item with date and department filters.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate?.("reports_sales_by_item")}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
              >
                Sales by item
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.("reports_purchases_by_item")}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
              >
                Purchases by item
              </button>
            </div>
          </div>
        </div>
      </div>
      <HotelRetailReportsPage />
    </div>
  );
}
