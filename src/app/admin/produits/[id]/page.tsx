import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProductForm, StockAdjustForm, AnimalStatusForm, AnimalEventForm } from "@/components/admin/product-form";
import { ImageUpload } from "@/components/admin/image-upload";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { deleteProductImage, moveProductImage } from "@/server/actions/admin/catalog";
import { can } from "@/lib/domain/permissions";
import { animalStatusLabel } from "@/lib/labels";
import { formatDate, mediaUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.read");
  const { id } = await params;
  const isNew = id === "nouveau";
  if (isNew && !can(user.role, "products.write")) notFound();
  const [product, categories, species, taxRates] = await Promise.all([
    isNew ? null : db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } }, related: { include: { to: { select: { slug: true } } } },
        animal: { include: { events: { orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { email: true } } } } } },
        movements: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.species.findMany({ where: { regulatoryCategory: { not: "SALE_PROHIBITED" } }, orderBy: { commonName: "asc" }, select: { id: true, commonName: true, scientificName: true } }),
    db.taxRate.findMany({ where: { active: true }, orderBy: { rateBps: "desc" }, select: { id: true, name: true, rateBps: true } }),
  ]);
  if (!isNew && !product) notFound();
  const { animal, images, related, movements, ...plain } = product ?? ({} as NonNullable<typeof product>);
  const animalPlain = animal ? { ...animal, sizeCm: animal.sizeCm?.toString() ?? null, weightG: animal.weightG?.toString() ?? null, events: undefined } : null;

  return (
    <>
      <PageHeader title={isNew ? "Nouveau produit" : product!.name}>{product?.status === "PUBLISHED" && <Button asChild variant="outline"><Link href={`/produit/${product.slug}`} target="_blank">Voir sur le site</Link></Button>}</PageHeader>
      {taxRates.length === 0 && <Alert tone="warning" className="mb-4">Aucun taux de TVA actif : créez-en un dans « Taux de TVA ».</Alert>}
      {product && (
        <div className="mb-8 grid gap-6 xl:grid-cols-2">
          {animal ? (
            <Card>
              <h2 className="font-semibold">Statut de l&apos;animal : <Badge tone={animal.status === "AVAILABLE" ? "success" : "warning"}>{animalStatusLabel[animal.status]}</Badge></h2>
              <p className="mt-1 text-xs text-muted-foreground">Les statuts Réservé / Attribué / Préparation / Expédié / Vendu sont pilotés par les commandes.</p>
              {can(user.role, "animals.write") && <div className="mt-4"><AnimalStatusForm animalId={animal.id} /></div>}
              <h3 className="mt-6 text-sm font-semibold">Historique</h3>
              <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">{animal.events.map((e) => <li key={e.id}><span className="text-muted-foreground">{formatDate(e.createdAt, { dateStyle: "short", timeStyle: "short" })}</span> · {e.type}{e.toStatus ? ` → ${animalStatusLabel[e.toStatus]}` : ""} · {e.note}{e.reference ? ` (${e.reference})` : ""}{e.actor ? ` — ${e.actor.email}` : ""}</li>)}</ol>
              {can(user.role, "animals.write") && <div className="mt-4"><AnimalEventForm animalId={animal.id} /></div>}
            </Card>
          ) : (
            <Card>
              <h2 className="font-semibold">Stock : {product.stockOnHand} en stock · {product.stockReserved} réservé(s) · {product.stockOnHand - product.stockReserved} disponible(s)</h2>
              {can(user.role, "inventory.write") && <div className="mt-4"><StockAdjustForm productId={product.id} /></div>}
            </Card>
          )}
          <Card>
            <h2 className="mb-2 font-semibold">Derniers mouvements</h2>
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">{movements.map((m) => <li key={m.id}><span className="text-muted-foreground">{formatDate(m.createdAt, { dateStyle: "short", timeStyle: "short" })}</span> · {m.type} · {m.quantity > 0 ? "+" : ""}{m.quantity} · stock {m.stockBefore}→{m.stockAfter} · réservé {m.reservedBefore}→{m.reservedAfter} · {m.reason}{m.reference ? ` (${m.reference})` : ""}</li>)}</ul>
            <Link href={`/admin/inventaire?produit=${product.id}`} className="mt-3 inline-block text-sm text-primary underline">Tout le journal</Link>
          </Card>
        </div>
      )}
      {product && can(user.role, "products.write") && (
        <Card className="mb-8">
          <h2 className="mb-4 font-semibold">Photos</h2>
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {images.map((img, i) => (
              <li key={img.id} className="rounded-lg border border-border p-2 text-xs">
                <div className="relative aspect-square overflow-hidden rounded"><Image src={mediaUrl(img.storageKey)} alt={img.alt} fill sizes="160px" className="object-cover" /></div>
                <p className="mt-1 line-clamp-2">{img.alt}</p>
                <div className="mt-1 flex gap-2">
                  {i > 0 && <form action={moveProductImage}><input type="hidden" name="imageId" value={img.id} /><button className="underline">Principale</button></form>}
                  <form action={deleteProductImage}><input type="hidden" name="imageId" value={img.id} /><button className="text-danger underline">Supprimer</button></form>
                </div>
              </li>
            ))}
          </ul>
          <ImageUpload productId={product.id} />
        </Card>
      )}
      <Card>
        <ProductForm product={product ? { ...plain } : undefined} animal={animalPlain} categories={categories} species={species} taxRates={taxRates} relatedSlugs={related?.map((r) => r.to.slug).join(", ") ?? ""} canSeeInternal={can(user.role, "animals.write")} />
      </Card>
    </>
  );
}
