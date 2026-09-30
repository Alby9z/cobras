import "server-only";
import { db } from "@/server/db";
import { search } from "@/server/search";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductType, Sex } from "@/generated/prisma/enums";

export const PAGE_SIZE = 24;

export const cardSelect = {
  id: true, slug: true, name: true, type: true, priceCents: true, compareAtCents: true, stockOnHand: true, stockReserved: true,
  images: { orderBy: { position: "asc" }, take: 1, select: { storageKey: true, alt: true, width: true, height: true } },
  animal: { select: { sex: true, morph: true, status: true, species: { select: { commonName: true, scientificName: true, regulatoryCategory: true } } } },
} satisfies Prisma.ProductSelect;

export type ProductCardData = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

export const isAvailable = (p: { type: ProductType; stockOnHand: number; stockReserved: number; animal?: { status: string } | null }) =>
  p.type === "ANIMAL" ? p.animal?.status === "AVAILABLE" : p.stockOnHand - p.stockReserved > 0;

export interface CatalogQuery {
  q?: string;
  type?: ProductType;
  category?: string;
  species?: string;
  sex?: Sex;
  difficulty?: number;
  min?: number;
  max?: number;
  inStock?: boolean;
  promo?: boolean;
  sort?: "relevance" | "recent" | "price_asc" | "price_desc" | "popular" | "name";
  page?: number;
}

export function parseCatalogQuery(sp: Record<string, string | string[] | undefined>): CatalogQuery {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const num = (k: string) => { const v = Number(s(k)); return s(k) && Number.isFinite(v) && v >= 0 ? v : undefined; };
  const type = s("type");
  const sex = s("sex");
  const sort = s("sort");
  const q = s("q")?.slice(0, 100).trim() || undefined;
  return {
    q,
    type: type === "ANIMAL" || type === "ACCESSORY" || type === "EQUIPMENT" ? type : undefined,
    category: s("categorie"),
    species: s("espece"),
    sex: sex === "MALE" || sex === "FEMALE" || sex === "UNKNOWN" ? sex : undefined,
    difficulty: num("difficulte") && num("difficulte")! >= 1 && num("difficulte")! <= 5 ? Math.floor(num("difficulte")!) : undefined,
    min: num("min"),
    max: num("max"),
    inStock: s("dispo") === "1",
    promo: s("promo") === "1",
    sort: (["relevance", "recent", "price_asc", "price_desc", "popular", "name"] as const).find((x) => x === sort) ?? (q ? "relevance" : "recent"),
    page: Math.max(1, Math.min(500, Math.floor(num("page") ?? 1))),
  };
}

export async function searchProducts(q: CatalogQuery) {
  const and: Prisma.ProductWhereInput[] = [{ status: "PUBLISHED" }];
  let rankedIds: string[] | null = null;
  if (q.q) {
    rankedIds = await search.productIds(q.q);
    and.push({ id: { in: rankedIds } });
  }
  if (q.type) and.push({ type: q.type });
  if (q.category) and.push({ OR: [{ category: { slug: q.category } }, { category: { parent: { slug: q.category } } }] });
  if (q.species) and.push({ animal: { species: { slug: q.species } } });
  if (q.sex) and.push({ animal: { sex: q.sex } });
  if (q.difficulty) and.push({ animal: { OR: [{ careDifficulty: q.difficulty }, { careDifficulty: null, species: { careDifficulty: q.difficulty } }] } });
  if (q.min != null) and.push({ priceCents: { gte: Math.round(q.min * 100) } });
  if (q.max != null) and.push({ priceCents: { lte: Math.round(q.max * 100) } });
  if (q.inStock) and.push({ OR: [{ type: "ANIMAL", animal: { status: "AVAILABLE" } }, { type: { not: "ANIMAL" }, stockOnHand: { gt: 0 } }] });
  if (q.promo) and.push({ compareAtCents: { not: null } });
  const where: Prisma.ProductWhereInput = { AND: and };

  const page = q.page ?? 1;
  const total = await db.product.count({ where });
  if (q.sort === "relevance" && rankedIds) {
    const all = await db.product.findMany({ where, select: { id: true } });
    const set = new Set(all.map((r) => r.id));
    const pageIds = rankedIds.filter((id) => set.has(id)).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const rows = await db.product.findMany({ where: { id: { in: pageIds } }, select: cardSelect });
    return { total, items: pageIds.map((id) => rows.find((r) => r.id === id)!).filter(Boolean), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
  }
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === "price_asc" ? [{ priceCents: "asc" }] :
    q.sort === "price_desc" ? [{ priceCents: "desc" }] :
    q.sort === "popular" ? [{ soldCount: "desc" }, { viewCount: "desc" }] :
    q.sort === "name" ? [{ name: "asc" }] : [{ createdAt: "desc" }];
  const items = await db.product.findMany({ where, orderBy: [...orderBy, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: cardSelect });
  return { total, items, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
}

export async function facets() {
  const [categories, species] = await Promise.all([
    db.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { slug: true, name: true, parentId: true } }),
    db.species.findMany({ where: { animals: { some: { product: { status: "PUBLISHED" } } } }, orderBy: { commonName: "asc" }, select: { slug: true, commonName: true } }),
  ]);
  return { categories, species };
}
