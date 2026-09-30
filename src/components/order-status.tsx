import { Badge } from "@/components/ui/card";
import { orderStatusLabel } from "@/lib/labels";
import type { OrderStatus } from "@/generated/prisma/enums";

const tone: Record<OrderStatus, "default" | "success" | "warning" | "danger" | "muted"> = {
  DRAFT: "muted", PENDING_PAYMENT: "muted", PAYMENT_AUTHORIZED: "default", PAYMENT_FAILED: "danger", COMPLIANCE_PENDING: "default",
  DOCUMENTS_REQUIRED: "warning", DOCUMENTS_REVIEW: "default", COMPLIANCE_APPROVED: "success", COMPLIANCE_REJECTED: "danger",
  AWAITING_BALANCE: "warning", READY_FOR_FULFILLMENT: "success", PREPARING: "success", SHIPPED: "success", DELIVERED: "success",
  DELIVERY_FAILED: "danger", CANCELLED: "muted", REFUND_PENDING: "warning", REFUNDED: "muted",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={tone[status]}>{orderStatusLabel[status]}</Badge>;
}

/** Étapes du parcours affichées au client. */
export const CUSTOMER_STEPS: { status: OrderStatus[]; label: string }[] = [
  { status: ["PENDING_PAYMENT", "PAYMENT_FAILED", "PAYMENT_AUTHORIZED"], label: "Paiement" },
  { status: ["COMPLIANCE_PENDING", "DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW"], label: "Vérification" },
  { status: ["COMPLIANCE_APPROVED", "AWAITING_BALANCE"], label: "Validée" },
  { status: ["READY_FOR_FULFILLMENT", "PREPARING"], label: "Préparation" },
  { status: ["SHIPPED", "DELIVERY_FAILED"], label: "Expédiée" },
  { status: ["DELIVERED"], label: "Reçue" },
];
