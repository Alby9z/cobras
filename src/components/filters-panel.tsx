"use client";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/** Filtres repliables sur mobile, toujours visibles sur grand écran. */
export function FiltersPanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <aside aria-label="Filtres">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="filters-body" className="mb-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-semibold lg:hidden">
        <SlidersHorizontal className="h-4 w-4" aria-hidden /> {open ? "Masquer les filtres" : "Rechercher et filtrer"}
      </button>
      <div id="filters-body" className={cn(open ? "block" : "hidden", "lg:block")}>{children}</div>
    </aside>
  );
}
