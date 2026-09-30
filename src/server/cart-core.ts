import "server-only";
import { db } from "@/server/db";
import { computeTotals, type CouponRule, type PriceLine, type ShippingRule } from "@/lib/domain/pricing";
import type { Prisma } from "@/generated/prisma/client";

/** Panier — partie sans dépendance à la requête HTTP (utilisable par le worker et les tests). */
export const cartInclude = {
  items: {
    orderBy: { id: "asc" },
    include: {
      product: {
        include: {
          images: { orderBy: { position: "asc" }, take: 1 },
          animal: { include: { species: true } },
          taxRate: true,
        },
      },
    },
  },
} as const;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export async function findValidCoupon(code: string | null | undefined): Promise<(CouponRule & { id: string }) | null> {
  if (!code) return null;
  const now = new Date();
  const c = await db.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!c || !c.active) return null;
  if (c.startsAt && c.startsAt > now) return null;
  if (c.endsAt && c.endsAt < now) return null;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return null;
  return { id: c.id, code: c.code, type: c.type, value: c.value, minOrderCents: c.minOrderCents, accessoriesOnly: c.accessoriesOnly };
}

/** Articles achetables (publiés, disponibles). Le prix est toujours relu en base, jamais reçu du navigateur. */
export function purchasableItems(cart: CartWithItems) {
  return cart.items.filter((i) => i.product.status === "PUBLISHED");
}

export function cartLines(cart: CartWithItems): PriceLine[] {
  return purchasableItems(cart).map((i) => ({
    key: i.id,
    productType: i.product.type,
    unitCents: i.product.priceCents,
    quantity: i.quantity,
    taxRateBps: i.product.taxRate?.rateBps ?? 0,
    depositPercent: i.product.depositPercent,
  }));
}

export async function cartTotals(cart: CartWithItems, shipping: ShippingRule | null) {
  const coupon = await findValidCoupon(cart.couponCode);
  return computeTotals(cartLines(cart), shipping, coupon);
}

export function cartCount(cart: CartWithItems | null) {
  return cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
}
