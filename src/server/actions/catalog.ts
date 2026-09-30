"use server";
import { z } from "zod";
import { db } from "@/server/db";
import { cardSelect } from "@/server/catalog";

/** Données publiques de produits publiés (produits récemment consultés). */
export async function getPublishedCards(ids: string[]) {
  const parsed = z.array(z.string().max(40)).max(12).safeParse(ids);
  if (!parsed.success) return [];
  const rows = await db.product.findMany({ where: { id: { in: parsed.data }, status: "PUBLISHED" }, select: cardSelect });
  return parsed.data.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}
