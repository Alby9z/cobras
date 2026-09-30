"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { getCart, findValidCoupon } from "@/server/cart";
import { getCurrentUser } from "@/server/session";
import { limited } from "@/server/rate-limit";
import { isAvailable } from "@/server/catalog";
import { search } from "@/server/search";
import type { ActionState } from "@/lib/action-state";

const idSchema = z.string().min(1).max(40);

export async function addToCart(_: ActionState, fd: FormData): Promise<ActionState> {
  const productId = idSchema.safeParse(fd.get("productId"));
  const qty = z.coerce.number().int().min(1).max(50).safeParse(fd.get("quantity") ?? 1);
  if (!productId.success || !qty.success) return { error: "Requête invalide." };
  if (await limited("cart", 60, 60)) return { error: "Trop de requêtes, patientez un instant." };

  const product = await db.product.findFirst({ where: { id: productId.data, status: "PUBLISHED" }, include: { animal: { include: { species: true } } } });
  if (!product) return { error: "Ce produit n'est plus disponible." };
  if (product.animal?.species.regulatoryCategory === "SALE_PROHIBITED") return { error: "La vente de cette espèce est interdite." };
  if (!isAvailable(product)) return { error: product.type === "ANIMAL" ? "Cet animal n'est plus disponible." : "Ce produit est en rupture de stock." };

  const cart = (await getCart(true))!;
  const existing = cart.items.find((i) => i.productId === product.id);
  const maxQty = product.type === "ANIMAL" ? 1 : product.stockOnHand - product.stockReserved;
  const wanted = (existing?.quantity ?? 0) + qty.data;
  const quantity = Math.min(maxQty, wanted);
  await db.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    create: { cartId: cart.id, productId: product.id, quantity },
    update: { quantity },
  });
  await db.cart.update({ where: { id: cart.id }, data: { reminderSentAt: null } });
  revalidatePath("/", "layout");
  if (product.type === "ANIMAL" && existing) return { ok: "Cet animal est déjà dans votre panier (individu unique)." };
  return { ok: quantity < wanted ? `Quantité limitée au stock disponible (${maxQty}).` : "Ajouté au panier." };
}

export async function updateCartItem(fd: FormData) {
  const itemId = idSchema.parse(fd.get("itemId"));
  const qty = z.coerce.number().int().min(0).max(50).parse(fd.get("quantity"));
  const cart = await getCart();
  const item = cart?.items.find((i) => i.id === itemId);
  if (!cart || !item) return;
  if (qty === 0) await db.cartItem.delete({ where: { id: item.id } });
  else {
    const max = item.product.type === "ANIMAL" ? 1 : Math.max(1, item.product.stockOnHand - item.product.stockReserved);
    await db.cartItem.update({ where: { id: item.id }, data: { quantity: Math.min(qty, max) } });
  }
  revalidatePath("/", "layout");
}

export async function applyCoupon(_: ActionState, fd: FormData): Promise<ActionState> {
  if (await limited("coupon", 10, 600)) return { error: "Trop de tentatives. Réessayez plus tard." };
  const code = z.string().trim().toUpperCase().max(40).safeParse(fd.get("code"));
  const cart = await getCart();
  if (!cart || !code.success) return { error: "Code invalide." };
  if (!code.data) {
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    revalidatePath("/panier");
    return { ok: "Code retiré." };
  }
  const coupon = await findValidCoupon(code.data);
  if (!coupon) return { error: "Ce code n'est pas valide ou a expiré." };
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: coupon.code } });
  revalidatePath("/panier");
  return { ok: "Code appliqué." };
}

export async function toggleWishlist(productId: string): Promise<{ saved: boolean } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "login" };
  const id = idSchema.parse(productId);
  const key = { userId_productId: { userId: user.id, productId: id } };
  const existing = await db.wishlistItem.findUnique({ where: key });
  if (existing) await db.wishlistItem.delete({ where: key });
  else await db.wishlistItem.create({ data: { userId: user.id, productId: id } });
  revalidatePath("/compte/favoris");
  return { saved: !existing };
}

/** Autocomplétion (recherche instantanée). */
export async function suggest(query: string) {
  if (typeof query !== "string" || query.length > 60) return [];
  if (await limited("search", 120, 60)) return [];
  return search.suggest(query);
}
