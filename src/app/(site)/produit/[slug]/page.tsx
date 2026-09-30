import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ShieldCheck, Truck, AlertTriangle, FileText } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Gallery } from "@/components/gallery";
import { AddToCart, WishlistButton } from "@/components/add-to-cart";
import { ProductGrid } from "@/components/product-card";
import { RecentlyViewed, RememberView } from "@/components/recently-viewed";
import { TrackOnMount } from "@/components/analytics";
import { JsonLd } from "@/components/json-ld";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/server/db";
import { cardSelect, isAvailable } from "@/server/catalog";
import { loadActiveRules } from "@/server/compliance";
import { getCurrentUser } from "@/server/session";
import { documentTypeLabel, regulatoryCategoryLabel, sexLabel, shippingMethodLabel, animalOriginLabel } from "@/lib/labels";
import { formatDate, formatPrice, mediaUrl, siteUrl, ageOn } from "@/lib/utils";
import { renderRichText, plainText } from "@/lib/sanitize";
import type { DocumentType } from "@/generated/prisma/enums";

type Props = { params: Promise<{ slug: string }> };

// Sélection publique explicite : aucune donnée interne (identification, santé, emplacement, notes) n'est chargée.
const load = cache((slug: string) =>
  db.product.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      images: { orderBy: { position: "asc" } },
      category: { include: { parent: true } },
      related: { include: { to: { select: cardSelect } } },
      animal: {
        select: {
          id: true, status: true, subspecies: true, morph: true, sex: true, birthDate: true, sizeCm: true, weightG: true, origin: true, originDetails: true,
          careDifficulty: true, temperatureRange: true, humidityRange: true, diet: true, recommendedTerrarium: true, videoUrls: true,
          species: { select: { id: true, commonName: true, scientificName: true, regulatoryCategory: true, citesAnnex: true, regulatoryNotes: true, restrictionsNotes: true, shippingMethods: true, deliveryAvailable: true, transportConditions: true, careDifficulty: true, temperatureRange: true, humidityRange: true, diet: true, recommendedTerrarium: true } },
        },
      },
    },
  }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return {};
  const description = p.metaDescription ?? p.shortDescription ?? plainText(p.description);
  const image = p.images[0] ? mediaUrl(p.images[0].storageKey) : undefined;
  return {
    title: p.metaTitle ?? p.name,
    description,
    alternates: { canonical: `/produit/${p.slug}` },
    openGraph: { title: p.name, description, images: image ? [{ url: image, alt: p.images[0].alt }] : undefined, type: "website" },
    twitter: { card: "summary_large_image", title: p.name, description, images: image ? [image] : undefined },
  };
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (<div className="flex justify-between gap-4 border-b border-border py-2.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>);
}

function youtubeId(url: string) {
  return url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/)?.[1] ?? null;
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  db.product.update({ where: { id: p.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);

  const user = await getCurrentUser();
  const a = p.animal;
  const sp = a?.species;
  const [inWishlist, similar, rules] = await Promise.all([
    user ? db.wishlistItem.findUnique({ where: { userId_productId: { userId: user.id, productId: p.id } } }).then(Boolean) : false,
    db.product.findMany({
      where: { status: "PUBLISHED", id: { not: p.id }, OR: [...(sp ? [{ animal: { speciesId: sp.id } }] : []), ...(p.categoryId ? [{ categoryId: p.categoryId }] : [])] },
      orderBy: { soldCount: "desc" }, take: 4, select: cardSelect,
    }),
    sp ? loadActiveRules() : Promise.resolve([]),
  ]);

  // Documents : uniquement ceux exigés par les règles actives et validées applicables à cette espèce.
  const applicable = rules.filter((r) => (!r.productTypes.length || r.productTypes.includes("ANIMAL")) && (!r.speciesId || r.speciesId === sp?.id) && (!r.regulatoryCategory || r.regulatoryCategory === sp?.regulatoryCategory));
  const docs = [...new Set(applicable.filter((r) => r.type === "DOCUMENT_REQUIREMENT").flatMap((r) => r.requiredDocuments))] as DocumentType[];
  const minAge = Math.max(0, ...applicable.filter((r) => r.type === "AGE_REQUIREMENT").map((r) => r.minimumAge ?? 0));
  const geoNotes = applicable.filter((r) => r.type === "GEO_RESTRICTION" && r.customerMessage).map((r) => r.customerMessage!);
  const covered = applicable.some((r) => r.speciesId || r.regulatoryCategory);
  const available = isAvailable({ type: p.type, stockOnHand: p.stockOnHand, stockReserved: p.stockReserved, animal: a }) && sp?.regulatoryCategory !== "SALE_PROHIBITED" && (!a || covered);
  const promo = p.compareAtCents && p.compareAtCents > p.priceCents;
  const care = {
    difficulty: a?.careDifficulty ?? sp?.careDifficulty,
    temperature: a?.temperatureRange ?? sp?.temperatureRange,
    humidity: a?.humidityRange ?? sp?.humidityRange,
    diet: a?.diet ?? sp?.diet,
    terrarium: a?.recommendedTerrarium ?? sp?.recommendedTerrarium,
  };
  const related = p.related.map((r) => r.to);
  const age = a?.birthDate ? ageOn(a.birthDate) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 pb-28 sm:px-6 lg:pb-10">
      <RememberView id={p.id} />
      <TrackOnMount name="view_item" params={{ currency: "EUR", value: p.priceCents / 100, items: [{ item_id: p.id, item_name: p.name, price: p.priceCents / 100 }] }} />
      <Breadcrumbs items={[{ label: "Catalogue", href: "/catalogue" }, ...(p.category ? [{ label: p.category.name, href: `/categorie/${p.category.slug}` }] : []), { label: p.name }]} />

      <div className="grid gap-10 lg:grid-cols-2">
        <Gallery images={p.images.map((i) => ({ src: mediaUrl(i.storageKey), alt: i.alt }))} />
        <div>
          {sp && <p className="text-sm italic text-muted-foreground">{sp.scientificName}{a?.subspecies ? ` ${a.subspecies}` : ""}</p>}
          <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">{p.name}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {sp && <Badge tone={sp.regulatoryCategory === "SALE_ALLOWED" ? "success" : sp.regulatoryCategory === "SALE_PROHIBITED" ? "danger" : "warning"}>{regulatoryCategoryLabel[sp.regulatoryCategory]}</Badge>}
            {sp?.citesAnnex && <Badge tone="muted">CITES annexe {sp.citesAnnex}</Badge>}
            <Badge tone={available ? "success" : "muted"}>{available ? (a ? "Disponible" : `En stock (${p.stockOnHand - p.stockReserved})`) : a ? "Indisponible" : "Rupture de stock"}</Badge>
          </div>
          <p className="mt-6">
            <span className="text-3xl font-bold">{formatPrice(p.priceCents)}</span>
            <span className="ml-2 text-sm text-muted-foreground">TTC</span>
            {promo && <span className="ml-3 text-lg text-muted-foreground line-through">{formatPrice(p.compareAtCents!)}</span>}
          </p>
          {p.shortDescription && <p className="mt-4 text-muted-foreground">{p.shortDescription}</p>}
          {a && !covered && <p className="mt-4 rounded-lg bg-muted p-3 text-sm">La vente de cet animal n&apos;est pas encore ouverte : ses conditions réglementaires sont en cours de validation.</p>}

          <div className="mt-6 hidden space-y-3 lg:block">
            <AddToCart productId={p.id} name={p.name} priceCents={p.priceCents} available={available} maxQty={a ? 1 : p.stockOnHand - p.stockReserved} showQty={!a} />
            <WishlistButton productId={p.id} initial={inWishlist} />
          </div>

          {a && (
            <dl className="mt-8">
              <Row label="Espèce" value={sp?.commonName} />
              <Row label="Sous-espèce" value={a.subspecies} />
              <Row label="Phase / morph" value={a.morph} />
              <Row label="Sexe" value={sexLabel[a.sex]} />
              <Row label="Date de naissance" value={a.birthDate ? `${formatDate(a.birthDate)} (${age! < 1 ? "moins d'un an" : `${age} an${age! > 1 ? "s" : ""}`})` : null} />
              <Row label="Taille" value={a.sizeCm ? `${a.sizeCm} cm` : null} />
              <Row label="Poids" value={a.weightG ? `${a.weightG} g` : null} />
              <Row label="Origine" value={a.origin !== "UNKNOWN" ? [animalOriginLabel[a.origin], a.originDetails].filter(Boolean).join(" — ") : null} />
              <Row label="Référence" value={p.sku} />
            </dl>
          )}
          {!a && (p.brand || p.ean) && (
            <dl className="mt-8">
              <Row label="Marque" value={p.brand} />
              <Row label="EAN" value={p.ean} />
              <Row label="Dimensions" value={p.lengthMm && p.widthMm && p.heightMm ? `${p.lengthMm / 10} × ${p.widthMm / 10} × ${p.heightMm / 10} cm` : null} />
              <Row label="Référence" value={p.sku} />
            </dl>
          )}
        </div>
      </div>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="font-display text-2xl font-semibold">Description</h2>
          <div className="prose-content mt-4" dangerouslySetInnerHTML={{ __html: renderRichText(p.description) }} />
          {a && Object.values(care).some(Boolean) && (
            <section className="mt-10" aria-labelledby="care-title">
              <h2 id="care-title" className="font-display text-2xl font-semibold">Maintenance</h2>
              <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                <Row label="Difficulté" value={care.difficulty ? `${care.difficulty} / 5` : null} />
                <Row label="Température" value={care.temperature} />
                <Row label="Hygrométrie" value={care.humidity} />
                <Row label="Alimentation" value={care.diet} />
                <Row label="Terrarium recommandé" value={care.terrarium} />
              </dl>
            </section>
          )}
          {a && a.videoUrls.length > 0 && (
            <section className="mt-10" aria-labelledby="video-title">
              <h2 id="video-title" className="font-display text-2xl font-semibold">Vidéos</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {a.videoUrls.map((u) => {
                  const yt = youtubeId(u);
                  return yt ? <iframe key={u} title={`Vidéo — ${p.name}`} src={`https://www.youtube-nocookie.com/embed/${yt}`} loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-xl" />
                    : <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-primary underline">Voir la vidéo</a>;
                })}
              </div>
            </section>
          )}
        </div>

        {sp && (
          <aside className="space-y-4">
            <Card>
              <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Cadre réglementaire</h2>
              <p className="mt-2 text-sm">{regulatoryCategoryLabel[sp.regulatoryCategory]}</p>
              {sp.regulatoryNotes && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{sp.regulatoryNotes}</p>}
              {docs.length > 0 && (
                <>
                  <h3 className="mt-4 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4" aria-hidden /> Documents demandés</h3>
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{docs.map((d) => <li key={d}>{documentTypeLabel[d]}</li>)}</ul>
                  <p className="mt-2 text-xs text-muted-foreground">À déposer dans votre espace « Mes documents » ; l&apos;expédition n&apos;a lieu qu&apos;après validation par notre équipe.</p>
                </>
              )}
            </Card>
            {(sp.restrictionsNotes || minAge > 0 || geoNotes.length > 0) && (
              <Card>
                <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5 text-warning" aria-hidden /> Restrictions</h2>
                {minAge > 0 && <p className="mt-2 text-sm">Âge minimum de l&apos;acheteur : {minAge} ans.</p>}
                {geoNotes.map((n) => <p key={n} className="mt-2 text-sm">{n}</p>)}
                {sp.restrictionsNotes && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{sp.restrictionsNotes}</p>}
              </Card>
            )}
            <Card>
              <h2 className="flex items-center gap-2 font-semibold"><Truck className="h-5 w-5 text-primary" aria-hidden /> Transport</h2>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {(sp.deliveryAvailable ? sp.shippingMethods.filter((m) => m !== "STANDARD_PARCEL") : (["PICKUP"] as const)).map((m) => <li key={m}>{shippingMethodLabel[m]}</li>)}
              </ul>
              {sp.transportConditions && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{sp.transportConditions}</p>}
            </Card>
          </aside>
        )}
      </div>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="related-title">
          <h2 id="related-title" className="mb-6 font-display text-2xl font-semibold">{a ? "Équipement recommandé" : "Produits associés"}</h2>
          <ProductGrid products={related} />
        </section>
      )}
      {similar.length > 0 && (
        <section className="mt-16" aria-labelledby="similar-title">
          <h2 id="similar-title" className="mb-6 font-display text-2xl font-semibold">Vous aimerez aussi</h2>
          <ProductGrid products={similar} />
        </section>
      )}
      <RecentlyViewed exclude={p.id} />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <p className="shrink-0 text-lg font-bold">{formatPrice(p.priceCents)}</p>
          <div className="flex-1"><AddToCart productId={p.id} name={p.name} priceCents={p.priceCents} available={available} maxQty={a ? 1 : p.stockOnHand - p.stockReserved} showQty={false} /></div>
        </div>
      </div>

      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        description: p.shortDescription ?? plainText(p.description, 300),
        sku: p.sku ?? undefined,
        gtin13: p.ean ?? undefined,
        brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
        image: p.images.map((i) => mediaUrl(i.storageKey)),
        category: p.category?.name,
        offers: { "@type": "Offer", url: siteUrl(`/produit/${p.slug}`), priceCurrency: "EUR", price: (p.priceCents / 100).toFixed(2), availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", itemCondition: "https://schema.org/NewCondition" },
      }} />
    </div>
  );
}
