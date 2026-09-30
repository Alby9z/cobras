import "server-only";
import type { Tx } from "@/server/db";
import { getContext } from "@/server/context";
import { AppError } from "@/lib/domain/errors";
import type { AnimalStatus, InventoryMovementType } from "@/generated/prisma/enums";

/**
 * Inventaire : toutes les variations de stock passent par ce module.
 * Garanties :
 *  - mises à jour conditionnelles atomiques (UPDATE … WHERE disponible) : jamais de survente ;
 *  - index unique partiel en base : un animal n'a qu'une réservation vivante ;
 *  - chaque variation écrit un InventoryMovement immuable (avant / après / motif / acteur / référence).
 */

type Actor = { id: string } | null;

async function movement(tx: Tx, m: {
  productId: string; animalId?: string | null; type: InventoryMovementType; quantity: number;
  after: { stockOnHand: number; stockReserved: number }; onHandDelta: number; reservedDelta: number;
  reason: string; reference?: string | null; actor: Actor;
}) {
  const ctx = await getContext();
  await tx.inventoryMovement.create({
    data: {
      productId: m.productId, animalId: m.animalId ?? null, type: m.type, quantity: m.quantity,
      stockBefore: m.after.stockOnHand - m.onHandDelta, stockAfter: m.after.stockOnHand,
      reservedBefore: m.after.stockReserved - m.reservedDelta, reservedAfter: m.after.stockReserved,
      reason: m.reason, reference: m.reference ?? null, actorId: m.actor?.id ?? null, requestId: ctx.requestId,
    },
  });
}

async function animalStatus(tx: Tx, animalId: string, from: AnimalStatus[], to: AnimalStatus, note: string, reference: string | null, actor: Actor) {
  const res = await tx.animal.updateMany({ where: { id: animalId, status: { in: from } }, data: { status: to } });
  if (res.count === 0) return false;
  await tx.animalEvent.create({ data: { animalId, type: "STATUS_CHANGE", fromStatus: from.length === 1 ? from[0] : null, toStatus: to, note, reference, actorId: actor?.id ?? null } });
  return true;
}

export interface ReserveLine {
  productId: string;
  productName: string;
  animalId: string | null;
  quantity: number;
}

/** Réserve atomiquement le stock d'une commande. Lève OUT_OF_STOCK si un article n'est plus disponible. */
export async function reserveForOrder(tx: Tx, order: { id: string; number: string }, lines: ReserveLine[], expiresAt: Date | null, actor: Actor) {
  for (const l of lines) {
    if (l.animalId) {
      const ok = await animalStatus(tx, l.animalId, ["AVAILABLE"], "RESERVED", "Réservé pour commande", order.number, actor);
      if (!ok) throw new AppError("OUT_OF_STOCK", `« ${l.productName} » vient d'être réservé par un autre client.`, { productId: l.productId });
    }
    const rows = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number }[]>`
      UPDATE product SET "stockReserved" = "stockReserved" + ${l.quantity}, "updatedAt" = now()
      WHERE id = ${l.productId} AND "stockOnHand" - "stockReserved" >= ${l.quantity}
      RETURNING "stockOnHand", "stockReserved"`;
    if (!rows.length) throw new AppError("OUT_OF_STOCK", `Stock insuffisant pour « ${l.productName} ».`, { productId: l.productId });
    await tx.stockReservation.create({ data: { orderId: order.id, productId: l.productId, animalId: l.animalId, quantity: l.quantity, expiresAt } });
    await movement(tx, { productId: l.productId, animalId: l.animalId, type: "RESERVATION", quantity: l.quantity, after: rows[0], onHandDelta: 0, reservedDelta: l.quantity, reason: "Réservation commande", reference: order.number, actor });
  }
}

/** Le paiement est reçu / autorisé : la réservation devient une attribution (sans expiration). */
export async function allocateOrder(tx: Tx, order: { id: string; number: string }, actor: Actor) {
  const res = await tx.stockReservation.findMany({ where: { orderId: order.id, status: "ACTIVE" } });
  for (const r of res) {
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: "ALLOCATED", expiresAt: null } });
    if (r.animalId) await animalStatus(tx, r.animalId, ["RESERVED"], "ALLOCATED", "Paiement reçu", order.number, actor);
    const p = await tx.product.findUniqueOrThrow({ where: { id: r.productId }, select: { stockOnHand: true, stockReserved: true } });
    await movement(tx, { productId: r.productId, animalId: r.animalId, type: "ALLOCATION", quantity: 0, after: p, onHandDelta: 0, reservedDelta: 0, reason: "Attribution après paiement", reference: order.number, actor });
  }
}

/** Prolonge (ou fixe) l'échéance des réservations vivantes d'une commande. */
export async function extendReservations(tx: Tx, orderId: string, expiresAt: Date | null) {
  await tx.stockReservation.updateMany({ where: { orderId, status: { in: ["ACTIVE", "ALLOCATED"] } }, data: { expiresAt } });
}

/** Libère toutes les réservations vivantes d'une commande (annulation, refus, expiration). */
export async function releaseOrder(tx: Tx, order: { id: string; number: string }, reason: string, actor: Actor) {
  const res = await tx.stockReservation.findMany({ where: { orderId: order.id, status: { in: ["ACTIVE", "ALLOCATED"] } } });
  for (const r of res) {
    const upd = await tx.stockReservation.updateMany({ where: { id: r.id, status: { in: ["ACTIVE", "ALLOCATED"] } }, data: { status: "RELEASED", releasedAt: new Date() } });
    if (!upd.count) continue; // déjà libérée par un traitement concurrent
    const rows = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number }[]>`
      UPDATE product SET "stockReserved" = "stockReserved" - ${r.quantity}, "updatedAt" = now()
      WHERE id = ${r.productId} RETURNING "stockOnHand", "stockReserved"`;
    if (r.animalId) await animalStatus(tx, r.animalId, ["RESERVED", "ALLOCATED", "PREPARING"], "AVAILABLE", reason, order.number, actor);
    await movement(tx, { productId: r.productId, animalId: r.animalId, type: "RESERVATION_RELEASE", quantity: -r.quantity, after: rows[0], onHandDelta: 0, reservedDelta: -r.quantity, reason, reference: order.number, actor });
  }
}

export async function markPreparing(tx: Tx, order: { id: string; number: string }, actor: Actor) {
  const res = await tx.stockReservation.findMany({ where: { orderId: order.id, status: "ALLOCATED", animalId: { not: null } } });
  for (const r of res) await animalStatus(tx, r.animalId!, ["ALLOCATED"], "PREPARING", "Préparation", order.number, actor);
}

/** Expédition : sortie physique du stock. */
export async function shipOrder(tx: Tx, order: { id: string; number: string }, actor: Actor) {
  const res = await tx.stockReservation.findMany({ where: { orderId: order.id, status: "ALLOCATED" } });
  if (!res.length) throw new AppError("CONFLICT", "Aucune réservation attribuée pour cette commande.");
  for (const r of res) {
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: "CONSUMED" } });
    const rows = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number }[]>`
      UPDATE product SET "stockOnHand" = "stockOnHand" - ${r.quantity}, "stockReserved" = "stockReserved" - ${r.quantity}, "updatedAt" = now()
      WHERE id = ${r.productId} RETURNING "stockOnHand", "stockReserved"`;
    if (r.animalId) await animalStatus(tx, r.animalId, ["ALLOCATED", "PREPARING"], "SHIPPED", "Expédié", order.number, actor);
    await movement(tx, { productId: r.productId, animalId: r.animalId, type: "SHIPMENT", quantity: -r.quantity, after: rows[0], onHandDelta: -r.quantity, reservedDelta: -r.quantity, reason: "Expédition", reference: order.number, actor });
  }
}

export async function markDelivered(tx: Tx, order: { id: string; number: string }, actor: Actor) {
  const items = await tx.orderItem.findMany({ where: { orderId: order.id, animalId: { not: null } }, select: { animalId: true } });
  for (const i of items) await animalStatus(tx, i.animalId!, ["SHIPPED"], "SOLD", "Livré", order.number, actor);
}

/** Entrée / ajustement de stock (accessoires). Refuse un stock physique inférieur aux réservations. */
export async function adjustStock(tx: Tx, productId: string, delta: number, type: "RECEIPT" | "ADJUSTMENT" | "RETURN", reason: string, reference: string | null, actor: Actor) {
  if (!Number.isInteger(delta) || delta === 0) throw new AppError("VALIDATION_ERROR", "Quantité invalide.");
  const rows = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number }[]>`
    UPDATE product SET "stockOnHand" = "stockOnHand" + ${delta}, version = version + 1, "updatedAt" = now()
    WHERE id = ${productId} AND type <> 'ANIMAL' AND "stockOnHand" + ${delta} >= "stockReserved"
    RETURNING "stockOnHand", "stockReserved"`;
  if (!rows.length) throw new AppError("CONFLICT", "Ajustement impossible : le stock deviendrait inférieur aux quantités réservées.");
  await movement(tx, { productId, type, quantity: delta, after: rows[0], onHandDelta: delta, reservedDelta: 0, reason, reference, actor });
  return rows[0];
}

/** Changement de statut manuel d'un animal (disponible, quarantaine, indisponible). */
export async function setAnimalAvailability(tx: Tx, animalId: string, to: "AVAILABLE" | "QUARANTINED" | "UNAVAILABLE" | "RETURNED", note: string, actor: Actor) {
  const live = await tx.stockReservation.count({ where: { animalId, status: { in: ["ACTIVE", "ALLOCATED"] } } });
  if (live) throw new AppError("CONFLICT", "Cet animal est engagé dans une commande en cours.");
  const a = await tx.animal.findUniqueOrThrow({ where: { id: animalId } });
  if (["SHIPPED", "SOLD"].includes(a.status) && to !== "RETURNED") throw new AppError("CONFLICT", "Animal vendu : seul un retour peut être enregistré.");
  if (!(await animalStatus(tx, animalId, [a.status], to, note, null, actor))) throw new AppError("CONFLICT", "Le statut a été modifié entre-temps.");
  // Un animal disponible représente exactement une unité en stock.
  const onHand = to === "AVAILABLE" ? 1 : 0;
  const before = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { stockOnHand: true } });
  const rows = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number }[]>`
    UPDATE product SET "stockOnHand" = ${onHand}, "updatedAt" = now() WHERE id = ${a.productId} AND "stockReserved" = 0 RETURNING "stockOnHand", "stockReserved"`;
  if (rows.length) await movement(tx, { productId: a.productId, animalId, type: "STATUS_CHANGE", quantity: onHand - before.stockOnHand, after: rows[0], onHandDelta: onHand - before.stockOnHand, reservedDelta: 0, reason: `${a.status} → ${to} : ${note}`, reference: null, actor });
}
