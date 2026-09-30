import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { siteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, pages] = await Promise.all([
    db.product.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ select: { slug: true, updatedAt: true } }),
    db.page.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
  ]);
  const staticRoutes = ["/", "/catalogue", "/catalogue?type=ANIMAL", "/catalogue?type=ACCESSORY", "/promotions", "/faq", "/contact", "/devis", "/audit", "/temoignages"];
  return [
    ...staticRoutes.map((r) => ({ url: siteUrl(r), changeFrequency: "daily" as const, priority: r === "/" ? 1 : 0.7 })),
    ...categories.map((c) => ({ url: siteUrl(`/categorie/${c.slug}`), lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: siteUrl(`/produit/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })),
    ...pages.map((p) => ({ url: siteUrl(`/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
