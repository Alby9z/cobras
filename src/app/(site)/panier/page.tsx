import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/card";
import { CouponForm } from "@/components/cart-coupon";
import { getCart, cartTotals } from "@/server/cart";
import { updateCartItem } from "@/server/actions/cart";
import { formatPrice, mediaUrl } from "@/lib/utils";
import { isAvailable } from "@/server/catalog";

export const metadata: Metadata = { title: "Panier", robots: { index: false } };

export default async function CartPage() {
  const cart = await getCart();
  const items = cart?.items ?? [];
  const totals = cart ? await cartTotals(cart, null) : null;
  const unavailable = items.filter((i) => i.product.status !== "PUBLISHED" || !isAvailable(i.product) || (i.product.type !== "ANIMAL" && i.product.stockOnHand - i.product.stockReserved < i.quantity));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Panier" }]} />
      <PageHeader title="Votre panier" />
      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-muted-foreground">Votre panier est vide.</p>
          <Button asChild className="mt-6"><Link href="/catalogue">Découvrir le catalogue</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {items.map((it) => {
              const img = it.product.images[0];
              const isReptile = it.product.type === "ANIMAL";
              return (
                <li key={it.id} className="flex gap-4 p-4">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {img && <Image src={mediaUrl(img.storageKey)} alt={img.alt} fill sizes="96px" className="object-cover" />}
                  </div>
                  <div className="flex flex-1 flex-col">
                    <Link href={`/produit/${it.product.slug}`} className="font-semibold hover:underline">{it.product.name}</Link>
                    {it.product.animal && <p className="text-xs italic text-muted-foreground">{it.product.animal.species.scientificName}</p>}
                    <p className="mt-1 text-sm">{formatPrice(it.product.priceCents)}</p>
                    {unavailable.includes(it) && <p className="mt-1 text-sm font-medium text-danger">{isReptile ? "Cet animal n'est plus disponible" : "Disponibilité insuffisante"}</p>}
                    <div className="mt-auto flex items-center gap-3 pt-2">
                      {!isReptile && (
                        <form action={updateCartItem} className="flex items-center gap-2">
                          <input type="hidden" name="itemId" value={it.id} />
                          <label htmlFor={`q-${it.id}`} className="sr-only">Quantité</label>
                          <input id={`q-${it.id}`} name="quantity" type="number" min={1} max={Math.max(1, it.product.stockOnHand - it.product.stockReserved)} defaultValue={it.quantity} className="h-9 w-16 rounded-lg border border-border bg-card px-2 text-sm" />
                          <Button type="submit" variant="outline" size="sm">Mettre à jour</Button>
                        </form>
                      )}
                      <form action={updateCartItem}>
                        <input type="hidden" name="itemId" value={it.id} />
                        <input type="hidden" name="quantity" value="0" />
                        <Button type="submit" variant="ghost" size="sm" aria-label={`Retirer ${it.product.name}`}><Trash2 className="h-4 w-4" aria-hidden /> Retirer</Button>
                      </form>
                    </div>
                  </div>
                  <p className="font-semibold">{formatPrice(it.product.priceCents * it.quantity)}</p>
                </li>
              );
            })}
          </ul>

          <Card className="h-fit space-y-4 lg:sticky lg:top-24">
            <CouponForm current={cart?.couponCode ?? null} />
            {totals?.couponError && <Alert tone="warning">{totals.couponError}</Alert>}
            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between"><dt>Sous-total TTC</dt><dd>{formatPrice(totals!.subtotalCents)}</dd></div>
              {totals!.discountCents > 0 && <div className="flex justify-between text-success"><dt>Remise ({totals!.couponApplied})</dt><dd>−{formatPrice(totals!.discountCents)}</dd></div>}
              <div className="flex justify-between text-muted-foreground"><dt>Livraison</dt><dd>calculée à l&apos;étape suivante</dd></div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><dt>Total</dt><dd>{formatPrice(totals!.subtotalCents - totals!.discountCents)}</dd></div>
            </dl>
            {unavailable.length > 0 && <Alert tone="danger">Retirez ou ajustez les articles indisponibles pour continuer.</Alert>}
            <Button asChild size="lg" className="w-full" aria-disabled={unavailable.length > 0}>
              <Link href={unavailable.length ? "#" : "/commande"}>Passer la commande</Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">Paiement sécurisé par Stripe · Carte, Apple Pay, Google Pay</p>
          </Card>
        </div>
      )}
    </div>
  );
}
