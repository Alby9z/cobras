import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminTable } from "@/components/admin/table";
import { Pagination } from "@/components/pagination";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { animalStatusLabel, productTypeLabel } from "@/lib/labels";
import { formatPrice } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";
import type { AnimalStatus, ProductType } from "@/generated/prisma/enums";

export default async function AdminProducts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("products.read");
  const sp = await searchParams;
  const type = sp.type && sp.type in productTypeLabel ? (sp.type as ProductType) : undefined;
  const animalStatus = sp.animal && sp.animal in animalStatusLabel ? (sp.animal as AnimalStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ProductWhereInput = {
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { sku: { contains: sp.q, mode: "insensitive" } }, { animal: { identificationReference: { contains: sp.q, mode: "insensitive" } } }] } : {}),
    ...(type ? { type } : {}),
    ...(animalStatus ? { animal: { status: animalStatus } } : {}),
    ...(sp.alerte === "1" ? { type: { not: "ANIMAL" }, stockOnHand: { lte: 1 } } : {}),
  };
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { animal: { select: { status: true, species: { select: { commonName: true } } } }, category: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Produits & animaux" description={`${total} produit(s)`}>{can(user.role, "products.write") && <Button asChild><Link href="/admin/produits/nouveau">Nouveau produit</Link></Button>}</PageHeader>
      <form className="mb-4 flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">Recherche</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Nom, référence, identification" className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
        <select name="type" defaultValue={type ?? ""} aria-label="Type" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tous types</option>{Object.entries(productTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="animal" defaultValue={animalStatus ?? ""} aria-label="Statut animal" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tout statut animal</option>{Object.entries(animalStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="alerte" value="1" defaultChecked={sp.alerte === "1"} /> Stock faible</label>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Filtrer</button>
      </form>
      <AdminTable head={["Produit", "Type", "Espèce / catégorie", "Prix TTC", "Disponibilité", "Statut"]}>
        {products.map((p) => (
          <tr key={p.id}>
            <td><Link href={`/admin/produits/${p.id}`} className="font-semibold text-primary hover:underline">{p.name}</Link>{p.sku && <span className="block text-xs text-muted-foreground">{p.sku}</span>}</td>
            <td>{productTypeLabel[p.type]}</td>
            <td>{p.animal?.species.commonName ?? p.category?.name ?? "—"}</td>
            <td>{formatPrice(p.priceCents)}</td>
            <td>{p.animal ? <Badge tone={p.animal.status === "AVAILABLE" ? "success" : "muted"}>{animalStatusLabel[p.animal.status]}</Badge> : <span className={p.stockOnHand - p.stockReserved <= p.lowStockAlert ? "font-semibold text-danger" : ""}>{p.stockOnHand - p.stockReserved} dispo. ({p.stockReserved} rés.)</span>}</td>
            <td><Badge tone={p.status === "PUBLISHED" ? "success" : "muted"}>{p.status === "PUBLISHED" ? "Publié" : p.status === "DRAFT" ? "Brouillon" : "Archivé"}</Badge></td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 50))} basePath="/admin/produits" params={sp} />
    </>
  );
}
