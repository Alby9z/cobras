import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/session";
import { cartInclude } from "@/server/cart-core";

export * from "@/server/cart-core";

const CART_COOKIE = "cart_token";

async function guestToken(create: boolean) {
  const jar = await cookies();
  let token = jar.get(CART_COOKIE)?.value;
  if (!token && create) {
    token = crypto.randomBytes(24).toString("base64url");
    jar.set(CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return token ?? null;
}

/** Panier courant ; fusionne le panier invité dans celui du compte après connexion. */
export async function getCart(create = false) {
  const user = await getCurrentUser();
  const token = await guestToken(false);

  if (user) {
    let cart = await db.cart.findUnique({ where: { userId: user.id }, include: cartInclude });
    if (token) {
      const guest = await db.cart.findUnique({ where: { guestToken: token }, include: { items: true } });
      if (guest && guest.id !== cart?.id) {
        if (!cart) {
          await db.cart.update({ where: { id: guest.id }, data: { userId: user.id, guestToken: null } });
        } else {
          for (const it of guest.items) {
            await db.cartItem.upsert({
              where: { cartId_productId: { cartId: cart.id, productId: it.productId } },
              create: { cartId: cart.id, productId: it.productId, quantity: it.quantity },
              update: {},
            });
          }
          await db.cart.delete({ where: { id: guest.id } });
        }
        (await cookies()).delete(CART_COOKIE);
        cart = await db.cart.findUnique({ where: { userId: user.id }, include: cartInclude });
      }
    }
    if (!cart && create) cart = await db.cart.create({ data: { userId: user.id }, include: cartInclude });
    return cart;
  }

  const t = await guestToken(create);
  if (!t) return null;
  let cart = await db.cart.findUnique({ where: { guestToken: t }, include: cartInclude });
  if (!cart && create) cart = await db.cart.create({ data: { guestToken: t }, include: cartInclude });
  return cart;
}


