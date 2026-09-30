/**
 * Calcul des montants — entiers uniquement (centimes, points de base).
 * Prix saisis TTC ; HT et TVA déduits ligne à ligne, arrondi au centime (demi supérieur).
 */
import type { CouponType, ProductType } from "@/generated/prisma/enums";

export interface PriceLine {
  key: string;
  productType: ProductType;
  unitCents: number; // TTC
  quantity: number;
  taxRateBps: number;
  depositPercent: number | null;
}

export interface CouponRule {
  code: string;
  type: CouponType;
  value: number;
  minOrderCents: number;
  accessoriesOnly: boolean;
}

export interface ShippingRule {
  priceCents: number; // TTC
  freeAboveCents: number | null;
  taxRateBps: number;
}

export interface LineResult {
  key: string;
  grossCents: number; // TTC avant remise
  discountCents: number;
  totalCents: number; // TTC après remise
  totalExclTaxCents: number;
  taxCents: number;
  taxRateBps: number;
}

export interface Totals {
  lines: LineResult[];
  subtotalCents: number;
  discountCents: number;
  shipping: { totalCents: number; totalExclTaxCents: number; taxCents: number; taxRateBps: number };
  totalCents: number;
  totalExclTaxCents: number;
  taxCents: number;
  vatBreakdown: { rateBps: number; baseCents: number; taxCents: number }[];
  depositCents: number; // part exigible immédiatement en stratégie acompte
  couponApplied: string | null;
  couponError: string | null;
}

/** HT = TTC / (1 + taux), arrondi au centime le plus proche (demi vers le haut). */
export function exclTax(inclCents: number, rateBps: number): number {
  return Math.floor((inclCents * 10000 * 2 + (10000 + rateBps)) / ((10000 + rateBps) * 2));
}

/** Répartit un montant proportionnellement (méthode du plus fort reste) — la somme est exacte. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map(Math.floor);
  let rest = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i]++;
    rest--;
  }
  return floors;
}

export function computeTotals(lines: PriceLine[], shipping: ShippingRule | null, coupon: CouponRule | null): Totals {
  for (const l of lines) {
    if (!Number.isInteger(l.unitCents) || l.unitCents < 0 || !Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error("Ligne invalide");
    if (!Number.isInteger(l.taxRateBps) || l.taxRateBps < 0 || l.taxRateBps > 10000) throw new Error("Taux invalide");
  }
  const gross = lines.map((l) => l.unitCents * l.quantity);
  const subtotalCents = gross.reduce((a, b) => a + b, 0);
  const eligible = lines.map((l, i) => (coupon?.accessoriesOnly && l.productType === "ANIMAL" ? 0 : gross[i]));
  const eligibleTotal = eligible.reduce((a, b) => a + b, 0);

  let discountCents = 0;
  let freeShipping = false;
  let couponApplied: string | null = null;
  let couponError: string | null = null;
  if (coupon) {
    if (subtotalCents < coupon.minOrderCents) couponError = `Ce code nécessite un minimum d'achat de ${(coupon.minOrderCents / 100).toFixed(2).replace(".", ",")} €.`;
    else if (eligibleTotal === 0) couponError = "Ce code ne s'applique à aucun article du panier.";
    else {
      couponApplied = coupon.code;
      if (coupon.type === "PERCENT") discountCents = Math.floor((eligibleTotal * Math.min(coupon.value, 100)) / 100);
      else if (coupon.type === "FIXED") discountCents = Math.min(coupon.value, eligibleTotal);
      else freeShipping = true;
    }
  }

  const discounts = allocate(discountCents, eligible);
  const lineResults: LineResult[] = lines.map((l, i) => {
    const totalCents = gross[i] - discounts[i];
    const ht = exclTax(totalCents, l.taxRateBps);
    return { key: l.key, grossCents: gross[i], discountCents: discounts[i], totalCents, totalExclTaxCents: ht, taxCents: totalCents - ht, taxRateBps: l.taxRateBps };
  });

  let shipTotal = shipping?.priceCents ?? 0;
  if (shipping?.freeAboveCents != null && subtotalCents - discountCents >= shipping.freeAboveCents) shipTotal = 0;
  if (freeShipping) shipTotal = 0;
  const shipRate = shipping?.taxRateBps ?? 0;
  const shipHt = exclTax(shipTotal, shipRate);
  const shippingRes = { totalCents: shipTotal, totalExclTaxCents: shipHt, taxCents: shipTotal - shipHt, taxRateBps: shipRate };

  const breakdown = new Map<number, { baseCents: number; taxCents: number }>();
  for (const r of [...lineResults, shippingRes]) {
    if (r.totalCents === 0) continue;
    const b = breakdown.get(r.taxRateBps) ?? { baseCents: 0, taxCents: 0 };
    b.baseCents += r.totalExclTaxCents;
    b.taxCents += r.taxCents;
    breakdown.set(r.taxRateBps, b);
  }
  const totalCents = lineResults.reduce((a, r) => a + r.totalCents, 0) + shipTotal;
  const taxCents = lineResults.reduce((a, r) => a + r.taxCents, 0) + shippingRes.taxCents;

  // Acompte : pourcentage appliqué aux lignes concernées (après remise) ; le reste et la livraison sont dus au solde.
  const depositCents = lines.reduce((s, l, i) => s + (l.depositPercent ? Math.ceil((lineResults[i].totalCents * l.depositPercent) / 100) : 0), 0);

  return {
    lines: lineResults,
    subtotalCents,
    discountCents,
    shipping: shippingRes,
    totalCents,
    totalExclTaxCents: totalCents - taxCents,
    taxCents,
    vatBreakdown: [...breakdown.entries()].sort((a, b) => a[0] - b[0]).map(([rateBps, v]) => ({ rateBps, ...v })),
    depositCents,
    couponApplied,
    couponError,
  };
}
