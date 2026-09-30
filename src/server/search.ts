import "server-only";
import { db } from "@/server/db";

/**
 * Abstraction de recherche : implémentation PostgreSQL (unaccent + trigrammes) remplaçable
 * par un moteur dédié (Meilisearch, Typesense…) sans modifier les appelants.
 */
export interface SearchProvider {
  /** Identifiants de produits publiés pertinents, du plus au moins pertinent. */
  productIds(query: string, limit?: number): Promise<string[]>;
  suggest(query: string, limit?: number): Promise<{ label: string; href: string; kind: "product" | "species" }[]>;
}

class PostgresSearch implements SearchProvider {
  async productIds(query: string, limit = 500) {
    const q = query.trim().slice(0, 100);
    if (!q) return [];
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH q AS (SELECT immutable_unaccent(lower(${q})) AS t)
      SELECT p.id FROM product p
      LEFT JOIN animal a ON a."productId" = p.id
      LEFT JOIN species s ON s.id = a."speciesId"
      , q
      WHERE p.status = 'PUBLISHED' AND (
        immutable_unaccent(lower(p.name)) LIKE '%' || q.t || '%'
        OR word_similarity(q.t, immutable_unaccent(lower(p.name))) > 0.45
        OR immutable_unaccent(lower(coalesce(s."commonName", '') || ' ' || coalesce(s."scientificName", ''))) LIKE '%' || q.t || '%'
        OR word_similarity(q.t, immutable_unaccent(lower(coalesce(s."commonName", '') || ' ' || coalesce(s."scientificName", '')))) > 0.45
        OR EXISTS (SELECT 1 FROM unnest(coalesce(s.synonyms, '{}')) syn WHERE immutable_unaccent(lower(syn)) LIKE '%' || q.t || '%')
        OR immutable_unaccent(lower(coalesce(a.morph, ''))) LIKE '%' || q.t || '%'
        OR lower(coalesce(p.sku, '')) = q.t OR coalesce(p.ean, '') = ${q}
        OR immutable_unaccent(lower(coalesce(p.brand, ''))) LIKE '%' || q.t || '%'
      )
      ORDER BY greatest(
        word_similarity(q.t, immutable_unaccent(lower(p.name))),
        word_similarity(q.t, immutable_unaccent(lower(coalesce(s."commonName", '') || ' ' || coalesce(s."scientificName", ''))))
      ) DESC, p."soldCount" DESC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  async suggest(query: string, limit = 8) {
    const q = query.trim().slice(0, 60);
    if (q.length < 2) return [];
    const [products, species] = await Promise.all([
      this.productIds(q, limit).then((ids) => db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }).then((rows) => ids.map((id) => rows.find((r) => r.id === id)!).filter(Boolean))),
      db.$queryRaw<{ slug: string; commonName: string }[]>`
        SELECT s.slug, s."commonName" FROM species s
        WHERE EXISTS (SELECT 1 FROM animal a JOIN product p ON p.id = a."productId" WHERE a."speciesId" = s.id AND p.status = 'PUBLISHED')
          AND (immutable_unaccent(lower(s."commonName" || ' ' || s."scientificName")) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
               OR word_similarity(immutable_unaccent(lower(${q})), immutable_unaccent(lower(s."commonName" || ' ' || s."scientificName"))) > 0.45)
        LIMIT 3`,
    ]);
    return [
      ...species.map((s) => ({ label: s.commonName, href: `/catalogue?espece=${s.slug}`, kind: "species" as const })),
      ...products.map((p) => ({ label: p.name, href: `/produit/${p.slug}`, kind: "product" as const })),
    ].slice(0, limit);
  }
}

export const search: SearchProvider = new PostgresSearch();
