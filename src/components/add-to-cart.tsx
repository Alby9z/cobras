"use client";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { addToCart, toggleWishlist } from "@/server/actions/cart";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>
      <ShoppingBag className="h-5 w-5" aria-hidden /> {pending ? "Ajout…" : "Ajouter au panier"}
    </Button>
  );
}

export function AddToCart({ productId, name, priceCents, available, maxQty, showQty }: { productId: string; name: string; priceCents: number; available: boolean; maxQty: number; showQty: boolean }) {
  const [state, action] = useActionState(addToCart, null);
  useEffect(() => {
    if (state?.ok) track("add_to_cart", { currency: "EUR", value: priceCents / 100, items: [{ item_id: productId, item_name: name, price: priceCents / 100 }] });
  }, [state, productId, name, priceCents]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      {showQty && available && (
        <div className="flex items-center gap-3">
          <label htmlFor="qty" className="text-sm font-medium">Quantité</label>
          <input id="qty" name="quantity" type="number" min={1} max={maxQty} defaultValue={1} className="h-11 w-20 rounded-lg border border-border bg-card px-3" />
        </div>
      )}
      <Submit disabled={!available} />
      <div aria-live="polite" className="text-sm">
        {state?.ok && <p className="font-medium text-success">{state.ok} <Link href="/panier" className="underline">Voir le panier</Link></p>}
        {state?.error && <p className="font-medium text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function WishlistButton({ productId, initial }: { productId: string; initial: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        aria-pressed={saved}
        onClick={async () => {
          const r = await toggleWishlist(productId);
          if ("error" in r) setMsg("Connectez-vous pour enregistrer vos favoris.");
          else { setSaved(r.saved); setMsg(null); if (r.saved) track("add_to_wishlist", { items: [{ item_id: productId }] }); }
        }}
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
      >
        <Heart className={cn("h-5 w-5", saved && "fill-danger text-danger")} aria-hidden /> {saved ? "Dans mes favoris" : "Ajouter aux favoris"}
      </button>
      {msg && <p className="mt-2 text-sm text-muted-foreground"><Link href="/connexion" className="underline">{msg}</Link></p>}
    </div>
  );
}
