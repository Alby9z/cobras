import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/session";
import { can, type Permission } from "@/lib/domain/permissions";
import { roleLabel } from "@/lib/labels";
import { ThemeToggle } from "@/components/theme";

export const metadata: Metadata = { title: { default: "Administration", template: "%s | Administration" }, robots: { index: false, follow: false } };

const GROUPS: { title: string; items: { href: string; label: string; perm: Permission }[] }[] = [
  { title: "Pilotage", items: [
    { href: "/admin", label: "Tableau de bord", perm: "dashboard.view" },
    { href: "/admin/systeme", label: "Santé système", perm: "system.read" },
  ] },
  { title: "Ventes", items: [
    { href: "/admin/commandes", label: "Commandes", perm: "orders.read" },
    { href: "/admin/paiements", label: "Paiements & Stripe", perm: "payments.read" },
    { href: "/admin/demandes", label: "Demandes & prospects", perm: "crm.read" },
  ] },
  { title: "Conformité", items: [
    { href: "/admin/conformite", label: "File d'examen", perm: "compliance.read" },
    { href: "/admin/documents", label: "Documents à valider", perm: "documents.review" },
    { href: "/admin/conformite/regles", label: "Règles", perm: "compliance.read" },
    { href: "/admin/especes", label: "Espèces", perm: "compliance.read" },
  ] },
  { title: "Catalogue & stock", items: [
    { href: "/admin/produits", label: "Produits & animaux", perm: "products.read" },
    { href: "/admin/inventaire", label: "Mouvements de stock", perm: "products.read" },
    { href: "/admin/categories", label: "Catégories", perm: "products.write" },
    { href: "/admin/tva", label: "Taux de TVA", perm: "settings.write" },
    { href: "/admin/livraison", label: "Livraison", perm: "shipping.write" },
    { href: "/admin/coupons", label: "Codes promo", perm: "marketing.write" },
  ] },
  { title: "Contenus", items: [
    { href: "/admin/faq", label: "FAQ", perm: "content.write" },
    { href: "/admin/temoignages", label: "Témoignages", perm: "content.write" },
    { href: "/admin/pages", label: "Pages & légal", perm: "content.write" },
  ] },
  { title: "Administration", items: [
    { href: "/admin/utilisateurs", label: "Utilisateurs & rôles", perm: "users.read" },
    { href: "/admin/emails", label: "Journal des e-mails", perm: "system.read" },
    { href: "/admin/audit", label: "Journal d'audit", perm: "audit.read" },
    { href: "/admin/parametres", label: "Paramètres", perm: "settings.write" },
  ] },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission("dashboard.view");
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="border-b border-border bg-card lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-4">
          <Link href="/admin" className="font-display text-lg font-semibold text-primary">Administration</Link>
          <ThemeToggle />
        </div>
        <nav aria-label="Administration" className="px-2 pb-4">
          {GROUPS.map((g) => {
            const items = g.items.filter((n) => can(user.role, n.perm));
            if (!items.length) return null;
            return (
              <div key={g.title} className="mb-3">
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
                <ul className="flex gap-1 overflow-x-auto lg:flex-col">
                  {items.map((n) => <li key={n.href}><Link href={n.href} className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-muted">{n.label}</Link></li>)}
                </ul>
              </div>
            );
          })}
          <Link href="/" className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted">← Retour au site</Link>
        </nav>
        <p className="hidden px-4 pb-4 text-xs text-muted-foreground lg:block">{user.email}<br />{roleLabel[user.role]}</p>
      </aside>
      <main id="contenu" className="min-w-0 p-4 sm:p-8">{children}</main>
    </div>
  );
}
