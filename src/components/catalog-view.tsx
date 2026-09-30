import { Suspense } from "react";
import { CatalogFilters, SortSelect } from "@/components/catalog-filters";
import { ProductGrid } from "@/components/product-card";
import { Pagination } from "@/components/pagination";
import { FiltersPanel } from "@/components/filters-panel";
import { RecentlyViewed } from "@/components/recently-viewed";
import { facets, searchProducts, type CatalogQuery } from "@/server/catalog";

export async function CatalogView({ query, params, basePath }: { query: CatalogQuery; params: Record<string, string | string[] | undefined>; basePath: string }) {
  const [{ items, total, page, pages }, f] = await Promise.all([searchProducts(query), facets()]);
  return (
    <div className="grid gap-10 lg:grid-cols-[260px_1fr]">
      <FiltersPanel>
        <Suspense><CatalogFilters categories={f.categories} species={f.species} /></Suspense>
      </FiltersPanel>
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">{total} résultat{total > 1 ? "s" : ""}</p>
          <Suspense><SortSelect /></Suspense>
        </div>
        {items.length ? <ProductGrid products={items} priorityCount={3} /> : <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">Aucun produit ne correspond à votre recherche.</p>}
        <Pagination page={page} pages={pages} basePath={basePath} params={params} />
        <RecentlyViewed />
      </div>
    </div>
  );
}
