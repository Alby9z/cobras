"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getCart, cartTotals } from "@/server/cart";
import { getCurrentUser } from "@/server/session";
import { checkout } from "@/server/orders";
import { loadActiveRules, toItemInput, customerDocuments } from "@/server/compliance";
import { limited } from "@/server/rate-limit";
import { getSettings } from "@/server/settings";
import { evaluatePurchaseEligibility, type EligibilityResult } from "@/lib/domain/eligibility";
import { resolvePaymentStrategy } from "@/lib/domain/payment-strategy";
import { toActionError, type ActionState } from "@/lib/action-state";
import type { PaymentStrategy } from "@/generated/prisma/enums";

const input = z.object({
  addressId: z.string().min(1).max(40),
  billingAddressId: z.string().max(40).optional(),
  shippingRateId: z.string().min(1).max(40),
  note: z.string().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
});

export type CheckoutPreview =
  | { totals: Awaited<ReturnType<typeof cartTotals>>; eligibility: Pick<EligibilityResult, "reasons" | "requiredDocuments" | "decision" | "warnings">; strategy: PaymentStrategy; dueNowCents: number }
  | { error: string };

/** Aperçu recalculé côté serveur (montants, conformité, stratégie) à chaque changement de sélection. */
export async function previewCheckout(addressId: string, shippingRateId: string): Promise<CheckoutPreview> {
  const user = await getCurrentUser();
  if (!user) return { error: "Session expirée, reconnectez-vous." };
  if (typeof addressId !== "string" || typeof shippingRateId !== "string") return { error: "Sélection invalide." };
  const [cart, address, rate, settings] = await Promise.all([
    getCart(),
    db.address.findFirst({ where: { id: addressId, userId: user.id } }),
    db.shippingRate.findFirst({ where: { id: shippingRateId, active: true } }),
    getSettings(),
  ]);
  if (!cart || !cart.items.length) return { error: "Votre panier est vide." };
  if (!address || !rate) return { error: "Sélection invalide." };
  const result = evaluatePurchaseEligibility({
    stage: "CHECKOUT",
    customer: { birthDate: user.birthDate, emailVerified: user.emailVerified },
    destination: { country: address.country, postalCode: address.postalCode },
    shippingMethod: rate.method,
    items: cart.items.map((i) => toItemInput(i.product)),
    documents: await customerDocuments(db, user.id),
    rules: await loadActiveRules(),
  });
  if (rate.method !== "PICKUP" && !rate.countries.includes(address.country)) {
    result.reasons.push({ code: "SHIPPING_METHOD_NOT_ALLOWED", message: "Ce mode de livraison ne dessert pas le pays de votre adresse." });
  }
  const shippingTax = settings.vatRegime === "FRANCHISE" ? 0 : (await db.taxRate.findFirst({ where: { code: settings.shippingTaxRateCode ?? "", active: true } }))?.rateBps ?? 0;
  const strategy = resolvePaymentStrategy({
    lines: cart.items.map((i) => ({ productType: i.product.type, paymentStrategy: i.product.paymentStrategy, depositPercent: i.product.depositPercent })),
    defaults: { animals: (settings.paymentStrategyAnimals as PaymentStrategy) ?? "PAY_IMMEDIATELY", other: "PAY_IMMEDIATELY" },
    reviewRequired: result.humanReviewRequired,
  });
  const totals = await cartTotals(
    { ...cart, items: cart.items.map((i) => ({ ...i, product: { ...i.product, depositPercent: strategy.strategy === "DEPOSIT_THEN_BALANCE" ? i.product.depositPercent : null } })) },
    { priceCents: rate.priceCents, freeAboveCents: rate.freeAboveCents, taxRateBps: shippingTax },
  );
  const dueNowCents = strategy.chargeNow === "TOTAL" ? totals.totalCents : strategy.chargeNow === "DEPOSIT" ? Math.min(totals.totalCents, Math.max(50, totals.depositCents)) : 0;
  return { totals, eligibility: { reasons: result.reasons, requiredDocuments: result.requiredDocuments, decision: result.decision, warnings: result.warnings }, strategy: strategy.strategy, dueNowCents };
}

export async function beginCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Session expirée, reconnectez-vous." };
  if (await limited("checkout", 10, 600)) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  const parsed = input.safeParse({ addressId: fd.get("addressId"), billingAddressId: fd.get("billingAddressId") || undefined, shippingRateId: fd.get("shippingRateId"), note: fd.get("note") || undefined, idempotencyKey: fd.get("idempotencyKey") });
  if (!parsed.success) return { error: "Choisissez une adresse et un mode de livraison." };
  if (fd.get("terms") !== "on") return { error: "Vous devez accepter les conditions générales de vente." };
  let url: string;
  try {
    const res = await checkout({ user, ...parsed.data, cart: await getCart() });
    url = res.redirectUrl;
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
