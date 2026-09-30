import Link from "next/link";
import { requireUser } from "@/server/session";
import { SignOutButton } from "@/components/auth/sign-out";

const LINKS = [
  { href: "/compte", label: "Tableau de bord" },
  { href: "/compte/commandes", label: "Mes commandes" },
  { href: "/compte/documents", label: "Mes documents" },
  { href: "/compte/factures", label: "Mes factures" },
  { href: "/compte/adresses", label: "Mes adresses" },
  { href: "/compte/favoris", label: "Mes favoris" },
  { href: "/compte/profil", label: "Profil & sécurité" },
];

export const metadata = { robots: { index: false } };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr]">
      <aside>
        <p className="mb-4 text-sm text-muted-foreground">Bonjour <span className="font-semibold text-foreground">{user.firstName}</span></p>
        <nav aria-label="Espace client">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {LINKS.map((l) => <li key={l.href}><Link href={l.href} className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">{l.label}</Link></li>)}
            <li><SignOutButton /></li>
          </ul>
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
