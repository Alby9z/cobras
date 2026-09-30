import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { Pagination } from "@/components/pagination";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate } from "@/lib/utils";
import type { InventoryMovementType } from "@/generated/prisma/enums";

const TYPES: InventoryMovementType[] = ["RECEIPT", "ADJUSTMENT", "RESERVATION", "RESERVATION_RELEASE", "ALLOCATION", "SHIPMENT", "RETURN", "STATUS_CHANGE"];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("products.read");
  const sp = await searchParams;
  const type = TYPES.find((t) => t === sp.type);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { ...(sp.produit ? { productId: sp.produit } : {}), ...(type ? { type } : {}), ...(sp.ref ? { reference: { contains: sp.ref } } : {}) };
  const [total, moves] = await Promise.all([
    db.inventoryMovement.count({ where }),
    db.inventoryMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100, include: { product: { select: { id: true, name: true } } } }),
  ]);
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.actorId).filter(Boolean) as string[])] } }, select: { id: true, email: true } });
  return (
    <>
      <PageHeader title="Mouvements de stock" description="Journal immuable : chaque réservation, attribution, expédition, réception ou ajustement, avec les quantités avant / après, le motif et l'auteur." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="type" defaultValue={type ?? ""} aria-label="Type" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tous types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <input name="ref" defaultValue={sp.ref} placeholder="Référence (n° commande…)" aria-label="Référence" className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
        {sp.produit && <input type="hidden" name="produit" value={sp.produit} />}
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Filtrer</button>
        <a download href={`/api/admin/export/inventaire${sp.produit ? `?produit=${encodeURIComponent(sp.produit)}` : ""}`} className="h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Exporter CSV</a>
      </form>
      <AdminTable head={["Date", "Produit", "Type", "Qté", "Stock", "Réservé", "Motif", "Réf.", "Auteur"]}>
        {moves.map((m) => (
          <tr key={m.id}>
            <td className="whitespace-nowrap">{formatDate(m.createdAt, { dateStyle: "short", timeStyle: "medium" })}</td>
            <td><Link href={`/admin/produits/${m.product.id}`} className="text-primary hover:underline">{m.product.name}</Link></td>
            <td>{m.type}</td>
            <td>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
            <td>{m.stockBefore} → {m.stockAfter}</td>
            <td>{m.reservedBefore} → {m.reservedAfter}</td>
            <td>{m.reason}</td>
            <td>{m.reference ?? "—"}</td>
            <td className="text-xs">{actors.find((a) => a.id === m.actorId)?.email ?? "système"}</td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 100))} basePath="/admin/inventaire" params={sp} />
    </>
  );
}
