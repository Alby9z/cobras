import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/ui/card";
import { CatalogView } from "@/components/catalog-view";
import { parseCatalogQuery } from "@/server/catalog";
import { db } from "@/server/db";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const load = (slug: string) => db.category.findUnique({ where: { slug }, include: { parent: true } });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return {};
  return { title: c.metaTitle ?? c.name, description: c.metaDescription ?? c.description ?? undefined, alternates: { canonical: `/categorie/${c.slug}` } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const c = await load((await params).slug);
  if (!c) notFound();
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Catalogue", href: "/catalogue" }, ...(c.parent ? [{ label: c.parent.name, href: `/categorie/${c.parent.slug}` }] : []), { label: c.name }]} />
      <PageHeader title={c.name} description={c.description ?? undefined} />
      <CatalogView query={{ ...parseCatalogQuery(sp), category: c.slug }} params={sp} basePath={`/categorie/${c.slug}`} />
    </div>
  );
}
