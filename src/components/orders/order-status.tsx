import { Badge } from "@/components/ui/badge";

export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const VARIANT: Record<string, "warning" | "success" | "signal" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  pending_payment: "warning",
  paid: "success",
  processing: "signal",
  shipped: "signal",
  delivered: "success",
  cancelled: "secondary",
  refunded: "destructive",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? "outline"}>{ORDER_STATUS_LABEL[status] ?? status}</Badge>;
}
