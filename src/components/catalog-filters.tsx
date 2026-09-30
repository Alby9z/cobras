"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Label, Select, Checkbox } from "@/components/ui/form";

/** Recherche instantanée + filtres synchronisés avec l'URL (partageable, indexable). */
export function CatalogFilters({ categories, species }: { categories: { slug: string; name: string }[]; species: { slug: string; commonName: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const type = sp.get("type") ?? "";
  return (
    <div className="space-y-5" aria-busy={pending}>
      <div>
        <Label htmlFor="cat-q">Recherche</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="cat-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Espèce, phase, produit…" className="pl-9" />
        </div>
      </div>
      <div>
        <Label htmlFor="cat-type">Type</Label>
        <Select id="cat-type" value={type} onChange={(e) => update({ type: e.target.value || null, sex: null, espece: null })}>
          <option value="">Tous les produits</option>
          <option value="ANIMAL">Reptiles</option>
          <option value="ACCESSORY">Accessoires & équipement</option>
        </Select>
      </div>
      {categories.length > 0 && (
        <div>
          <Label htmlFor="cat-cat">Catégorie</Label>
          <Select id="cat-cat" value={sp.get("categorie") ?? ""} onChange={(e) => update({ categorie: e.target.value || null })}>
            <option value="">Toutes</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </Select>
        </div>
      )}
      {type !== "ACCESSORY" && species.length > 0 && (
        <div>
          <Label htmlFor="cat-sp">Espèce</Label>
          <Select id="cat-sp" value={sp.get("espece") ?? ""} onChange={(e) => update({ espece: e.target.value || null })}>
            <option value="">Toutes</option>
            {species.map((s) => <option key={s.slug} value={s.slug}>{s.commonName}</option>)}
          </Select>
        </div>
      )}
      {type === "ANIMAL" && (
        <div>
          <Label htmlFor="cat-sex">Sexe</Label>
          <Select id="cat-sex" value={sp.get("sex") ?? ""} onChange={(e) => update({ sex: e.target.value || null })}>
            <option value="">Tous</option>
            <option value="MALE">Mâle</option>
            <option value="FEMALE">Femelle</option>
            <option value="UNKNOWN">Non sexé</option>
          </Select>
        </div>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Prix (€)</legend>
        <div className="flex gap-2">
          <Input aria-label="Prix minimum" type="number" min={0} inputMode="numeric" defaultValue={sp.get("min") ?? ""} placeholder="Min" onBlur={(e) => update({ min: e.target.value || null })} />
          <Input aria-label="Prix maximum" type="number" min={0} inputMode="numeric" defaultValue={sp.get("max") ?? ""} placeholder="Max" onBlur={(e) => update({ max: e.target.value || null })} />
        </div>
      </fieldset>
      <Checkbox label="Disponible uniquement" checked={sp.get("dispo") === "1"} onChange={(e) => update({ dispo: e.target.checked ? "1" : null })} />
      <Checkbox label="En promotion" checked={sp.get("promo") === "1"} onChange={(e) => update({ promo: e.target.checked ? "1" : null })} />
    </div>
  );
}

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm text-muted-foreground">Trier par</label>
      <Select id="sort" className="h-10 w-auto" value={sp.get("sort") ?? "recent"} onChange={(e) => { const n = new URLSearchParams(sp.toString()); n.set("sort", e.target.value); n.delete("page"); router.replace(`${pathname}?${n}`, { scroll: false }); }}>
        <option value="recent">Nouveautés</option>
        <option value="popular">Popularité</option>
        <option value="price_asc">Prix croissant</option>
        <option value="price_desc">Prix décroissant</option>
        <option value="name">Nom</option>
      </Select>
    </div>
  );
}
