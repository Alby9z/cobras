import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, PageHeader } from "@/components/ui/card";
import { ContactForm } from "@/components/contact-form";
import { BusinessJsonLd } from "@/components/site/business-jsonld";
import { getSettings, brandName } from "@/server/settings";

export const metadata: Metadata = { title: "Contact", description: "Contactez-nous : question sur un animal, une commande ou la réglementation. Réponse sous 24 h ouvrées.", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const s = await getSettings();
  const mapSrc = s.mapsQuery ? `https://www.google.com/maps?q=${encodeURIComponent(s.mapsQuery)}&output=embed` : null;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <BusinessJsonLd s={s} />
      <Breadcrumbs items={[{ label: "Contact" }]} />
      <PageHeader title="Contact" description="Nous répondons à toutes les demandes sous 24 h ouvrées." />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <Card className="p-6"><ContactForm /></Card>
        <div className="space-y-4 text-sm">
          <Card>
            <p className="font-semibold">{brandName(s)}</p>
            <address className="mt-2 not-italic text-muted-foreground">
              {s.addressLine && <>{s.addressLine}<br />{s.postalCode} {s.city}<br /></>}
              {s.phone && <><a href={`tel:${s.phone.replace(/\s/g, "")}`} className="hover:underline">{s.phone}</a><br /></>}
              {s.email && <a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a>}
            </address>
            {s.openingHours && <p className="mt-3 whitespace-pre-line text-muted-foreground">{s.openingHours}</p>}
          </Card>
          {mapSrc && <iframe title="Plan d'accès" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-72 w-full rounded-xl border border-border" />}
        </div>
      </div>
    </div>
  );
}
