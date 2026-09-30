import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { formatPrice, mediaUrl } from "@/lib/utils";
import { sexLabel } from "@/lib/labels";
import { isAvailable, type ProductCardData } from "@/server/catalog";

export function ProductCard({ p, priority = false }: { p: ProductCardData; priority?: boolean }) {
  const img = p.images[0];
  const promo = p.compareAtCents && p.compareAtCents > p.priceCents;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {img ? (
          <Image src={mediaUrl(img.storageKey)} alt={img.alt} fill sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-500 group-hover:scale-105" priority={priority} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Photo à venir</div>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {promo && <Badge className="bg-accent text-accent-foreground">Promo</Badge>}
          {!isAvailable(p) && <Badge tone="muted" className="bg-card">{p.type === "ANIMAL" ? "Réservé / vendu" : "Indisponible"}</Badge>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        {p.animal && <p className="text-xs italic text-muted-foreground">{p.animal.species.scientificName}</p>}
        <h3 className="mt-1 font-semibold leading-snug">
          <Link href={`/produit/${p.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">{p.name}</Link>
        </h3>
        {p.animal && (
          <p className="mt-1 text-sm text-muted-foreground">{[sexLabel[p.animal.sex], p.animal.morph].filter(Boolean).join(" · ")}</p>
        )}
        <p className="mt-auto pt-3">
          <span className="text-lg font-bold">{formatPrice(p.priceCents)}</span>
          {promo && <span className="ml-2 text-sm text-muted-foreground line-through">{formatPrice(p.compareAtCents!)}</span>}
        </p>
      </div>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: ProductCardData[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => <li key={p.id}><ProductCard p={p} priority={i < priorityCount} /></li>)}
    </ul>
  );
}
