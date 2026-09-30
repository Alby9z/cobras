/**
 * Machine à états des commandes — source unique de vérité des transitions.
 * Toute modification de statut passe par assertTransition() (service orders).
 */
import type { OrderStatus, PaymentStrategy, ShippingMethod } from "@/generated/prisma/enums";
import type { Permission } from "@/lib/domain/permissions";
import { AppError } from "@/lib/domain/errors";

export type Actor = "SYSTEM" | "CUSTOMER" | "STAFF";

interface Edge {
  to: OrderStatus;
  actors: Actor[];
  permission?: Permission; // exigée si l'acteur est STAFF
}

const e = (to: OrderStatus, actors: Actor[], permission?: Permission): Edge => ({ to, actors, permission });

export const ORDER_TRANSITIONS: Record<OrderStatus, Edge[]> = {
  DRAFT: [e("PENDING_PAYMENT", ["SYSTEM"]), e("COMPLIANCE_PENDING", ["SYSTEM"]), e("CANCELLED", ["SYSTEM", "CUSTOMER"])],
  PENDING_PAYMENT: [e("PAYMENT_AUTHORIZED", ["SYSTEM"]), e("PAYMENT_FAILED", ["SYSTEM"]), e("CANCELLED", ["SYSTEM", "CUSTOMER", "STAFF"], "orders.update")],
  PAYMENT_FAILED: [e("PENDING_PAYMENT", ["SYSTEM", "CUSTOMER"]), e("CANCELLED", ["SYSTEM", "CUSTOMER", "STAFF"], "orders.update")],
  PAYMENT_AUTHORIZED: [e("COMPLIANCE_PENDING", ["SYSTEM"]), e("READY_FOR_FULFILLMENT", ["SYSTEM"]), e("COMPLIANCE_REJECTED", ["SYSTEM"]), e("REFUND_PENDING", ["STAFF"], "orders.refund")],
  COMPLIANCE_PENDING: [
    e("DOCUMENTS_REQUIRED", ["SYSTEM", "STAFF"], "compliance.review"),
    e("DOCUMENTS_REVIEW", ["SYSTEM", "STAFF"], "compliance.review"),
    e("COMPLIANCE_APPROVED", ["STAFF"], "compliance.review"),
    e("COMPLIANCE_REJECTED", ["SYSTEM", "STAFF"], "compliance.review"),
    e("CANCELLED", ["SYSTEM", "CUSTOMER", "STAFF"], "orders.update"),
  ],
  DOCUMENTS_REQUIRED: [
    e("DOCUMENTS_REVIEW", ["SYSTEM", "STAFF"], "compliance.review"),
    // Approbation possible uniquement via dérogation explicite (contrôlée par le service de conformité).
    e("COMPLIANCE_APPROVED", ["STAFF"], "compliance.review"),
    e("COMPLIANCE_REJECTED", ["SYSTEM", "STAFF"], "compliance.review"),
    e("CANCELLED", ["SYSTEM", "CUSTOMER", "STAFF"], "orders.update"),
  ],
  DOCUMENTS_REVIEW: [
    e("DOCUMENTS_REQUIRED", ["SYSTEM", "STAFF"], "compliance.review"),
    e("COMPLIANCE_APPROVED", ["STAFF"], "compliance.review"),
    e("COMPLIANCE_REJECTED", ["STAFF"], "compliance.review"),
  ],
  COMPLIANCE_APPROVED: [e("READY_FOR_FULFILLMENT", ["SYSTEM"]), e("AWAITING_BALANCE", ["SYSTEM"])],
  AWAITING_BALANCE: [e("READY_FOR_FULFILLMENT", ["SYSTEM"]), e("CANCELLED", ["SYSTEM", "STAFF"], "orders.update"), e("REFUND_PENDING", ["SYSTEM", "STAFF"], "orders.refund")],
  COMPLIANCE_REJECTED: [e("REFUND_PENDING", ["SYSTEM", "STAFF"], "orders.refund"), e("CANCELLED", ["SYSTEM"])],
  READY_FOR_FULFILLMENT: [e("PREPARING", ["STAFF"], "orders.fulfil"), e("REFUND_PENDING", ["STAFF"], "orders.refund")],
  PREPARING: [e("SHIPPED", ["STAFF"], "orders.fulfil"), e("READY_FOR_FULFILLMENT", ["STAFF"], "orders.fulfil")],
  SHIPPED: [e("DELIVERED", ["CUSTOMER", "STAFF"], "orders.fulfil"), e("DELIVERY_FAILED", ["STAFF"], "orders.fulfil")],
  DELIVERY_FAILED: [e("SHIPPED", ["STAFF"], "orders.fulfil"), e("REFUND_PENDING", ["STAFF"], "orders.refund")],
  DELIVERED: [e("REFUND_PENDING", ["STAFF"], "orders.refund")],
  REFUND_PENDING: [e("REFUNDED", ["SYSTEM"])],
  CANCELLED: [],
  REFUNDED: [],
};

export const TERMINAL_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED"];

/** Statuts pendant lesquels l'animal / le stock restent réservés pour la commande. */
export const HOLDS_INVENTORY: OrderStatus[] = [
  "PENDING_PAYMENT", "PAYMENT_FAILED", "PAYMENT_AUTHORIZED", "COMPLIANCE_PENDING", "DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW",
  "COMPLIANCE_APPROVED", "AWAITING_BALANCE", "READY_FOR_FULFILLMENT", "PREPARING",
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].some((x) => x.to === to);
}

export function nextStatuses(from: OrderStatus, actor: Actor): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((x) => x.actors.includes(actor)).map((x) => x.to);
}

export interface TransitionContext {
  actor: Actor;
  hasPermission?: (p: Permission) => boolean;
  order: {
    status: OrderStatus;
    totalCents: number;
    amountPaidCents: number;
    amountRefundedCents: number;
    containsAnimals: boolean;
    shippingMethod: ShippingMethod;
    paymentStrategy: PaymentStrategy;
    complianceApproved: boolean;
  };
  tracking?: { carrier?: string; number?: string };
  shipDayAllowed?: boolean;
}

/** Vérifie la transition, l'acteur, la permission et les invariants métier. Lève AppError sinon. */
export function assertTransition(to: OrderStatus, ctx: TransitionContext): void {
  const { order } = ctx;
  const edge = ORDER_TRANSITIONS[order.status].find((x) => x.to === to);
  if (!edge) throw new AppError("INVALID_TRANSITION", `Transition interdite : ${order.status} → ${to}.`, { from: order.status, to });
  if (!edge.actors.includes(ctx.actor)) throw new AppError("AUTHORIZATION_ERROR", "Action non autorisée pour ce type d'utilisateur.", { from: order.status, to });
  if (ctx.actor === "STAFF" && edge.permission && !ctx.hasPermission?.(edge.permission)) {
    throw new AppError("AUTHORIZATION_ERROR", "Permission insuffisante.", { permission: edge.permission });
  }
  // Invariants
  if (to === "READY_FOR_FULFILLMENT") {
    if (order.amountPaidCents < order.totalCents) throw new AppError("PAYMENT_ERROR", "La commande doit être intégralement encaissée avant préparation.");
    if (order.containsAnimals && !order.complianceApproved) throw new AppError("COMPLIANCE_ERROR", "La conformité doit être approuvée avant préparation.");
  }
  if (to === "SHIPPED") {
    if (order.shippingMethod !== "PICKUP" && (!ctx.tracking?.carrier || !ctx.tracking?.number)) {
      throw new AppError("VALIDATION_ERROR", "Transporteur et numéro de suivi obligatoires.");
    }
    if (ctx.shipDayAllowed === false) throw new AppError("COMPLIANCE_ERROR", "Expédition interdite ce jour pour au moins une espèce de la commande.");
  }
  if (to === "REFUNDED" && order.amountRefundedCents < order.amountPaidCents) {
    throw new AppError("CONFLICT", "Le remboursement n'est pas encore complet.");
  }
}
