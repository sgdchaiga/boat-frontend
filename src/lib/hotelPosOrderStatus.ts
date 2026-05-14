export type ServiceType = "restaurant" | "bar" | "spa" | "room_service";

export type OrderStatusMap = {
  bar: "pending" | "preparing" | "ready" | "served";
  kitchen: "pending" | "preparing" | "ready" | "served";
  spa: "booked" | "in_progress" | "completed";
};

type OrderStatusBucket = keyof OrderStatusMap;
export type OrderStatus = OrderStatusMap[OrderStatusBucket];

const KITCHEN_BAR_LINEAR = ["pending", "preparing", "ready", "served", "completed"] as const;
export type KitchenBarLinearStatus = (typeof KITCHEN_BAR_LINEAR)[number];

const ORDER_STATUS_FLOW: {
  [K in OrderStatusBucket]: readonly OrderStatusMap[K][];
} = {
  bar: ["pending", "preparing", "ready", "served"],
  kitchen: ["pending", "preparing", "ready", "served"],
  spa: ["booked", "in_progress", "completed"],
};

export const DEFAULT_KITCHEN_BAR_FLOW: readonly KitchenBarLinearStatus[] = ["pending", "preparing", "ready", "served"];

export const statusBucketByServiceType: Record<ServiceType, OrderStatusBucket> = {
  restaurant: "kitchen",
  bar: "bar",
  spa: "spa",
  room_service: "kitchen",
};

export function getOrderStatusFlowForService(serviceType: ServiceType): readonly OrderStatus[] {
  return ORDER_STATUS_FLOW[statusBucketByServiceType[serviceType]];
}

/**
 * Normalize admin-configured kitchen/bar pipelines. `completed` is accepted as a terminal alias of `served`.
 */
export function normalizeKitchenBarStatusFlow(
  raw: string[] | null | undefined,
  preset: readonly KitchenBarLinearStatus[] = DEFAULT_KITCHEN_BAR_FLOW
): KitchenBarLinearStatus[] {
  const fallback = [...preset];
  if (!raw?.length) return fallback;
  const cleaned = raw
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s): s is KitchenBarLinearStatus =>
      (KITCHEN_BAR_LINEAR as readonly string[]).includes(s)
    );
  const uniq = cleaned.filter((x, i, a) => a.indexOf(x) === i);
  if (uniq.length < 2) return fallback;
  if (uniq[0] !== "pending") return fallback;
  const last = uniq[uniq.length - 1];
  if (last !== "served" && last !== "completed") return fallback;
  return uniq.map((s) => (s === "completed" ? "served" : s)) as KitchenBarLinearStatus[];
}

export type NextOrderStatusOptions = {
  kitchenFlow?: readonly string[] | null;
  barFlow?: readonly string[] | null;
};

export function getNextOrderStatus(
  status: string,
  serviceType: ServiceType,
  options?: NextOrderStatusOptions
): OrderStatus | string | null {
  const bucket = statusBucketByServiceType[serviceType];
  const defaultFlow = ORDER_STATUS_FLOW[bucket];
  let flow: readonly string[] = defaultFlow;
  if (bucket === "kitchen") {
    const f = options?.kitchenFlow?.length ? normalizeKitchenBarStatusFlow(options.kitchenFlow as string[]) : null;
    if (f?.length) flow = f;
  } else if (bucket === "bar") {
    const f = options?.barFlow?.length ? normalizeKitchenBarStatusFlow(options.barFlow as string[]) : null;
    if (f?.length) flow = f;
  }
  const currentIndex = flow.indexOf(status);
  if (currentIndex < 0 || currentIndex >= flow.length - 1) return null;
  return (flow[currentIndex + 1] ?? null) as OrderStatus | string | null;
}

/** Button label for advancing to `nextStatus` (kitchen/bar linear). */
export function formatKitchenBarAdvanceLabel(nextStatus: string): string {
  const s = String(nextStatus || "").toLowerCase();
  if (s === "preparing") return "Preparing";
  if (s === "ready") return "Ready";
  if (s === "served") return "Served";
  if (s === "pending") return "Pending";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Next";
}

export function isServiceOrderStatus(status: string, serviceType: ServiceType): status is OrderStatus {
  return getOrderStatusFlowForService(serviceType).includes(status as OrderStatus);
}
