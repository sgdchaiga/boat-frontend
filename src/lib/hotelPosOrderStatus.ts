export type ServiceType = "restaurant" | "bar" | "spa" | "room_service";

export type OrderStatusMap = {
  bar: "pending" | "preparing" | "ready" | "served";
  kitchen: "pending" | "preparing" | "ready" | "served";
  spa: "booked" | "in_progress" | "completed";
};

type OrderStatusBucket = keyof OrderStatusMap;
export type OrderStatus = OrderStatusMap[OrderStatusBucket];

const ORDER_STATUS_FLOW: {
  [K in OrderStatusBucket]: readonly OrderStatusMap[K][];
} = {
  bar: ["pending", "preparing", "ready", "served"],
  kitchen: ["pending", "preparing", "ready", "served"],
  spa: ["booked", "in_progress", "completed"],
};

export const statusBucketByServiceType: Record<ServiceType, OrderStatusBucket> = {
  restaurant: "kitchen",
  bar: "bar",
  spa: "spa",
  room_service: "kitchen",
};

export function getOrderStatusFlowForService(serviceType: ServiceType): readonly OrderStatus[] {
  return ORDER_STATUS_FLOW[statusBucketByServiceType[serviceType]];
}

export function getNextOrderStatus(status: string, serviceType: ServiceType): OrderStatus | null {
  const flow = getOrderStatusFlowForService(serviceType);
  const currentIndex = flow.indexOf(status as OrderStatus);
  if (currentIndex < 0 || currentIndex >= flow.length - 1) return null;
  return flow[currentIndex + 1] ?? null;
}

export function isServiceOrderStatus(status: string, serviceType: ServiceType): status is OrderStatus {
  return getOrderStatusFlowForService(serviceType).includes(status as OrderStatus);
}
