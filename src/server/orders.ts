import "server-only";
import crypto from "node:crypto";
import type Stripe from "stripe";
import { db, nextSequence, type Tx } from "@/server/db";
import { stripe } from "@/server/stripe";
import { findValidCoupon, purchasableItems, type CartWithItems } from "@/server/cart-core";
import { evaluateOrder, loadActiveRules, missingDocumentTypes, toItemInput, customerDocuments } from "@/server/compliance";
import { allocateOrder, extendReservations, markDelivered, markPreparing, releaseOrder, reserveForOrder, shipOrder } from "@/server/inventory";
import { issueInvoice } from "@/server/invoices";
import { sendTemplate, flushAfterCommit, notifyAdmin } from "@/server/email";
import { enqueue } from "@/server/queue";
import { audit } from "@/server/audit";
import { getContext } from "@/server/context";
import { getSettings, intSetting } from "@/server/settings";
import { assertSalesReady } from "@/server/readiness";
import { log } from "@/server/logger";
import { evaluatePurchaseEligibility } from "@/lib/domain/eligibility";
import { assertTransition, type Actor as ActorKind } from "@/lib/domain/order-state";
import { computeTotals } from "@/lib/domain/pricing";
import { resolvePaymentStrategy } from "@/lib/domain/payment-strategy";
import { can } from "@/lib/domain/permissions";
import { AppError } from "@/lib/domain/errors";
import { siteUrl } from "@/lib/utils";
import { orderStatusLabel, paymentStrategyLabel } from "@/lib/labels";
import type { OrderStatus, PaymentKind, PaymentStrategy, Role } from "@/generated/prisma/enums";
import type { Order, Prisma } from "@/generated/prisma/client";

// ═════════════════════════ Acteurs & transitions ═════════════════════════

export type ServiceActor =
  | { kind: "SYSTEM" }
  | { kind: "CUSTOMER"; user: { id: string; role: Role } }
  | { kind: "STAFF"; user: { id: string; role: Role } };

export const SYSTEM: ServiceActor = { kind: "SYSTEM" };
const actorUser = (a: ServiceActor) => (a.kind === "SYSTEM" ? null : a.user);
const actorKind = (a: ServiceActor): ActorKind => a.kind;

async function paidCapturedFully(o: Order) {
  return o.amountPaidCents >= o.totalCents;
}

/**
 * Applique une transition validée par le domaine, avec verrou optimiste (version) :
 * deux traitements concurrents ne peuvent pas appliquer deux transitions sur la même version.
 */
export async function transition(tx: Tx, orderId: string, to: OrderStatus, actor: ServiceActor, opts: { message?: string; internal?: boolean; tracking?: { carrier?: string; number?: string }; shipDayAllowed?: boolean; notify?: boolean } = {}) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { complianceCase: { select: { status: true } } } });
  assertTransition(to, {
    actor: actorKind(actor),
    hasPermission: (p) => actor.kind === "STAFF" && can(actor.user.role, p),
    order: {
      status: o.status, totalCents: o.totalCents, amountPaidCents: o.amountPaidCents, amountRefundedCents: o.amountRefundedCents,
      containsAnimals: o.containsAnimals, shippingMethod: o.shippingMethod, paymentStrategy: o.paymentStrategy,
      complianceApproved: o.complianceCase?.status === "APPROVED",
    },
    tracking: opts.tracking,
    shipDayAllowed: opts.shipDayAllowed,
  });
  if (actor.kind === "CUSTOMER" && o.userId !== actor.user.id) throw new AppError("RESOURCE_NOT_FOUND", "Commande introuvable.");
  const res = await tx.order.updateMany({ where: { id: orderId, version: o.version, status: o.status }, data: { status: to, version: { increment: 1 } } });
  if (!res.count) throw new AppError("CONFLICT", "La commande a été modifiée entre-temps. Rechargez la page.");
  const ctx = await getContext();
  const user = actorUser(actor);
  await tx.orderEvent.create({ data: { orderId, fromStatus: o.status, status: to, message: opts.message ?? orderStatusLabel[to], internal: opts.internal ?? false, actorId: user?.id ?? null, requestId: ctx.requestId } });
  await audit({ actor: user, action: `order.transition`, entity: "order", entityId: orderId, before: { status: o.status }, after: { status: to }, reason: opts.message }, tx);
  if (opts.notify !== false && !opts.internal) {
    await tx.notification.create({ data: { userId: o.userId, title: `Commande ${o.number}`, body: orderStatusLabel[to], href: `/compte/commandes/${o.number}` } });
  }
  return { ...o, status: to };
}

// ═════════════════════════ Checkout ═════════════════════════

export interface CheckoutInput {
  user: { id: string; role: Role; email: string };
  addressId: string;
  billingAddressId?: string | null;
  shippingRateId: string;
  note?: string;
  idempotencyKey: string;
  /** Panier de la requête (fourni par l'action serveur) — jamais de prix venant du navigateur. */
  cart: CartWithItems | null;
}

export interface CheckoutOutcome {
  orderNumber: string;
  redirectUrl: string;
}

const addressSnapshot = (a: { firstName: string; lastName: string; company: string | null; line1: string; line2: string | null; postalCode: string; city: string; country: string; phone: string }) =>
  ({ firstName: a.firstName, lastName: a.lastName, company: a.company, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.city, country: a.country, phone: a.phone });

export async function checkout(input: CheckoutInput): Promise<CheckoutOutcome> {
  // Idempotence : double clic, rechargement, réseau instable → même commande.
  const existing = await db.order.findUnique({ where: { userId_idempotencyKey: { userId: input.user.id, idempotencyKey: input.idempotencyKey } }, include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (existing) return { orderNumber: existing.number, redirectUrl: await resumeUrl(existing, existing.payments[0]?.stripeCheckoutId) };

  await assertSalesReady();
  const settings = await getSettings();
  const user = await db.user.findUniqueOrThrow({ where: { id: input.user.id } });
  const cart = input.cart;
  const items = cart ? purchasableItems(cart) : [];
  if (!cart || !items.length) throw new AppError("VALIDATION_ERROR", "Votre panier est vide.");
  if (items.length !== cart.items.length) throw new AppError("CONFLICT", "Un article de votre panier n'est plus disponible. Vérifiez votre panier.");

  for (const i of items) {
    if (!i.product.taxRate || !i.product.taxRate.active) throw new AppError("CONFIGURATION_ERROR", `Taux de TVA non configuré pour « ${i.product.name} ».`);
    if (i.product.type === "ANIMAL") {
      if (!i.product.animal) throw new AppError("CONFIGURATION_ERROR", `Fiche animal manquante pour « ${i.product.name} ».`);
      if (i.quantity !== 1) throw new AppError("VALIDATION_ERROR", "Un animal est un individu unique (quantité 1).");
    }
    if (i.product.stockOnHand - i.product.stockReserved < i.quantity) throw new AppError("OUT_OF_STOCK", `« ${i.product.name} » n'est plus disponible en quantité suffisante.`);
  }

  const address = await db.address.findFirst({ where: { id: input.addressId, userId: user.id } });
  const billing = input.billingAddressId ? await db.address.findFirst({ where: { id: input.billingAddressId, userId: user.id } }) : address;
  if (!address || !billing) throw new AppError("VALIDATION_ERROR", "Adresse introuvable.");
  const rate = await db.shippingRate.findFirst({ where: { id: input.shippingRateId, active: true } });
  if (!rate) throw new AppError("VALIDATION_ERROR", "Mode de livraison indisponible.");
  if (rate.method !== "PICKUP" && !rate.countries.includes(address.country)) throw new AppError("VALIDATION_ERROR", "Ce mode de livraison ne dessert pas le pays de votre adresse.");

  // Conformité (recalculée côté serveur, jamais reçue du navigateur)
  const eligibility = evaluatePurchaseEligibility({
    stage: "CHECKOUT",
    customer: { birthDate: user.birthDate, emailVerified: user.emailVerified },
    destination: { country: address.country, postalCode: address.postalCode },
    shippingMethod: rate.method,
    items: items.map((i) => toItemInput(i.product)),
    documents: await customerDocuments(db, user.id),
    rules: await loadActiveRules(),
  });
  if (!eligibility.allowed) throw new AppError("COMPLIANCE_ERROR", eligibility.reasons.map((r) => r.message).join(" "), { reasons: eligibility.reasons.map((r) => r.code) });

  // Stratégie de paiement
  const containsAnimals = items.some((i) => i.product.type === "ANIMAL");
  const defaultAnimals = settings.paymentStrategyAnimals as PaymentStrategy | undefined;
  if (containsAnimals && !defaultAnimals) throw new AppError("CONFIGURATION_ERROR", "Stratégie de paiement des animaux non configurée.");
  const strategy = resolvePaymentStrategy({
    lines: items.map((i) => ({ productType: i.product.type, paymentStrategy: i.product.paymentStrategy, depositPercent: i.product.depositPercent })),
    defaults: { animals: defaultAnimals ?? "PAY_IMMEDIATELY", other: "PAY_IMMEDIATELY" },
    reviewRequired: eligibility.humanReviewRequired,
  });

  // Montants
  const shippingTax = settings.vatRegime === "FRANCHISE" ? 0 : (await db.taxRate.findFirst({ where: { code: settings.shippingTaxRateCode ?? "", active: true } }))?.rateBps;
  if (shippingTax == null) throw new AppError("CONFIGURATION_ERROR", "Taux de TVA de la livraison non configuré.");
  const coupon = await findValidCoupon(cart.couponCode);
  const totals = computeTotals(
    items.map((i) => ({ key: i.id, productType: i.product.type, unitCents: i.product.priceCents, quantity: i.quantity, taxRateBps: i.product.taxRate!.rateBps, depositPercent: strategy.strategy === "DEPOSIT_THEN_BALANCE" ? i.product.depositPercent : null })),
    { priceCents: rate.priceCents, freeAboveCents: rate.freeAboveCents, taxRateBps: shippingTax },
    coupon,
  );
  const dueNow = strategy.chargeNow === "TOTAL" ? totals.totalCents : strategy.chargeNow === "DEPOSIT" ? Math.min(totals.totalCents, Math.max(50, totals.depositCents)) : 0;
  if (strategy.chargeNow !== "NOTHING" && dueNow < 50) throw new AppError("VALIDATION_ERROR", "Montant de commande trop faible.");

  const reservationMinutes = intSetting(settings, "reservationMinutes", 30, 30, 24 * 60);
  const holdHours = intSetting(settings, "complianceHoldHours", 72, 1, 24 * 30);
  const expiresAt = new Date(Date.now() + (strategy.chargeNow === "NOTHING" ? holdHours * 3600e3 : reservationMinutes * 60e3));

  let order: Order;
  try {
    order = await db.$transaction(async (tx) => {
      const seq = await nextSequence(tx, `order-${new Date().getUTCFullYear()}`);
      const created = await tx.order.create({
        data: {
          number: `CMD-${new Date().getUTCFullYear()}-${String(seq).padStart(6, "0")}`,
          userId: user.id, status: "DRAFT", idempotencyKey: input.idempotencyKey, paymentStrategy: strategy.strategy, containsAnimals,
          shippingAddress: addressSnapshot(address), billingAddress: addressSnapshot(billing),
          shippingCountry: address.country, shippingDepartment: eligibility.destination.department, shippingRegion: eligibility.destination.region,
          shippingMethod: rate.method, shippingRateName: rate.name,
          subtotalCents: totals.subtotalCents, discountCents: totals.discountCents,
          shippingCents: totals.shipping.totalCents, shippingExclTaxCents: totals.shipping.totalExclTaxCents, shippingTaxRateBps: totals.shipping.taxRateBps,
          totalExclTaxCents: totals.totalExclTaxCents, taxCents: totals.taxCents, totalCents: totals.totalCents, amountDueNowCents: dueNow,
          couponCode: totals.couponApplied, requiredDocuments: eligibility.requiredDocuments.map((d) => d.type), reservationExpiresAt: expiresAt,
          customerNote: input.note?.slice(0, 1000) || null,
          items: {
            create: items.map((i, idx) => ({
              productId: i.productId, animalId: i.product.animal?.id ?? null, productType: i.product.type, name: i.product.name, sku: i.product.sku,
              speciesName: i.product.animal?.species.scientificName ?? null, quantity: i.quantity, unitCents: i.product.priceCents,
              taxRateBps: totals.lines[idx].taxRateBps, discountCents: totals.lines[idx].discountCents,
              totalExclTaxCents: totals.lines[idx].totalExclTaxCents, taxCents: totals.lines[idx].taxCents, totalCents: totals.lines[idx].totalCents,
            })),
          },
          events: { create: { status: "DRAFT", message: `Commande créée — ${paymentStrategyLabel[strategy.strategy]}.` } },
        },
      });
      await reserveForOrder(tx, created, items.map((i) => ({ productId: i.productId, productName: i.product.name, animalId: i.product.animal?.id ?? null, quantity: i.quantity })), expiresAt, input.user);
      if (containsAnimals || eligibility.humanReviewRequired) await evaluateOrder(tx, created.id, "CHECKOUT");

      if (strategy.chargeNow === "NOTHING") {
        // Paiement après validation : la commande entre directement en conformité.
        await transition(tx, created.id, "COMPLIANCE_PENDING", SYSTEM, { message: "Commande enregistrée : vérification réglementaire avant paiement." });
        const missing = missingDocumentTypes(eligibility);
        await transition(tx, created.id, missing.length ? "DOCUMENTS_REQUIRED" : "DOCUMENTS_REVIEW", SYSTEM, { notify: false });
        if (cart.userId) await tx.cart.delete({ where: { id: cart.id } });
        if (totals.couponApplied) await consumeCoupon(tx, totals.couponApplied);
        await sendTemplate("ORDER_CREATED", user.email, { number: created.number, totalCents: created.totalCents, strategyText: "Aucun paiement n'a été effectué : nous vérifions d'abord la conformité de votre commande, puis nous vous envoyons un lien de paiement." }, { dedupeKey: `order:${created.id}:created`, userId: user.id, orderId: created.id }, tx);
        if (missing.length) await sendTemplate("DOCUMENT_REQUIRED", user.email, { number: created.number, documents: missing }, { dedupeKey: `order:${created.id}:docs:1`, userId: user.id, orderId: created.id }, tx);
      } else {
        await transition(tx, created.id, "PENDING_PAYMENT", SYSTEM, { notify: false });
      }
      await audit({ actor: input.user, action: "order.create", entity: "order", entityId: created.id, after: { number: created.number, strategy: strategy.strategy, total: created.totalCents, warnings: strategy.warnings } }, tx);
      return created;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const again = await db.order.findUnique({ where: { userId_idempotencyKey: { userId: input.user.id, idempotencyKey: input.idempotencyKey } } });
      if (again) return { orderNumber: again.number, redirectUrl: await resumeUrl(again) };
    }
    throw e;
  }
  await flushAfterCommit();

  if (strategy.chargeNow === "NOTHING") return { orderNumber: order.number, redirectUrl: siteUrl(`/commande/merci?commande=${order.number}`) };

  try {
    const url = await createPaymentSession(order.id, strategy.chargeNow === "DEPOSIT" ? "DEPOSIT" : "FULL", dueNow, { manualCapture: strategy.captureManually });
    return { orderNumber: order.number, redirectUrl: url };
  } catch (e) {
    log.error("checkout.stripe_session_failed", { orderId: order.id, error: e });
    await cancelOrder(order.id, SYSTEM, "Échec de création du paiement.");
    throw new AppError("EXTERNAL_SERVICE_ERROR", "Le paiement est momentanément indisponible. Réessayez dans quelques minutes.");
  }
}

async function resumeUrl(order: Order, checkoutId?: string) {
  if (order.status === "PENDING_PAYMENT" && checkoutId) {
    try {
      const s = await stripe().checkout.sessions.retrieve(checkoutId);
      if (s.status === "open" && s.url) return s.url;
    } catch { /* session inaccessible : page commande */ }
  }
  return siteUrl(`/compte/commandes/${order.number}`);
}

async function consumeCoupon(tx: Tx, code: string) {
  // Incrément conditionnel : la contrainte coupon_usage empêche tout dépassement de maxUses.
  const n = await tx.$executeRaw`UPDATE coupon SET "usedCount" = "usedCount" + 1 WHERE code = ${code} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
  if (!n) log.warn("coupon.max_uses_reached_after_checkout", { code });
}

// ═════════════════════════ Paiements (Stripe) ═════════════════════════

const KIND_LABEL: Record<PaymentKind, string> = { FULL: "paiement", DEPOSIT: "acompte", BALANCE: "solde" };

/** Crée une session Stripe Checkout. Le paiement ne sera considéré comme reçu que via webhook / vérification serveur. */
export async function createPaymentSession(orderId: string, kind: PaymentKind, amountCents: number, opts: { manualCapture: boolean; expiresInSeconds?: number }) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true } });
  const paymentId = crypto.randomUUID();
  const expires = Math.min(opts.expiresInSeconds ?? 30 * 60, 23 * 3600);
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      locale: "fr",
      customer_email: order.user.email,
      client_reference_id: order.id,
      line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: amountCents, product_data: { name: `Commande ${order.number} — ${KIND_LABEL[kind]}`, description: "Le détail figure sur votre facture." } } }],
      payment_intent_data: {
        capture_method: opts.manualCapture ? "manual" : "automatic",
        metadata: { orderId: order.id, paymentId, kind },
        description: `Commande ${order.number} (${KIND_LABEL[kind]})`,
      },
      metadata: { orderId: order.id, paymentId, kind },
      expires_at: Math.floor(Date.now() / 1000) + Math.max(expires, 30 * 60),
      success_url: siteUrl(`/commande/merci?session_id={CHECKOUT_SESSION_ID}`),
      cancel_url: siteUrl(`/compte/commandes/${order.number}`),
    },
    { idempotencyKey: `checkout:${paymentId}` },
  );
  await db.payment.create({ data: { id: paymentId, orderId: order.id, kind, amountCents, manualCapture: opts.manualCapture, stripeCheckoutId: session.id } });
  return session.url!;
}

/** Le client relance un paiement échoué ou abandonné tant que la réservation est active. */
export async function retryPayment(orderNumber: string, user: { id: string; role: Role }) {
  const order = await db.order.findFirst({ where: { number: orderNumber, userId: user.id } });
  if (!order) throw new AppError("RESOURCE_NOT_FOUND", "Commande introuvable.");
  const live = await db.stockReservation.count({ where: { orderId: order.id, status: { in: ["ACTIVE", "ALLOCATED"] } } });
  if (!live) throw new AppError("CONFLICT", "La réservation a expiré : la commande ne peut plus être payée.");

  if (order.status === "PAYMENT_FAILED" || order.status === "PENDING_PAYMENT") {
    const pending = await db.payment.findFirst({ where: { orderId: order.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    if (pending) {
      const s = await stripe().checkout.sessions.retrieve(pending.stripeCheckoutId).catch(() => null);
      if (s?.status === "open" && s.url) return s.url;
    }
    if (order.status === "PAYMENT_FAILED") {
      await db.$transaction((tx) => transition(tx, order.id, "PENDING_PAYMENT", { kind: "CUSTOMER", user }, { message: "Nouvelle tentative de paiement.", notify: false }));
    }
    const kind: PaymentKind = order.paymentStrategy === "DEPOSIT_THEN_BALANCE" ? "DEPOSIT" : "FULL";
    return createPaymentSession(order.id, kind, order.amountDueNowCents, { manualCapture: order.paymentStrategy === "AUTHORIZE_THEN_CAPTURE" });
  }
  if (order.status === "AWAITING_BALANCE") {
    const due = order.totalCents - order.amountPaidCents;
    if (due <= 0) throw new AppError("CONFLICT", "Aucun montant restant dû.");
    const pending = await db.payment.findFirst({ where: { orderId: order.id, kind: "BALANCE", status: "PENDING" }, orderBy: { createdAt: "desc" } });
    if (pending) {
      const s = await stripe().checkout.sessions.retrieve(pending.stripeCheckoutId).catch(() => null);
      if (s?.status === "open" && s.url) return s.url;
    }
    return createPaymentSession(order.id, "BALANCE", due, { manualCapture: false, expiresInSeconds: 23 * 3600 });
  }
  throw new AppError("CONFLICT", "Aucun paiement n'est attendu pour cette commande.");
}

async function findPaymentForIntent(pi: Stripe.PaymentIntent) {
  const byPi = await db.payment.findUnique({ where: { stripePaymentIntentId: pi.id } });
  if (byPi) return byPi;
  const id = pi.metadata?.paymentId;
  if (!id) return null;
  const p = await db.payment.findUnique({ where: { id } });
  if (p && !p.stripePaymentIntentId) await db.payment.update({ where: { id: p.id }, data: { stripePaymentIntentId: pi.id } });
  return p;
}

/** Point d'entrée unique : applique l'état réel du PaymentIntent (vérifié auprès de Stripe). */
export async function applyPaymentIntent(piOrId: Stripe.PaymentIntent | string) {
  const pi = await stripe().paymentIntents.retrieve(typeof piOrId === "string" ? piOrId : piOrId.id, { expand: ["latest_charge"] });
  const payment = await findPaymentForIntent(pi);
  if (!payment) {
    log.warn("stripe.unknown_payment_intent", { paymentIntent: pi.id });
    return;
  }
  switch (pi.status) {
    case "requires_capture":
      return onAuthorized(payment.id, pi);
    case "succeeded":
      return onSucceeded(payment.id, pi);
    case "canceled":
      return onCanceled(payment.id, pi);
    case "requires_payment_method":
      if (pi.last_payment_error) return onFailed(payment.id, pi);
      return;
    default:
      return;
  }
}

async function onAuthorized(paymentId: string, pi: Stripe.PaymentIntent) {
  await db.$transaction(async (tx) => {
    const upd = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "AUTHORIZED", authorizedAt: new Date(), authorizationExpiresAt: authExpiry(pi), stripePaymentIntentId: pi.id } });
    if (!upd.count) return; // déjà traité (webhook dupliqué ou concurrent)
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await tx.order.update({ where: { id: payment.orderId }, data: { amountAuthorizedCents: { increment: payment.amountCents } } });
    await afterFirstPayment(tx, payment.orderId, payment.id, false);
  });
  await flushAfterCommit();
  await settleRejectedIfNeeded(paymentId);
}

function authExpiry(pi: Stripe.PaymentIntent) {
  // Stripe expose la date limite de capture sur la charge ; à défaut, 7 jours (autorisation carte en ligne).
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  const capBefore = (charge?.payment_method_details?.card as { capture_before?: number } | undefined)?.capture_before;
  return new Date(capBefore ? capBefore * 1000 : Date.now() + 7 * 24 * 3600e3);
}

async function onSucceeded(paymentId: string, pi: Stripe.PaymentIntent) {
  let invoiceId: string | null = null;
  await db.$transaction(async (tx) => {
    const before = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const upd = await tx.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status: "SUCCEEDED", capturedAt: new Date(), stripePaymentIntentId: pi.id } });
    if (!upd.count) return;
    const order = await tx.order.update({
      where: { id: before.orderId },
      data: { amountPaidCents: { increment: before.amountCents }, ...(before.status === "AUTHORIZED" ? { amountAuthorizedCents: { decrement: before.amountCents } } : {}) },
      include: { user: true },
    });
    const hasDeposit = await tx.invoice.count({ where: { orderId: order.id, kind: "DEPOSIT_INVOICE" } });
    const invoiceKind = before.kind === "DEPOSIT" ? "DEPOSIT_INVOICE" : before.kind === "BALANCE" && hasDeposit ? "BALANCE_INVOICE" : "INVOICE";
    const inv = await issueInvoice(tx, { kind: invoiceKind, orderId: order.id, paymentId: before.id, amountCents: before.amountCents });
    invoiceId = inv.id;
    await sendTemplate("PAYMENT_SUCCESS", order.user.email, { number: order.number, amountCents: before.amountCents, authorized: false }, { dedupeKey: `payment:${before.id}:success`, userId: order.userId, orderId: order.id }, tx);

    if (before.status === "PENDING" && before.kind !== "BALANCE") {
      await afterFirstPayment(tx, order.id, before.id, true);
    } else if (before.kind === "BALANCE" && order.status === "AWAITING_BALANCE") {
      await allocateOrder(tx, order, null);
      await extendReservations(tx, order.id, null);
      await transition(tx, order.id, "READY_FOR_FULFILLMENT", SYSTEM, { message: "Paiement reçu : commande prête à être préparée." });
    }
  });
  await flushAfterCommit();
  if (invoiceId) await enqueue("invoice.pdf", { invoiceId, emailAfter: true }, { jobId: `invoice-${invoiceId}` }).catch(() => undefined);
  await settleRejectedIfNeeded(paymentId);
}

/** Premier paiement (intégral, acompte ou autorisation) : attribution du stock puis contrôle réglementaire. */
async function afterFirstPayment(tx: Tx, orderId: string, paymentId: string, captured: boolean) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true } });
  if (order.status !== "PENDING_PAYMENT" && order.status !== "PAYMENT_FAILED") return; // déjà avancée
  if (order.status === "PAYMENT_FAILED") await transition(tx, orderId, "PENDING_PAYMENT", SYSTEM, { notify: false, internal: true });
  await allocateOrder(tx, order, null);
  await transition(tx, orderId, "PAYMENT_AUTHORIZED", SYSTEM, { message: captured ? "Paiement reçu." : "Paiement autorisé (non encore prélevé)." });
  if (order.couponCode) await consumeCoupon(tx, order.couponCode);
  await tx.cart.deleteMany({ where: { userId: order.userId } });
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!captured) await sendTemplate("PAYMENT_SUCCESS", order.user.email, { number: order.number, amountCents: payment.amountCents, authorized: true }, { dedupeKey: `payment:${paymentId}:authorized`, userId: order.userId, orderId }, tx);
  await sendTemplate("ORDER_CREATED", order.user.email, { number: order.number, totalCents: order.totalCents, strategyText: order.containsAnimals ? "Votre commande entre en vérification réglementaire." : "Votre commande va être préparée." }, { dedupeKey: `order:${orderId}:created`, userId: order.userId, orderId }, tx);

  const result = await evaluateOrder(tx, orderId, "PAYMENT");
  if (!result.allowed) {
    await transition(tx, orderId, "COMPLIANCE_REJECTED", SYSTEM, { message: `Contrôle automatique négatif : ${result.reasons.map((r) => r.message).join(" ")}` });
    await tx.complianceCase.update({ where: { orderId }, data: { status: "REJECTED", decidedAt: new Date(), justification: "Contrôle automatique négatif après paiement." } });
    await releaseOrder(tx, order, "Refus de conformité", null);
    return;
  }
  if (order.containsAnimals || result.humanReviewRequired) {
    await transition(tx, orderId, "COMPLIANCE_PENDING", SYSTEM, { notify: false });
    const missing = missingDocumentTypes(result);
    await transition(tx, orderId, missing.length ? "DOCUMENTS_REQUIRED" : "DOCUMENTS_REVIEW", SYSTEM);
    await tx.complianceCase.update({ where: { orderId }, data: { status: missing.length ? "AWAITING_DOCUMENTS" : "IN_REVIEW" } });
    if (missing.length) await sendTemplate("DOCUMENT_REQUIRED", order.user.email, { number: order.number, documents: missing }, { dedupeKey: `order:${orderId}:docs:1`, userId: order.userId, orderId }, tx);
    return;
  }
  const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (await paidCapturedFully(fresh)) await transition(tx, orderId, "READY_FOR_FULFILLMENT", SYSTEM, { message: "Commande prête à être préparée." });
}

/** Après un refus automatique post-paiement : annulation de l'autorisation ou remboursement (hors transaction). */
async function settleRejectedIfNeeded(paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!p || p.order.status !== "COMPLIANCE_REJECTED") return;
  await settleRejection(p.orderId, SYSTEM, "Commande non conforme (contrôle automatique).");
}

async function onFailed(paymentId: string, pi: Stripe.PaymentIntent) {
  await db.$transaction(async (tx) => {
    const upd = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED", failureCode: pi.last_payment_error?.code ?? null, failureMessage: pi.last_payment_error?.message?.slice(0, 300) ?? null } });
    if (!upd.count) return;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { include: { user: true } } } });
    if (p.order.status === "PENDING_PAYMENT") {
      await transition(tx, p.orderId, "PAYMENT_FAILED", SYSTEM, { message: "Le paiement n'a pas abouti." });
      await sendTemplate("PAYMENT_FAILED", p.order.user.email, { number: p.order.number }, { dedupeKey: `payment:${paymentId}:failed`, userId: p.order.userId, orderId: p.orderId }, tx);
    }
  });
  await flushAfterCommit();
}

async function onCanceled(paymentId: string, pi: Stripe.PaymentIntent) {
  await db.$transaction(async (tx) => {
    const before = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const upd = await tx.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status: "CANCELED", stripePaymentIntentId: pi.id } });
    if (!upd.count) return;
    if (before.status === "AUTHORIZED") await tx.order.update({ where: { id: before.orderId }, data: { amountAuthorizedCents: { decrement: before.amountCents } } });
    await tx.orderEvent.create({ data: { orderId: before.orderId, message: `Autorisation de paiement annulée ou expirée (${pi.cancellation_reason ?? "raison non précisée"}).`, internal: true } });
  });
}

export async function onCheckoutExpired(session: Stripe.Checkout.Session) {
  const payment = await db.payment.findUnique({ where: { stripeCheckoutId: session.id } });
  if (!payment) return;
  const upd = await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "EXPIRED" } });
  if (!upd.count || payment.kind === "BALANCE") return;
  const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  const other = await db.payment.count({ where: { orderId: order.id, status: { in: ["PENDING", "AUTHORIZED", "SUCCEEDED"] } } });
  if (!other && (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED")) {
    await cancelOrder(order.id, SYSTEM, "Paiement non finalisé dans le délai : commande annulée, réservation libérée.");
  }
}

// ═════════════════════════ Conformité : décisions ═════════════════════════

type Staff = { id: string; role: Role };
const staff = (u: Staff): ServiceActor => ({ kind: "STAFF", user: u });

export async function requestDocuments(orderId: string, actor: Staff, message: string) {
  await db.$transaction(async (tx) => {
    const o = await transition(tx, orderId, "DOCUMENTS_REQUIRED", staff(actor), { message });
    await tx.complianceCase.update({ where: { orderId }, data: { status: "AWAITING_DOCUMENTS" } });
    const res = await evaluateOrder(tx, orderId, "REVIEW", { actorId: actor.id });
    const user = await tx.user.findUniqueOrThrow({ where: { id: o.userId } });
    const count = await tx.orderEvent.count({ where: { orderId, status: "DOCUMENTS_REQUIRED" } });
    await sendTemplate("DOCUMENT_REQUIRED", user.email, { number: o.number, documents: missingDocumentTypes(res), message }, { dedupeKey: `order:${orderId}:docs:${count}`, userId: o.userId, orderId }, tx);
  });
  await flushAfterCommit();
}

/** Réévalue les commandes d'un client après un changement documentaire (dépôt analysé, validation, refus). */
export async function onCustomerDocumentsChanged(userId: string) {
  const orders = await db.order.findMany({ where: { userId, status: { in: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW"] } }, select: { id: true, status: true } });
  for (const o of orders) {
    try {
      await db.$transaction(async (tx) => {
        const r = await evaluateOrder(tx, o.id, "REVIEW");
        const stillMissing = r.requiredDocuments.some((d) => d.status === "MISSING" || d.status === "EXPIRED" || d.status === "REJECTED");
        if (o.status === "DOCUMENTS_REQUIRED" && !stillMissing) {
          await transition(tx, o.id, "DOCUMENTS_REVIEW", SYSTEM, { message: "Documents reçus : vérification en cours." });
          await tx.complianceCase.update({ where: { orderId: o.id }, data: { status: "IN_REVIEW" } });
        } else if (o.status === "DOCUMENTS_REVIEW" && stillMissing) {
          await transition(tx, o.id, "DOCUMENTS_REQUIRED", SYSTEM, { message: "Un document doit être renouvelé." });
          await tx.complianceCase.update({ where: { orderId: o.id }, data: { status: "AWAITING_DOCUMENTS" } });
        }
      });
    } catch (e) {
      log.warn("compliance.reevaluation_failed", { orderId: o.id, error: e });
    }
  }
}

/**
 * Approbation humaine. Réévaluation obligatoire au stade DECISION ; si des contrôles échouent,
 * seule une dérogation explicite (compliance.override + justification) permet de poursuivre.
 */
export async function approveCompliance(orderId: string, actor: Staff, input: { justification: string; override?: boolean }) {
  if (input.justification.trim().length < 10) throw new AppError("VALIDATION_ERROR", "Justification obligatoire (10 caractères minimum).");
  await db.$transaction(async (tx) => {
    const result = await evaluateOrder(tx, orderId, "DECISION", { actorId: actor.id });
    const failed = result.reasons.map((r) => r.code);
    if (failed.length) {
      if (!input.override) throw new AppError("COMPLIANCE_ERROR", "Des contrôles ne sont pas satisfaits.", { reasons: failed });
      if (!can(actor.role, "compliance.override")) throw new AppError("AUTHORIZATION_ERROR", "Dérogation non autorisée pour votre rôle.");
      if (input.justification.trim().length < 30) throw new AppError("VALIDATION_ERROR", "Une dérogation exige une justification détaillée (30 caractères minimum).");
    }
    await transition(tx, orderId, "COMPLIANCE_APPROVED", staff(actor), { message: "Conformité approuvée." });
    await tx.complianceCase.update({
      where: { orderId },
      data: { status: "APPROVED", decidedById: actor.id, decidedAt: new Date(), justification: input.justification, overridden: failed.length > 0, overriddenChecks: failed },
    });
    await audit({ actor, action: failed.length ? "compliance.override_approve" : "compliance.approve", entity: "order", entityId: orderId, reason: input.justification, data: { ruleSetVersion: result.ruleSetVersion, overriddenChecks: failed } }, tx);
  });
  const kase = await db.complianceCase.findUnique({ where: { orderId } });
  if (kase?.overridden) {
    await notifyAdmin("Dérogation de conformité", [`Dossier n° ${kase.number}`, `Contrôles contournés : ${kase.overriddenChecks.join(", ")}`, `Justification : ${input.justification}`], `/admin/conformite/${orderId}`, `override:${orderId}`);
  }
  await settleAfterApproval(orderId, actor);
}

/** Encaissement après approbation, selon la stratégie de la commande. */
async function settleAfterApproval(orderId: string, actor: Staff) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true, payments: true } });
  const settings = await getSettings();
  const balanceHours = intSetting(settings, "balancePaymentHours", 48, 1, 24 * 14);

  if (order.paymentStrategy === "AUTHORIZE_THEN_CAPTURE") {
    const auth = order.payments.find((p) => p.status === "AUTHORIZED");
    if (auth?.stripePaymentIntentId) {
      try {
        const pi = await stripe().paymentIntents.capture(auth.stripePaymentIntentId, {}, { idempotencyKey: `capture:${auth.id}` });
        await applyPaymentIntent(pi);
      } catch (e) {
        log.warn("payment.capture_failed", { orderId, error: e });
      }
    }
  }
  const fresh = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: true } });
  if (fresh.status !== "COMPLIANCE_APPROVED") return; // déjà avancée par la capture
  if (fresh.amountPaidCents >= fresh.totalCents) {
    await db.$transaction((tx) => transition(tx, orderId, "READY_FOR_FULFILLMENT", SYSTEM, { message: "Conformité approuvée : commande prête à être préparée." }));
    await sendTemplate("COMPLIANCE_APPROVED", fresh.user.email, { number: fresh.number, next: "Votre commande va maintenant être préparée." }, { dedupeKey: `order:${orderId}:approved`, userId: fresh.userId, orderId });
    return;
  }
  // Solde ou paiement intégral à effectuer (acompte, paiement après validation, autorisation expirée).
  const due = fresh.totalCents - fresh.amountPaidCents;
  const expiresAt = new Date(Date.now() + balanceHours * 3600e3);
  await db.$transaction(async (tx) => {
    await transition(tx, orderId, "AWAITING_BALANCE", SYSTEM, { message: `Paiement de ${(due / 100).toFixed(2).replace(".", ",")} € attendu.` });
    await extendReservations(tx, orderId, expiresAt);
    await tx.order.update({ where: { id: orderId }, data: { reservationExpiresAt: expiresAt } });
  });
  const url = await createPaymentSession(orderId, "BALANCE", due, { manualCapture: false, expiresInSeconds: Math.min(balanceHours, 23) * 3600 });
  await sendTemplate("BALANCE_DUE", fresh.user.email, { number: fresh.number, amountCents: due, url, expiresText: `Votre réservation est conservée jusqu'au ${expiresAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}.` }, { dedupeKey: `order:${orderId}:balance:${fresh.version}`, userId: fresh.userId, orderId });
  void actor;
}

export async function rejectCompliance(orderId: string, actor: Staff, reason: string) {
  if (reason.trim().length < 10) throw new AppError("VALIDATION_ERROR", "Motif obligatoire (10 caractères minimum), communiqué au client.");
  await db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await evaluateOrder(tx, orderId, "DECISION", { actorId: actor.id });
    await transition(tx, orderId, "COMPLIANCE_REJECTED", staff(actor), { message: `Conformité refusée : ${reason}` });
    await tx.complianceCase.update({ where: { orderId }, data: { status: "REJECTED", decidedById: actor.id, decidedAt: new Date(), justification: reason } });
    await releaseOrder(tx, o, "Refus de conformité", actor);
    await audit({ actor, action: "compliance.reject", entity: "order", entityId: orderId, reason }, tx);
  });
  await settleRejection(orderId, staff(actor), reason);
}

/** Refus : annule les autorisations, rembourse les montants encaissés, clôture la commande. */
async function settleRejection(orderId: string, actor: ServiceActor, reason: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, user: true } });
  for (const p of order.payments.filter((x) => x.status === "AUTHORIZED" && x.stripePaymentIntentId)) {
    try {
      const pi = await stripe().paymentIntents.cancel(p.stripePaymentIntentId!, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: `cancel:${p.id}` });
      await applyPaymentIntent(pi);
    } catch (e) {
      log.error("payment.cancel_authorization_failed", { paymentId: p.id, error: e });
    }
  }
  const fresh = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const refundable = fresh.amountPaidCents - fresh.amountRefundedCents;
  if (refundable > 0) {
    // Conséquence automatique du refus : transition système (le refus lui-même est tracé au nom de l'agent).
    await db.$transaction((tx) => transition(tx, orderId, "REFUND_PENDING", SYSTEM, { message: "Remboursement en cours." }));
    await refundOrder(orderId, refundable, reason, actor);
  } else {
    await db.$transaction((tx) => transition(tx, orderId, "CANCELLED", SYSTEM, { message: "Commande annulée (aucun montant prélevé)." }));
  }
  await sendTemplate("COMPLIANCE_REJECTED", order.user.email, {
    number: order.number, reason,
    refundText: refundable > 0 ? "Le montant réglé vous est intégralement remboursé." : "Aucun montant ne vous sera prélevé.",
  }, { dedupeKey: `order:${orderId}:rejected`, userId: order.userId, orderId });
}

// ═════════════════════════ Remboursements ═════════════════════════

/**
 * Remboursement sérialisé par commande (verrou consultatif PostgreSQL) : deux demandes simultanées
 * ne peuvent pas dépasser le montant remboursable. Stripe reçoit une clé d'idempotence par tranche.
 */
export async function refundOrder(orderId: string, amountCents: number, reason: string, actor: ServiceActor) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AppError("VALIDATION_ERROR", "Montant invalide.");
  const user = actorUser(actor);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${orderId}`}))`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { where: { status: "SUCCEEDED" }, include: { refunds: true, invoices: true }, orderBy: { createdAt: "desc" } }, user: true } });
    const refundable = order.amountPaidCents - order.amountRefundedCents;
    if (amountCents > refundable) throw new AppError("CONFLICT", `Montant remboursable maximum : ${(refundable / 100).toFixed(2).replace(".", ",")} €.`);
    let remaining = amountCents;
    for (const p of order.payments) {
      if (remaining <= 0) break;
      const already = p.refunds.reduce((s, r) => s + r.amountCents, 0);
      const part = Math.min(remaining, p.amountCents - already);
      if (part <= 0 || !p.stripePaymentIntentId) continue;
      const r = await stripe().refunds.create({ payment_intent: p.stripePaymentIntentId, amount: part, metadata: { orderId, paymentId: p.id } }, { idempotencyKey: `refund:${p.id}:${already}:${part}` });
      const existing = await tx.refund.findUnique({ where: { stripeRefundId: r.id } });
      const refund = existing ?? (await tx.refund.create({ data: { paymentId: p.id, amountCents: part, reason: reason.slice(0, 500), stripeRefundId: r.id, status: r.status ?? "pending", createdById: user?.id ?? null } }));
      if (!existing) {
        await tx.order.update({ where: { id: orderId }, data: { amountRefundedCents: { increment: part } } });
        const credited = p.invoices.find((i) => i.kind !== "CREDIT_NOTE");
        const note = await issueInvoice(tx, { kind: "CREDIT_NOTE", orderId, refundId: refund.id, amountCents: part, creditedInvoiceId: credited?.id });
        await enqueue("invoice.pdf", { invoiceId: note.id, emailAfter: false }, { jobId: `invoice-${note.id}` }).catch(() => undefined);
      }
      remaining -= part;
    }
    await audit({ actor: user, action: "order.refund", entity: "order", entityId: orderId, reason, data: { amountCents } }, tx);
    await sendTemplate("REFUND_CREATED", order.user.email, { number: order.number, amountCents, authorizationCanceled: false }, { dedupeKey: `order:${orderId}:refund:${order.amountRefundedCents}:${amountCents}`, userId: order.userId, orderId }, tx);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (fresh.status === "REFUND_PENDING" && fresh.amountRefundedCents >= fresh.amountPaidCents) {
      await transition(tx, orderId, "REFUNDED", SYSTEM, { message: "Commande intégralement remboursée." });
    } else {
      await tx.orderEvent.create({ data: { orderId, message: `Remboursement de ${(amountCents / 100).toFixed(2).replace(".", ",")} € : ${reason}`, actorId: user?.id ?? null } });
    }
  }, { timeout: 30_000 });
  await flushAfterCommit();
}

/** Remboursement intégral + clôture, à l'initiative de l'équipe (hors expédition en cours). */
export async function cancelAndRefund(orderId: string, actor: Staff, reason: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  await db.$transaction(async (tx) => {
    await transition(tx, orderId, "REFUND_PENDING", staff(actor), { message: `Annulation : ${reason}` });
    if (!["SHIPPED", "DELIVERED", "DELIVERY_FAILED"].includes(o.status)) await releaseOrder(tx, o, `Annulation : ${reason}`, actor);
  });
  await settleRejectionPayments(orderId, staff(actor), reason);
}

async function settleRejectionPayments(orderId: string, actor: ServiceActor, reason: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
  for (const p of order.payments.filter((x) => x.status === "AUTHORIZED" && x.stripePaymentIntentId)) {
    const pi = await stripe().paymentIntents.cancel(p.stripePaymentIntentId!, {}, { idempotencyKey: `cancel:${p.id}` }).catch(() => null);
    if (pi) await applyPaymentIntent(pi);
  }
  const fresh = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const refundable = fresh.amountPaidCents - fresh.amountRefundedCents;
  if (refundable > 0) await refundOrder(orderId, refundable, reason, actor);
  else if (fresh.status === "REFUND_PENDING") await db.$transaction((tx) => transition(tx, orderId, "REFUNDED", SYSTEM, { message: "Aucun montant à rembourser." }));
}

/** Synchronise les remboursements effectués hors plateforme (tableau de bord Stripe). */
export async function onChargeRefunded(charge: Stripe.Charge) {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;
  const payment = await db.payment.findUnique({ where: { stripePaymentIntentId: piId }, include: { invoices: true } });
  if (!payment) return;
  const list = await stripe().refunds.list({ payment_intent: piId, limit: 100 });
  for (const r of list.data) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${payment.orderId}`}))`;
      if (await tx.refund.findUnique({ where: { stripeRefundId: r.id } })) return;
      const refund = await tx.refund.create({ data: { paymentId: payment.id, amountCents: r.amount, reason: r.reason ?? "Remboursement effectué depuis Stripe", stripeRefundId: r.id, status: r.status ?? "succeeded" } });
      await tx.order.update({ where: { id: payment.orderId }, data: { amountRefundedCents: { increment: r.amount } } });
      const credited = payment.invoices.find((i) => i.kind !== "CREDIT_NOTE");
      const note = await issueInvoice(tx, { kind: "CREDIT_NOTE", orderId: payment.orderId, refundId: refund.id, amountCents: r.amount, creditedInvoiceId: credited?.id });
      await enqueue("invoice.pdf", { invoiceId: note.id, emailAfter: false }, { jobId: `invoice-${note.id}` }).catch(() => undefined);
      await tx.orderEvent.create({ data: { orderId: payment.orderId, message: `Remboursement Stripe synchronisé : ${(r.amount / 100).toFixed(2)} €.`, internal: true } });
    });
  }
}

// ═════════════════════════ Logistique ═════════════════════════

export async function prepareOrder(orderId: string, actor: Staff) {
  await db.$transaction(async (tx) => {
    const o = await transition(tx, orderId, "PREPARING", staff(actor));
    await markPreparing(tx, o, actor);
    await tx.order.update({ where: { id: orderId }, data: { preparedAt: new Date() } });
    const u = await tx.user.findUniqueOrThrow({ where: { id: o.userId } });
    await sendTemplate("ORDER_PREPARING", u.email, { number: o.number }, { dedupeKey: `order:${orderId}:preparing:${o.version}`, userId: o.userId, orderId }, tx);
  });
  await flushAfterCommit();
}

export async function shipOrderAction(orderId: string, actor: Staff, input: { carrier?: string; number?: string; url?: string; override?: string }) {
  await db.$transaction(async (tx) => {
    const r = await evaluateOrder(tx, orderId, "FULFILLMENT", { actorId: actor.id, shipDate: new Date() });
    const dayBlocked = r.reasons.some((x) => x.code === "SHIP_DAY_NOT_ALLOWED");
    const otherBlocks = r.reasons.filter((x) => x.code !== "SHIP_DAY_NOT_ALLOWED");
    if (otherBlocks.length) {
      if (!input.override || !can(actor.role, "compliance.override")) throw new AppError("COMPLIANCE_ERROR", `Expédition bloquée : ${otherBlocks.map((x) => x.message).join(" ")}`, { reasons: otherBlocks.map((x) => x.code) });
      await audit({ actor, action: "compliance.override_ship", entity: "order", entityId: orderId, reason: input.override, data: { reasons: otherBlocks.map((x) => x.code) } }, tx);
    }
    const o = await transition(tx, orderId, "SHIPPED", staff(actor), { tracking: { carrier: input.carrier, number: input.number }, shipDayAllowed: !dayBlocked });
    await tx.order.update({ where: { id: orderId }, data: { shippedAt: new Date(), trackingCarrier: input.carrier || null, trackingNumber: input.number || null, trackingUrl: input.url || null } });
    await shipOrder(tx, o, actor);
    const u = await tx.user.findUniqueOrThrow({ where: { id: o.userId } });
    await sendTemplate("ORDER_SHIPPED", u.email, { number: o.number, carrier: input.carrier, tracking: input.number, trackingUrl: input.url, pickup: o.shippingMethod === "PICKUP" }, { dedupeKey: `order:${orderId}:shipped:${o.version}`, userId: o.userId, orderId }, tx);
  });
  await flushAfterCommit();
}

export async function confirmDelivery(orderId: string, actor: ServiceActor) {
  await db.$transaction(async (tx) => {
    const o = await transition(tx, orderId, "DELIVERED", actor, { message: actor.kind === "CUSTOMER" ? "Réception confirmée par le client." : "Livraison confirmée." });
    await tx.order.update({ where: { id: orderId }, data: { deliveredAt: new Date() } });
    await markDelivered(tx, o, actorUser(actor));
    const u = await tx.user.findUniqueOrThrow({ where: { id: o.userId } });
    await sendTemplate("ORDER_DELIVERED", u.email, { number: o.number }, { dedupeKey: `order:${orderId}:delivered`, userId: o.userId, orderId }, tx);
  });
  await flushAfterCommit();
}

export async function markDeliveryFailed(orderId: string, actor: Staff, note: string) {
  await db.$transaction((tx) => transition(tx, orderId, "DELIVERY_FAILED", staff(actor), { message: `Échec de livraison : ${note}` }));
}

export async function cancelOrder(orderId: string, actor: ServiceActor, reason: string) {
  await db.$transaction(async (tx) => {
    const o = await transition(tx, orderId, "CANCELLED", actor, { message: reason });
    await releaseOrder(tx, o, reason, actorUser(actor));
  });
  await flushAfterCommit();
}

// ═════════════════════════ Tâches planifiées ═════════════════════════

/** Libère les réservations expirées (paiement non effectué) et signale les soldes impayés. */
export async function expireReservations(now = new Date()) {
  const expired = await db.stockReservation.findMany({ where: { status: "ACTIVE", expiresAt: { lt: now } }, select: { orderId: true }, distinct: ["orderId"] });
  let cancelled = 0;
  for (const { orderId } of expired) {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { where: { status: "PENDING" } } } });
    try {
      if (["PENDING_PAYMENT", "PAYMENT_FAILED", "COMPLIANCE_PENDING", "DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW"].includes(o.status) && o.amountPaidCents === 0 && o.amountAuthorizedCents === 0) {
        for (const p of o.payments) await stripe().checkout.sessions.expire(p.stripeCheckoutId).catch(() => undefined);
        await cancelOrder(o.id, SYSTEM, "Réservation expirée : commande annulée.");
        cancelled++;
      }
    } catch (e) {
      log.warn("reservations.expire_failed", { orderId, error: e });
    }
  }
  const overdue = await db.order.findMany({ where: { status: "AWAITING_BALANCE", reservationExpiresAt: { lt: now } }, select: { id: true, number: true } });
  for (const o of overdue) await notifyAdmin(`Solde impayé — ${o.number}`, ["Le délai de paiement du solde est dépassé. Décidez de l'annulation et du sort de l'acompte selon vos CGV."], `/admin/commandes/${o.id}`, `balance-overdue:${o.id}`);
  return { cancelled, overdue: overdue.length };
}

export type { Prisma };
