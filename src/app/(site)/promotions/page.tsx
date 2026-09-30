import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/ui/card";
import { CatalogView } from "@/components/catalog-view";
import { parseCatalogQuery } from "@/server/catalog";

export const metadata: Metadata = { title: "Promotions", description: "Toutes les offres en cours sur les reptiles, accessoires et équipements.", alternates: { canonical: "/promotions" } };

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Promotions" }]} />
      <PageHeader title="Promotions" description="Les produits actuellement proposés à prix réduit." />
      <CatalogView query={{ ...parseCatalogQuery(params), promo: true }} params={params} basePath="/promotions" />
    </div>
  );
}
