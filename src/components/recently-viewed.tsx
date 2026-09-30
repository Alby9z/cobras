"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getPublishedCards } from "@/server/actions/catalog";
import { formatPrice } from "@/lib/utils";

const KEY = "recently_viewed";
type Card = Awaited<ReturnType<typeof getPublishedCards>>[number];

export function RememberView({ id }: { id: string }) {
  useEffect(() => {
    try {
      const list = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).filter((x) => x !== id);
      localStorage.setItem(KEY, JSON.stringify([id, ...list].slice(0, 12)));
    } catch { /* stockage indisponible */ }
  }, [id]);
  return null;
}

export function RecentlyViewed({ exclude }: { exclude?: string }) {
  const [items, setItems] = useState<Card[]>([]);
  useEffect(() => {
    let ids: string[] = [];
    try { ids = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).filter((x) => x !== exclude).slice(0, 6); } catch { /* */ }
    if (ids.length) getPublishedCards(ids).then(setItems).catch(() => undefined);
  }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="mt-16" aria-labelledby="recent-title">
      <h2 id="recent-title" className="mb-4 font-display text-xl font-semibold">Récemment consultés</h2>
      <ul className="flex gap-4 overflow-x-auto pb-2">
        {items.map((p) => (
          <li key={p.id} className="w-44 shrink-0 rounded-lg border border-border bg-card p-3">
            <Link href={`/produit/${p.slug}`} className="text-sm font-medium hover:underline">{p.name}</Link>
            <p className="mt-1 text-sm font-bold">{formatPrice(p.priceCents)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
