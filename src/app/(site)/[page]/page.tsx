import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/ui/card";
import { db } from "@/server/db";
import { renderRichText } from "@/lib/sanitize";
import { formatDate } from "@/lib/utils";
import { CMS_SLUGS } from "@/lib/cms";


export const revalidate = 600;
type Props = { params: Promise<{ page: string }> };
const load = cache((slug: string) => (CMS_SLUGS.includes(slug) ? db.page.findFirst({ where: { slug, published: true } }) : null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).page);
  if (!p) return {};
  return { title: p.title, description: p.metaDescription ?? undefined, alternates: { canonical: `/${p.slug}` } };
}

export default async function CmsPage({ params }: Props) {
  const p = await load((await params).page);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: p.title }]} />
      <PageHeader title={p.title} description={`Dernière mise à jour : ${formatDate(p.updatedAt)}`} />
      <article className="prose-content" dangerouslySetInnerHTML={{ __html: renderRichText(p.content) }} />
    </div>
  );
}
