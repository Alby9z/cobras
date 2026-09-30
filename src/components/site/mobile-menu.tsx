"use client";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export function MobileMenu({ nav }: { nav: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted lg:hidden" aria-label="Ouvrir le menu">
        <Menu className="h-5 w-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-background p-6 shadow-xl">
          <div className="mb-6 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg font-semibold">Menu</Dialog.Title>
            <Dialog.Close className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted" aria-label="Fermer le menu"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
          </div>
          <form action="/catalogue" role="search" className="mb-4" onSubmit={() => setOpen(false)}>
            <label htmlFor="q-mobile" className="sr-only">Rechercher</label>
            <input id="q-mobile" name="q" type="search" placeholder="Rechercher…" className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm" />
          </form>
          <nav aria-label="Navigation mobile">
            <ul className="space-y-1">
              {[...nav, { href: "/compte", label: "Mon compte" }, { href: "/devis", label: "Demande de devis" }].map((n) => (
                <li key={n.href}><Link href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 font-medium hover:bg-muted">{n.label}</Link></li>
              ))}
            </ul>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
