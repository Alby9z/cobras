import "server-only";
import type Stripe from "stripe";
import { db } from "@/server/db";
import { applyPaymentIntent, onChargeRefunded, onCheckoutExpired } from "@/server/orders";
import { runWithContext } from "@/server/context";
import { log } from "@/server/logger";
import type { Prisma } from "@/generated/prisma/client";

const HANDLED = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired",
  "payment_intent.succeeded", "payment_intent.amount_capturable_updated", "payment_intent.payment_failed", "payment_intent.canceled",
  "charge.refunded",
]);

/**
 * Traitement d'un événement Stripe : enregistré avant traitement (rejouable), dédupliqué par id,
 * idempotent (chaque effet métier est conditionné à l'état courant), observable (statut, tentatives, erreur).
 */
export async function recordAndProcess(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored" | "failed"> {
  const inserted = await db.$executeRaw`
    INSERT INTO stripe_event (id, type, status, payload, attempts, "receivedAt")
    VALUES (${event.id}, ${event.type}, 'RECEIVED', ${JSON.stringify(event)}::jsonb, 0, now())
    ON CONFLICT (id) DO NOTHING`;
  if (!inserted) {
    const row = await db.stripeEvent.findUnique({ where: { id: event.id } });
    if (row?.status === "PROCESSED" || row?.status === "IGNORED") return "duplicate";
  }
  return processStored(event.id);
}

export async function processStored(eventId: string): Promise<"processed" | "ignored" | "failed" | "duplicate"> {
  // Verrou applicatif : un seul traitement simultané par événement.
  const claimed = await db.stripeEvent.updateMany({ where: { id: eventId, status: { in: ["RECEIVED", "FAILED"] } }, data: { attempts: { increment: 1 }, status: "PROCESSING" } });
  if (!claimed.count) return "duplicate";
  const row = await db.stripeEvent.findUniqueOrThrow({ where: { id: eventId } });
  const event = row.payload as unknown as Stripe.Event;
  if (!HANDLED.has(event.type)) {
    await db.stripeEvent.update({ where: { id: eventId }, data: { status: "IGNORED", processedAt: new Date() } });
    return "ignored";
  }
  try {
    await runWithContext({ requestId: `stripe:${event.id}`, source: "webhook" }, () => dispatch(event));
    await db.stripeEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null } });
    return "processed";
  } catch (e) {
    log.error("stripe.event_failed", { eventId, type: event.type, error: e });
    await db.stripeEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: (e as Error).message.slice(0, 1000) } });
    return "failed";
  }
}

async function dispatch(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      const s = event.data.object;
      // La redirection du navigateur n'est jamais une preuve : on relit l'état du PaymentIntent chez Stripe.
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (pi) await applyPaymentIntent(pi);
      return;
    }
    case "checkout.session.expired":
      return onCheckoutExpired(event.data.object);
    case "payment_intent.succeeded":
    case "payment_intent.amount_capturable_updated":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      return applyPaymentIntent(event.data.object.id);
    case "charge.refunded":
      return onChargeRefunded(event.data.object);
  }
}

export type { Prisma };
