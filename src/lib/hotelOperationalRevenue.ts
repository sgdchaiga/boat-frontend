import { loadHotelConfig } from "./hotelConfig";
import type { AccountTotal } from "./incomeStatementLayout";
import { supabase } from "./supabase";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "./supabaseOrgFilter";
import { businessDayRangeForDateString, toBusinessDateString } from "./timezone";

export type HotelRevenueTrendPoint = { period: string; revenue: number };
export type BarSalesReconciliation = {
  posBarSales: number;
  glBarSales: number;
  variance: number;
  posKitchenSales: number;
  glKitchenSales: number;
  kitchenVariance: number;
};
export type OperationalRevenueDetail = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  reference: string;
  amount: number;
};

type RevenueBucket = "bar" | "kitchen" | "sauna";

const REVENUE_ROWS: Record<RevenueBucket | "rooms", Omit<AccountTotal, "total">> = {
  bar: {
    account_id: "operational-revenue:bar",
    account_code: "POS-BAR",
    account_name: "Bar POS sales",
    account_type: "income",
    category: "Operational revenue",
  },
  kitchen: {
    account_id: "operational-revenue:kitchen",
    account_code: "POS-KITCHEN",
    account_name: "Kitchen POS sales",
    account_type: "income",
    category: "Operational revenue",
  },
  sauna: {
    account_id: "operational-revenue:sauna",
    account_code: "POS-SAUNA",
    account_name: "Sauna POS sales",
    account_type: "income",
    category: "Operational revenue",
  },
  rooms: {
    account_id: "operational-revenue:rooms",
    account_code: "BILLING-ROOMS",
    account_name: "Accommodation / room billing",
    account_type: "income",
    category: "Operational revenue",
  },
};

function classifyDepartment(
  id: string | null,
  name: string | null,
  configured: { bar: string | null; kitchen: string | null; sauna: string | null }
): RevenueBucket | null {
  if (id && id === configured.bar) return "bar";
  if (id && id === configured.kitchen) return "kitchen";
  if (id && id === configured.sauna) return "sauna";

  const normalized = (name || "").toLowerCase();
  if (normalized.includes("sauna") || normalized.includes("spa")) return "sauna";
  if (normalized.includes("bar")) return "bar";
  if (normalized.includes("kitchen") || normalized.includes("restaurant") || normalized.includes("food")) return "kitchen";
  return null;
}

export async function fetchHotelOperationalRevenue(
  fromDate: string,
  toDateInclusive: string,
  organizationId: string | undefined,
  isSuperAdmin: boolean
): Promise<{
  rows: AccountTotal[];
  total: number;
  trend: HotelRevenueTrendPoint[];
  barReconciliation: BarSalesReconciliation;
  details: OperationalRevenueDetail[];
}> {
  const fromRange = businessDayRangeForDateString(fromDate);
  const toRange = businessDayRangeForDateString(toDateInclusive);
  if (!fromRange || !toRange) throw new Error("Invalid income statement date range.");

  const fromIso = fromRange.from.toISOString();
  const toIso = toRange.to.toISOString();
  const config = loadHotelConfig(organizationId);
  const configured = {
    bar: config.pos_bar_department_id?.trim() || null,
    kitchen: config.pos_kitchen_orders_department_id?.trim() || null,
    sauna: config.pos_sauna_department_id?.trim() || null,
  };

  const [departmentsRes, productsRes, ordersRes, billingRes, posJournalLinesRes, roomJournalLinesRes] = await Promise.all([
    filterByOrganizationId(supabase.from("departments").select("id,name"), organizationId, isSuperAdmin),
    filterByOrganizationId(supabase.from("products").select("id,name,department_id,sales_price"), organizationId, isSuperAdmin),
    filterByOrganizationId(
      supabase
        .from("kitchen_orders")
        .select("id,created_at,customer_name,order_status,kitchen_order_items(quantity,product_id)")
        .gte("created_at", fromIso)
        .lt("created_at", toIso),
      organizationId,
      isSuperAdmin
    ),
    filterByOrganizationId(
      supabase
        .from("billing")
        .select("id,amount,description,charged_at")
        .eq("charge_type", "room")
        .gte("charged_at", fromIso)
        .lt("charged_at", toIso),
      organizationId,
      isSuperAdmin
    ),
    filterJournalLinesByOrganizationId(
      supabase
        .from("journal_entry_lines")
        .select("debit,credit,line_description,journal_entries!inner(entry_date,reference_type,is_posted)")
        .eq("journal_entries.reference_type", "pos")
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false)
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDateInclusive),
      organizationId,
      isSuperAdmin
    ),
    filterJournalLinesByOrganizationId(
      supabase
        .from("journal_entry_lines")
        .select(
          "debit,credit,line_description,gl_accounts!inner(account_type),journal_entries!inner(id,entry_date,reference_type,reference_id,description,is_posted)"
        )
        .eq("journal_entries.reference_type", "room_charge")
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false)
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDateInclusive),
      organizationId,
      isSuperAdmin
    ),
  ]);

  for (const result of [departmentsRes, productsRes, ordersRes, billingRes, posJournalLinesRes, roomJournalLinesRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const departmentNameById = Object.fromEntries(
    ((departmentsRes.data || []) as Array<{ id: string; name: string }>).map((department) => [department.id, department.name])
  );
  const productsById = Object.fromEntries(
    ((productsRes.data || []) as Array<{ id: string; name?: string | null; department_id: string | null; sales_price: number | null }>).map((product) => [
      product.id,
      product,
    ])
  );
  const totals: Record<RevenueBucket | "rooms", number> = { bar: 0, kitchen: 0, sauna: 0, rooms: 0 };
  const monthly: Record<string, number> = {};
  const details: OperationalRevenueDetail[] = [];
  const barDepartmentNames = new Set(
    ((departmentsRes.data || []) as Array<{ id: string; name: string }>)
      .filter((department) => classifyDepartment(department.id, department.name, configured) === "bar")
      .map((department) => `${department.name.trim().toLowerCase()} sales`)
  );
  barDepartmentNames.add("bar sales");
  const kitchenDepartmentNames = new Set(
    ((departmentsRes.data || []) as Array<{ id: string; name: string }>)
      .filter((department) => classifyDepartment(department.id, department.name, configured) === "kitchen")
      .map((department) => `${department.name.trim().toLowerCase()} sales`)
  );
  kitchenDepartmentNames.add("kitchen sales");

  ((ordersRes.data || []) as Array<{
    id: string;
    created_at: string;
    customer_name: string | null;
    order_status: string | null;
    kitchen_order_items: Array<{ quantity: number | null; product_id: string | null }> | null;
  }>).forEach((order) => {
    if (["cancelled", "canceled", "reversed", "void", "voided"].includes((order.order_status || "").toLowerCase())) return;
    const period = toBusinessDateString(order.created_at).slice(0, 7);
    (order.kitchen_order_items || []).forEach((item) => {
      const product = item.product_id ? productsById[item.product_id] : null;
      if (!product) return;
      const bucket = classifyDepartment(product.department_id, departmentNameById[product.department_id || ""] || null, configured);
      if (!bucket) return;
      const amount = (Number(item.quantity) || 0) * (Number(product.sales_price) || 0);
      totals[bucket] += amount;
      monthly[period] = (monthly[period] || 0) + amount;
      details.push({
        id: `${order.id}-${item.product_id || details.length}`,
        accountId: REVENUE_ROWS[bucket].account_id,
        date: toBusinessDateString(order.created_at),
        description: `${product.name || "POS item"}${order.customer_name ? ` - ${order.customer_name}` : ""}`,
        reference: order.id,
        amount,
      });
    });
  });

  ((billingRes.data || []) as Array<{ id: string; amount: number | null; description: string | null; charged_at: string }>).forEach((charge) => {
    const amount = Number(charge.amount) || 0;
    const period = toBusinessDateString(charge.charged_at).slice(0, 7);
    totals.rooms += amount;
    monthly[period] = (monthly[period] || 0) + amount;
    details.push({
      id: charge.id,
      accountId: REVENUE_ROWS.rooms.account_id,
      date: toBusinessDateString(charge.charged_at),
      description: charge.description || "Room charge",
      reference: charge.id,
      amount,
    });
  });

  if (Math.abs(totals.rooms) <= 0.0001) {
    ((roomJournalLinesRes.data || []) as Array<{
      debit: number | null;
      credit: number | null;
      line_description: string | null;
      gl_accounts?: { account_type?: string | null } | null;
      journal_entries?: {
        id: string;
        entry_date: string;
        reference_id: string | null;
        description: string | null;
      } | null;
    }>).forEach((line) => {
      const accountType = String(line.gl_accounts?.account_type || "").toLowerCase();
      if (accountType !== "income" && accountType !== "revenue") return;
      const amount = (Number(line.credit) || 0) - (Number(line.debit) || 0);
      if (Math.abs(amount) <= 0.0001) return;
      const entryDate = line.journal_entries?.entry_date || fromDate;
      const period = entryDate.slice(0, 7);
      totals.rooms += amount;
      monthly[period] = (monthly[period] || 0) + amount;
      details.push({
        id: line.journal_entries?.id || `room-journal-${details.length}`,
        accountId: REVENUE_ROWS.rooms.account_id,
        date: entryDate,
        description: line.line_description || line.journal_entries?.description || "Room charge journal",
        reference: line.journal_entries?.reference_id || line.journal_entries?.id || "",
        amount,
      });
    });
  }

  const rows = (Object.keys(REVENUE_ROWS) as Array<RevenueBucket | "rooms">).map((key) => ({
    ...REVENUE_ROWS[key],
    total: totals[key],
  }));
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    trend: Object.keys(monthly)
      .sort()
      .map((period) => ({ period, revenue: monthly[period] })),
    barReconciliation: (() => {
      const posLines = (posJournalLinesRes.data || []) as Array<{
        debit: number | null;
        credit: number | null;
        line_description: string | null;
      }>;
      const glBarSales = posLines.reduce((sum, line) => {
        const description = (line.line_description || "").trim().toLowerCase();
        if (!barDepartmentNames.has(description)) return sum;
        return sum + (Number(line.credit) || 0) - (Number(line.debit) || 0);
      }, 0);
      const glKitchenSales = posLines.reduce((sum, line) => {
        const description = (line.line_description || "").trim().toLowerCase();
        if (!kitchenDepartmentNames.has(description)) return sum;
        return sum + (Number(line.credit) || 0) - (Number(line.debit) || 0);
      }, 0);
      return {
        posBarSales: totals.bar,
        glBarSales,
        variance: totals.bar - glBarSales,
        posKitchenSales: totals.kitchen,
        glKitchenSales,
        kitchenVariance: totals.kitchen - glKitchenSales,
      };
    })(),
    details,
  };
}
