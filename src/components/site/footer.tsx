import Link from "next/link";
import { CookieSettingsButton } from "@/components/analytics";
import { getSettings, brandName } from "@/server/settings";
import { db } from "@/server/db";

export async function Footer() {
  const [s, pages] = await Promise.all([getSettings(), db.page.findMany({ where: { published: true }, select: { slug: true, title: true }, orderBy: { title: "asc" } })]);
  return (
    <footer className="mt-24 border-t border-border bg-muted/50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-xl font-semibold text-primary">{brandName(s)}</p>
          {s.tagline && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{s.tagline}</p>}
          <address className="mt-4 text-sm not-italic text-muted-foreground">
            {s.addressLine && <>{s.addressLine}<br /></>}
            {(s.postalCode || s.city) && <>{s.postalCode} {s.city}<br /></>}
            {s.phone && <><a href={`tel:${s.phone.replace(/\s/g, "")}`} className="hover:underline">{s.phone}</a><br /></>}
            {s.email && <a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a>}
          </address>
          {s.capacityCertificate && <p className="mt-3 text-xs text-muted-foreground">Certificat de capacité n° {s.capacityCertificate}</p>}
        </div>
        <nav aria-label="Boutique">
          <p className="mb-3 text-sm font-semibold">Boutique</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/catalogue?type=ANIMAL" className="hover:text-foreground hover:underline">Reptiles</Link></li>
            <li><Link href="/catalogue?type=ACCESSORY" className="hover:text-foreground hover:underline">Accessoires</Link></li>
            <li><Link href="/promotions" className="hover:text-foreground hover:underline">Promotions</Link></li>
            <li><Link href="/temoignages" className="hover:text-foreground hover:underline">Témoignages</Link></li>
            <li><Link href="/devis" className="hover:text-foreground hover:underline">Demande de devis</Link></li>
            <li><Link href="/audit" className="hover:text-foreground hover:underline">Demande d&apos;audit</Link></li>
          </ul>
        </nav>
        <nav aria-label="Informations">
          <p className="mb-3 text-sm font-semibold">Informations</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/faq" className="hover:text-foreground hover:underline">FAQ</Link></li>
            <li><Link href="/contact" className="hover:text-foreground hover:underline">Contact</Link></li>
            {pages.map((p) => <li key={p.slug}><Link href={`/${p.slug}`} className="hover:text-foreground hover:underline">{p.title}</Link></li>)}
            <li><CookieSettingsButton /></li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-border py-5 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {s.companyName ?? brandName(s)}</p>
    </footer>
  );
}
