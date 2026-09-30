"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { assertPermission } from "@/server/session";
import { audit } from "@/server/audit";
import {
  approveCompliance, cancelAndRefund, cancelOrder, confirmDelivery, markDeliveryFailed, prepareOrder, refundOrder, rejectCompliance, requestDocuments, shipOrderAction,
} from "@/server/orders";
import { reviewDocument } from "@/server/documents";
import { processStored } from "@/server/stripe-events";
import { toActionError, type ActionState } from "@/lib/action-state";

const id = z.string().min(1).max(60);
const text = (min: number, max = 2000) => z.string().trim().min(min).max(max);
const done = (orderId: string, ok: string): ActionState => {
  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath(`/admin/conformite/${orderId}`);
  revalidatePath("/admin/conformite");
  return { ok };
};

export async function approveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("compliance.review");
    const d = z.object({ orderId: id, justification: text(10), override: z.string().optional() }).parse(Object.fromEntries(fd));
    await approveCompliance(d.orderId, user, { justification: d.justification, override: d.override === "on" });
    return done(d.orderId, "Conformité approuvée. Encaissement / demande de solde traité selon la stratégie.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function rejectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("compliance.review");
    const d = z.object({ orderId: id, reason: text(10) }).parse(Object.fromEntries(fd));
    await rejectCompliance(d.orderId, user, d.reason);
    return done(d.orderId, "Commande refusée : autorisation annulée ou remboursement émis, client informé.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestDocumentsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("compliance.review");
    const d = z.object({ orderId: id, message: text(5) }).parse(Object.fromEntries(fd));
    await requestDocuments(d.orderId, user, d.message);
    return done(d.orderId, "Demande de documents envoyée au client.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function fulfilAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("orders.fulfil");
    const d = z.object({
      orderId: id, step: z.enum(["PREPARING", "SHIPPED", "DELIVERED", "DELIVERY_FAILED"]),
      carrier: z.string().trim().max(80).optional(), tracking: z.string().trim().max(80).optional(), trackingUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
      note: z.string().trim().max(1000).optional(), override: z.string().trim().max(1000).optional(),
    }).parse(Object.fromEntries(fd));
    if (d.step === "PREPARING") await prepareOrder(d.orderId, user);
    if (d.step === "SHIPPED") await shipOrderAction(d.orderId, user, { carrier: d.carrier, number: d.tracking, url: d.trackingUrl || undefined, override: d.override || undefined });
    if (d.step === "DELIVERED") await confirmDelivery(d.orderId, { kind: "STAFF", user });
    if (d.step === "DELIVERY_FAILED") await markDeliveryFailed(d.orderId, user, d.note || "non précisé");
    return done(d.orderId, "Commande mise à jour, client informé.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function refundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("orders.refund");
    const d = z.object({ orderId: id, amount: z.coerce.number().positive().max(1_000_000), reason: text(3, 500), full: z.string().optional() }).parse(Object.fromEntries(fd));
    if (d.full === "on") await cancelAndRefund(d.orderId, user, d.reason);
    else await refundOrder(d.orderId, Math.round(d.amount * 100), d.reason, { kind: "STAFF", user });
    return done(d.orderId, "Remboursement émis, avoir généré.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("orders.update");
    const d = z.object({ orderId: id, reason: text(5, 500) }).parse(Object.fromEntries(fd));
    await cancelOrder(d.orderId, { kind: "STAFF", user }, d.reason);
    return done(d.orderId, "Commande annulée, réservation libérée.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function noteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("orders.read");
    const d = z.object({ orderId: id, message: text(1), visible: z.string().optional() }).parse(Object.fromEntries(fd));
    const visible = d.visible === "on";
    if (visible && !["ADMIN", "SUPER_ADMIN", "SUPPORT_AGENT", "COMPLIANCE_MANAGER", "FULFILLMENT_MANAGER"].includes(user.role)) return { error: "Votre rôle ne permet pas d'écrire au client." };
    const order = await db.order.findUniqueOrThrow({ where: { id: d.orderId } });
    await db.orderEvent.create({ data: { orderId: order.id, message: d.message, internal: !visible, actorId: user.id } });
    if (visible) await db.notification.create({ data: { userId: order.userId, title: `Commande ${order.number}`, body: d.message.slice(0, 200), href: `/compte/commandes/${order.number}` } });
    await audit({ actor: user, action: visible ? "order.message_customer" : "order.internal_note", entity: "order", entityId: order.id });
    return done(order.id, visible ? "Message publié dans l'espace client." : "Note interne ajoutée.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviewDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("documents.review");
    const d = z.object({ documentId: id, decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional(), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")) }).parse(Object.fromEntries(fd));
    await reviewDocument(user, d.documentId, d.decision, d.note || null, d.expiresAt ? new Date(`${d.expiresAt}T00:00:00Z`) : null);
    revalidatePath("/admin/documents");
    revalidatePath("/admin/conformite", "layout");
    return { ok: d.decision === "APPROVED" ? "Document validé." : "Document refusé, client informé." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function replayStripeEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("orders.update");
    const eventId = z.string().startsWith("evt_").max(100).parse(fd.get("eventId"));
    const outcome = await processStored(eventId);
    await audit({ actor: user, action: "stripe_event.replay", entity: "stripe_event", entityId: eventId, data: { outcome } });
    revalidatePath("/admin/paiements");
    return outcome === "failed" ? { error: "Le traitement a de nouveau échoué : consultez l'erreur." } : { ok: `Événement rejoué : ${outcome}.` };
  } catch (e) {
    return toActionError(e);
  }
}
