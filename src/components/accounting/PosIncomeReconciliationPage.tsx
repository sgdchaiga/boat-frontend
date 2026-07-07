import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { formatCurrency } from "../../lib/accountingReportExport";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { businessTodayISO, toBusinessDateString } from "../../lib/timezone";

type PosReconStatus =
  | "matched"
  | "missing_journal"
  | "unposted"
  | "deleted"
  | "date_mismatch"
  | "amount_mismatch"
  | "journal_without_pos_order"
  | "journal_for_voided_order";
type Department = { id: string; name: string };
type PosOrderRow = {
  id: string;
  created_at: string | null;
  customer_name: string | null;
  table_number: string | null;
  order_status: string | null;
  kitchen_order_items: Array<{ quantity: number | null; unit_price: number | null; product_id: string | null }> | null;
};
type PosReconRow = {
  orderId: string;
  orderDate: string;
  label: string;
  departmentName: string;
  posTotal: number;
  journalSales: number;
  variance: number;
  journalId: string | null;
  journalNumber: string | null;
  journalDate: string | null;
  journalDescription: string | null;
  status: PosReconStatus;
  rowType: "pos_order" | "journal_only";
  note?: string | null;
};

const money = (value: number) => formatCurrency(value, { currency: "UGX", locale: "en-UG" });

const statusText: Record<PosReconStatus, string> = {
  matched: "Matched",
  missing_journal: "No journal",
  unposted: "Unposted",
  deleted: "Deleted",
  date_mismatch: "Date mismatch",
  amount_mismatch: "Amount mismatch",
  journal_without_pos_order: "Journal without POS order",
  journal_for_voided_order: "Journal for voided order",
};

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function PosIncomeReconciliationPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const today = businessTodayISO();
  const [fromDate, setFromDate] = useState(monthStart(today));
  const [toDate, setToDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<PosReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (user?.business_type !== "hotel" && user?.business_type !== "mixed") {
      setRows([]);
      setLoading(false);
      return;
    }
    if (!fromDate || !toDate) return;
    if (!orgId && !superAdmin) {
      setError("Missing organization on your staff profile. Contact admin to link your account.");
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [departmentsRes, productsRes, ordersRes] = await Promise.all([
        filterByOrganizationId(supabase.from("departments").select("id,name").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("products").select("id,name,sales_price,department_id"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select("id,created_at,customer_name,table_number,order_status,kitchen_order_items(quantity,unit_price,product_id)")
            .gte("created_at", `${fromDate}T00:00:00`)
            .lte("created_at", `${toDate}T23:59:59`)
            .order("created_at", { ascending: false }),
          orgId,
          superAdmin
        ),
      ]);
      if (departmentsRes.error) throw new Error(departmentsRes.error.message);
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (ordersRes.error) throw new Error(ordersRes.error.message);

      const nextDepartments = ((departmentsRes.data || []) as Department[]).filter((department) => department.id && department.name);
      setDepartments(nextDepartments);
      const departmentNameById = new Map(nextDepartments.map((department) => [department.id, department.name]));
      const productsById = new Map(
        ((productsRes.data || []) as Array<{ id: string; name?: string | null; sales_price: number | null; department_id: string | null }>).map(
          (product) => [product.id, product]
        )
      );
      const visibleOrders = (ordersRes.data || []) as PosOrderRow[];
      const visibleOrdersById = new Map(visibleOrders.map((order) => [order.id, order]));
      const orders = visibleOrders.filter((order) => !["cancelled", "canceled", "reversed", "void", "voided"].includes((order.order_status || "").toLowerCase()));
      const orderIds = orders.map((order) => order.id);
      type JournalRow = {
        id: string;
        transaction_id: string | null;
        reference_id: string | null;
        entry_date: string | null;
        description: string | null;
        is_posted: boolean | null;
        is_deleted: boolean | null;
      };
      const journalsForOrdersRes = orderIds.length
        ? await filterByOrganizationId(
            supabase
              .from("journal_entries")
              .select("id,transaction_id,reference_id,entry_date,description,is_posted,is_deleted")
              .eq("reference_type", "pos")
              .in("reference_id", orderIds),
            orgId,
            superAdmin
          )
        : { data: [], error: null };
      if (journalsForOrdersRes.error) throw new Error(journalsForOrdersRes.error.message);
      const journalsForPeriodRes = await filterByOrganizationId(
        supabase
          .from("journal_entries")
          .select("id,transaction_id,reference_id,entry_date,description,is_posted,is_deleted")
          .eq("reference_type", "pos")
          .eq("is_posted", true)
          .eq("is_deleted", false)
          .gte("entry_date", fromDate)
          .lte("entry_date", toDate),
        orgId,
        superAdmin
      );
      if (journalsForPeriodRes.error) throw new Error(journalsForPeriodRes.error.message);
      const journalById = new Map<string, JournalRow>();
      ([...(journalsForOrdersRes.data || []), ...(journalsForPeriodRes.data || [])] as JournalRow[]).forEach((journal) => {
        journalById.set(journal.id, journal);
      });
      const journals = Array.from(journalById.values());
      const journalReferenceIds = Array.from(new Set(journals.map((journal) => journal.reference_id).filter((id): id is string => !!id)));
      const missingReferenceIds = journalReferenceIds.filter((id) => !visibleOrdersById.has(id));
      const referencedOrdersRes = missingReferenceIds.length
        ? await filterByOrganizationId(
            supabase
              .from("kitchen_orders")
              .select("id,created_at,customer_name,table_number,order_status,kitchen_order_items(quantity,unit_price,product_id)")
              .in("id", missingReferenceIds),
            orgId,
            superAdmin
          )
        : { data: [], error: null };
      if (referencedOrdersRes.error) throw new Error(referencedOrdersRes.error.message);
      const referencedOrdersById = new Map<string, PosOrderRow>(visibleOrdersById);
      ((referencedOrdersRes.data || []) as PosOrderRow[]).forEach((order) => {
        referencedOrdersById.set(order.id, order);
      });
      const journalIds = journals.map((journal) => journal.id);
      const journalLinesRes = journalIds.length
        ? await supabase
            .from("journal_entry_lines")
            .select("journal_entry_id,debit,credit,line_description,dimensions,gl_accounts!inner(account_code,account_name,account_type,category)")
            .in("journal_entry_id", journalIds)
        : { data: [], error: null };
      if (journalLinesRes.error) throw new Error(journalLinesRes.error.message);

      const journalsByOrder = new Map<string, typeof journals>();
      journals.forEach((journal) => {
        if (!journal.reference_id) return;
        journalsByOrder.set(journal.reference_id, [...(journalsByOrder.get(journal.reference_id) || []), journal]);
      });

      const salesByJournal = new Map<string, number>();
      ((journalLinesRes.data || []) as Array<{
        journal_entry_id: string;
        debit: number | null;
        credit: number | null;
        line_description: string | null;
        dimensions?: unknown;
        gl_accounts: { account_code?: string | null; account_name?: string | null; account_type?: string | null; category?: string | null } | null;
      }>).forEach((line) => {
        const account = line.gl_accounts;
        const accountText = `${account?.account_code || ""} ${account?.account_name || ""} ${account?.category || ""}`.toLowerCase();
        const isIncome =
          account?.account_type === "income" ||
          account?.account_type === "revenue" ||
          /^4/.test(String(account?.account_code || "")) ||
          /\b(revenue|sales|income)\b/.test(accountText);
        if (!isIncome) return;
        if (departmentId) {
          const dimensions = line.dimensions && typeof line.dimensions === "object" ? (line.dimensions as Record<string, unknown>) : {};
          const lineDepartmentId = dimensions.department_id ? String(dimensions.department_id) : "";
          const selectedDepartmentName = (departmentNameById.get(departmentId) || "").trim().toLowerCase();
          const description = String(line.line_description || "").trim().toLowerCase();
          if (lineDepartmentId !== departmentId && (!selectedDepartmentName || !description.startsWith(selectedDepartmentName))) return;
        }
        salesByJournal.set(line.journal_entry_id, roundMoney((salesByJournal.get(line.journal_entry_id) || 0) + Number(line.credit || 0) - Number(line.debit || 0)));
      });

      const nextRows: PosReconRow[] = [];
      const orderIdsWithPosRows = new Set<string>();
      orders.forEach((order) => {
        const departmentTotals = new Map<string, number>();
        (order.kitchen_order_items || []).forEach((item) => {
          const product = item.product_id ? productsById.get(item.product_id) : null;
          if (!product) return;
          const rowDepartmentId = product.department_id || "unassigned";
          if (departmentId && rowDepartmentId !== departmentId) return;
          departmentTotals.set(
            rowDepartmentId,
            roundMoney((departmentTotals.get(rowDepartmentId) || 0) + Number(item.quantity || 0) * Number(item.unit_price ?? product.sales_price ?? 0))
          );
        });
        if (departmentTotals.size === 0) return;

        const posTotal = roundMoney(Array.from(departmentTotals.values()).reduce((sum, amount) => sum + amount, 0));
        const departmentName = departmentId
          ? departmentNameById.get(departmentId) || "Unassigned"
          : departmentTotals.size === 1
            ? departmentNameById.get(Array.from(departmentTotals.keys())[0]) || "Unassigned"
            : "Multiple departments";
        const orderJournals = journalsByOrder.get(order.id) || [];
        const postedActiveJournals = orderJournals.filter((journal) => journal.is_deleted !== true && journal.is_posted !== false);
        const activeJournal =
          postedActiveJournals[0] ||
          orderJournals.find((journal) => journal.is_deleted !== true) ||
          orderJournals[0] ||
          null;
        const journalSales = roundMoney(postedActiveJournals.reduce((sum, journal) => sum + (salesByJournal.get(journal.id) || 0), 0));
        const variance = roundMoney(journalSales - posTotal);
        let status: PosReconStatus = "matched";
        if (orderJournals.length === 0) status = "missing_journal";
        else if (orderJournals.every((journal) => journal.is_deleted === true)) status = "deleted";
        else if (postedActiveJournals.length === 0) status = "unposted";
        else if (postedActiveJournals.some((journal) => !journal.entry_date || journal.entry_date < fromDate || journal.entry_date > toDate)) status = "date_mismatch";
        else if (Math.abs(variance) > 0.01) status = "amount_mismatch";

        orderIdsWithPosRows.add(order.id);
        nextRows.push({
          orderId: order.id,
          orderDate: toBusinessDateString(order.created_at || ""),
          label: order.customer_name || order.table_number || "POS order",
          departmentName,
          posTotal,
          journalSales,
          variance,
          journalId: activeJournal?.id || null,
          journalNumber: activeJournal?.transaction_id || null,
          journalDate: activeJournal?.entry_date || null,
          journalDescription:
            postedActiveJournals.length > 1
              ? `${postedActiveJournals.length} posted POS journals`
              : activeJournal?.description || null,
          status,
          rowType: "pos_order",
        });
      });

      journals
        .filter((journal) => journal.is_deleted !== true && journal.is_posted !== false)
        .filter((journal) => !!journal.entry_date && journal.entry_date >= fromDate && journal.entry_date <= toDate)
        .forEach((journal) => {
          const referenceId = journal.reference_id || "";
          if (referenceId && orderIdsWithPosRows.has(referenceId)) return;
          const journalSales = roundMoney(salesByJournal.get(journal.id) || 0);
          if (Math.abs(journalSales) <= 0.01) return;
          const linkedOrder = referenceId ? referencedOrdersById.get(referenceId) : null;
          const linkedOrderDate = linkedOrder ? toBusinessDateString(linkedOrder.created_at || "") : "";
          const linkedOrderStatus = (linkedOrder?.order_status || "").toLowerCase();
          const isVoided = ["cancelled", "canceled", "reversed", "void", "voided"].includes(linkedOrderStatus);
          const linkedOrderInSelectedDate = !!linkedOrderDate && linkedOrderDate >= fromDate && linkedOrderDate <= toDate;
          const reason = !linkedOrder
            ? "Referenced POS order was not found."
            : isVoided
              ? `Referenced POS order status is ${linkedOrder.order_status || "voided"}.`
              : !linkedOrderInSelectedDate
                ? `Referenced POS order date is ${linkedOrderDate || "unknown"}, outside the selected POS date range.`
                : departmentId
                  ? "Referenced POS order has no items in the selected department filter."
                  : "Referenced POS order is outside the selected POS filter.";
          nextRows.push({
            orderId: referenceId || journal.id,
            orderDate: linkedOrderDate,
            label: linkedOrder
              ? linkedOrder.customer_name || linkedOrder.table_number || "POS order"
              : "No POS order found",
            departmentName: departmentId ? departmentNameById.get(departmentId) || "Selected department" : "Journal income",
            posTotal: 0,
            journalSales,
            variance: journalSales,
            journalId: journal.id,
            journalNumber: journal.transaction_id || null,
            journalDate: journal.entry_date,
            journalDescription: journal.description || null,
            status: isVoided ? "journal_for_voided_order" : "journal_without_pos_order",
            rowType: "journal_only",
            note: reason,
          });
        });
      setRows(nextRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load POS income reconciliation.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.business_type, orgId, superAdmin, fromDate, toDate, departmentId]);

  const summary = useMemo(() => {
    const unmatched = rows.filter((row) => row.status !== "matched").length;
    const orderRows = rows.filter((row) => row.rowType === "pos_order");
    const journalOnlyRows = rows.filter((row) => row.rowType === "journal_only");
    return {
      orders: orderRows.length,
      matched: orderRows.filter((row) => row.status === "matched").length,
      unmatched,
      journalOnly: journalOnlyRows.length,
      posTotal: rows.reduce((sum, row) => sum + row.posTotal, 0),
      journalSales: rows.reduce((sum, row) => sum + row.journalSales, 0),
      variance: rows.reduce((sum, row) => sum + row.variance, 0),
    };
  }, [rows]);

  if (user?.business_type !== "hotel" && user?.business_type !== "mixed") {
    return (
      <div className="p-6 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900">POS income reconciliation</h1>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          This reconciliation is available for hotel and mixed businesses.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">POS income reconciliation</h1>
        <p className="mt-1 text-sm text-slate-600">Match each POS order to the POS journal entry that feeds the income statement.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
            </label>
            <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
            </label>
            <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Department
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="min-w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900">
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={load} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? "Checking..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-6">
          {[
            ["POS orders", summary.orders],
            ["Matched", summary.matched],
            ["Needs review", summary.unmatched],
            ["POS sales", money(summary.posTotal)],
            ["Journal sales", money(summary.journalSales)],
            ["Variance", money(summary.variance)],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">POS order</th>
                <th className="p-3">Department</th>
                <th className="p-3 text-right">POS sales</th>
                <th className="p-3 text-right">Journal sales</th>
                <th className="p-3 text-right">Variance</th>
                <th className="p-3">Journal</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="p-4 text-center text-slate-500" colSpan={8}>Checking POS journals...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="p-4 text-center text-slate-500" colSpan={8}>No POS orders found for the selected filters.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.rowType}-${row.orderId}-${row.departmentName}-${row.journalId || "no-journal"}`} className={row.status === "matched" ? "" : "bg-amber-50/60"}>
                    <td className="p-3 whitespace-nowrap">{row.orderDate || row.journalDate || "-"}</td>
                    <td className="p-3">
                      <div className="font-medium text-slate-900">{row.label}</div>
                      <div className="text-xs text-slate-500">
                        {row.rowType === "journal_only" ? `Reference: ${row.orderId}` : row.orderId}
                      </div>
                      {row.note ? <div className="mt-1 text-xs text-amber-700">{row.note}</div> : null}
                    </td>
                    <td className="p-3">{row.departmentName}</td>
                    <td className="p-3 text-right">{money(row.posTotal)}</td>
                    <td className="p-3 text-right">{money(row.journalSales)}</td>
                    <td className={`p-3 text-right ${Math.abs(row.variance) > 0.01 ? "font-semibold text-amber-800" : ""}`}>{money(row.variance)}</td>
                    <td className="p-3">
                      {row.journalId ? (
                        <>
                          <div className="font-medium text-slate-900">{row.journalNumber || row.journalId}</div>
                          <div className="text-xs text-slate-600">{row.journalDate || "-"}</div>
                          <div className="text-xs text-slate-500">{row.journalDescription || row.journalId}</div>
                        </>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${row.status === "matched" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                        {statusText[row.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
