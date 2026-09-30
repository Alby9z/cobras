import Link from "next/link";
import { ShoppingBag, User, Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme";
import { MobileMenu } from "@/components/site/mobile-menu";
import { getCurrentUser, isStaff } from "@/server/session";
import { getCart, cartCount } from "@/server/cart";
import { getSettings, brandName } from "@/server/settings";

export const NAV = [
  { href: "/catalogue?type=ANIMAL", label: "Reptiles" },
  { href: "/catalogue?type=ACCESSORY", label: "Accessoires & équipement" },
  { href: "/promotions", label: "Promotions" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export async function Header() {
  const [user, cart, settings] = await Promise.all([getCurrentUser(), getCart(), getSettings()]);
  const count = cartCount(cart);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <MobileMenu nav={NAV} />
        <Link href="/" className="font-display text-xl font-semibold tracking-tight text-primary">
          {brandName(settings)}
        </Link>
        <nav aria-label="Navigation principale" className="ml-6 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}><Link href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">{n.label}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <form action="/catalogue" role="search" className="hidden md:block">
            <label htmlFor="q-header" className="sr-only">Rechercher</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input id="q-header" name="q" type="search" placeholder="Rechercher…" className="h-10 w-56 rounded-lg border border-border bg-card pl-9 pr-3 text-sm" />
            </div>
          </form>
          <ThemeToggle />
          {user && isStaff(user.role) && (
            <Link href="/admin" className="hidden rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted sm:inline-flex">Admin</Link>
          )}
          <Link href={user ? "/compte" : "/connexion"} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted" aria-label={user ? "Mon compte" : "Connexion"}>
            <User className="h-5 w-5" aria-hidden />
          </Link>
          <Link href="/panier" className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted" aria-label={`Panier, ${count} article${count > 1 ? "s" : ""}`}>
            <ShoppingBag className="h-5 w-5" aria-hidden />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground">{count}</span>}
          </Link>
        </div>
      </div>
    </header>
  );
}
