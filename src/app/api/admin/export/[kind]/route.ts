import { assertPermission } from "@/server/session";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { apiRoute } from "@/server/api";
import { AppError } from "@/lib/domain/errors";
import type { Permission } from "@/lib/domain/permissions";
import type { OrderStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise l'injection de formules tableur (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");

const EXPORTS: Record<string, { perm: Permission; run: (url: URL) => Promise<unknown[][]> }> = {
  commandes: {
    perm: "orders.read",
    run: async (url) => {
      const status = url.searchParams.get("status") as OrderStatus | null;
      const rows = await db.order.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 10000, include: { user: { select: { email: true } } } });
      return [["Numéro", "Date", "Client", "Statut", "Stratégie", "Total HT", "TVA", "Total TTC", "Encaissé", "Remboursé"], ...rows.map((o) => [o.number, o.createdAt, o.user.email, o.status, o.paymentStrategy, (o.totalExclTaxCents / 100).toFixed(2), (o.taxCents / 100).toFixed(2), (o.totalCents / 100).toFixed(2), (o.amountPaidCents / 100).toFixed(2), (o.amountRefundedCents / 100).toFixed(2)])];
    },
  },
  factures: {
    perm: "invoices.read",
    run: async () => {
      const rows = await db.invoice.findMany({ orderBy: { issuedAt: "asc" }, take: 50000, include: { order: { select: { number: true } } } });
      return [["Numéro", "Type", "Date", "Commande", "Total HT", "TVA", "Total TTC", "Ventilation TVA"], ...rows.map((i) => [i.number, i.kind, i.issuedAt, i.order.number, (i.totalExclTaxCents / 100).toFixed(2), (i.taxCents / 100).toFixed(2), (i.totalCents / 100).toFixed(2), JSON.stringify(i.vatBreakdown)])];
    },
  },
  inventaire: {
    perm: "products.read",
    run: async (url) => {
      const productId = url.searchParams.get("produit");
      const rows = await db.inventoryMovement.findMany({ where: productId ? { productId } : {}, orderBy: { createdAt: "desc" }, take: 50000, include: { product: { select: { name: true, sku: true } } } });
      return [["Date", "Produit", "SKU", "Type", "Quantité", "Stock avant", "Stock après", "Réservé avant", "Réservé après", "Motif", "Référence", "Acteur"], ...rows.map((m) => [m.createdAt, m.product.name, m.product.sku, m.type, m.quantity, m.stockBefore, m.stockAfter, m.reservedBefore, m.reservedAfter, m.reason, m.reference, m.actorId])];
    },
  },
  audit: {
    perm: "audit.read",
    run: async () => {
      const rows = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50000 });
      return [["Date", "Acteur", "Rôle", "Action", "Entité", "ID", "Motif", "IP", "Request ID"], ...rows.map((l) => [l.createdAt, l.actorId, l.actorRole, l.action, l.entity, l.entityId, l.reason, l.ip, l.requestId])];
    },
  },
};

export const GET = apiRoute(async (req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const def = EXPORTS[(await params).kind];
  if (!def) throw new AppError("RESOURCE_NOT_FOUND", "Export inconnu.");
  const user = await assertPermission(def.perm);
  const rows = await def.run(new URL(req.url));
  await audit({ actor: user, action: "data.export", entity: (await params).kind, data: { rows: rows.length - 1 } });
  return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${(await params).kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
});
