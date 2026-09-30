import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/ui/card";
import { CatalogView } from "@/components/catalog-view";
import { parseCatalogQuery } from "@/server/catalog";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseCatalogQuery(await searchParams);
  const title = q.type === "ANIMAL" ? "Reptiles disponibles" : q.type === "ACCESSORY" ? "Accessoires et équipements pour reptiles" : "Catalogue";
  const filtered = Object.keys(await searchParams).some((k) => k !== "type");
  return {
    title,
    description: q.type === "ANIMAL" ? "Reptiles disponibles à la vente, avec statut réglementaire, conditions de maintenance et transport adapté." : "Terrariums, chauffage, éclairage, substrats et équipements pour la maintenance des reptiles.",
    alternates: { canonical: q.type ? `/catalogue?type=${q.type}` : "/catalogue" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function CataloguePage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseCatalogQuery(params);
  const title = query.type === "ANIMAL" ? "Reptiles disponibles" : query.type === "ACCESSORY" ? "Accessoires & équipement" : "Catalogue";
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: title }]} />
      <PageHeader title={title} />
      <CatalogView query={query} params={params} basePath="/catalogue" />
    </div>
  );
}
