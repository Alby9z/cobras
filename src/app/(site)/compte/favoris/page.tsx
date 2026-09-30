import { Card, PageHeader } from "@/components/ui/card";
import { ProductGrid } from "@/components/product-card";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { cardSelect } from "@/server/catalog";

export const metadata = { title: "Mes favoris" };

export default async function WishlistPage() {
  const user = await requireUser("/compte/favoris");
  const items = await withUserScope(user.id, (tx) => tx.wishlistItem.findMany({ where: { userId: user.id, product: { status: "PUBLISHED" } }, orderBy: { createdAt: "desc" }, include: { product: { select: cardSelect } } }));
  return (
    <>
      <PageHeader title="Mes favoris" />
      {items.length === 0 ? <Card><p className="text-muted-foreground">Aucun favori pour le moment.</p></Card> : <ProductGrid products={items.map((i) => i.product)} />}
    </>
  );
}
