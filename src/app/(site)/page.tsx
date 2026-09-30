import Link from "next/link";
import { ShieldCheck, FileCheck2, Truck, CreditCard, Clock, MapPin, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProductGrid } from "@/components/product-card";
import { ContactForm } from "@/components/contact-form";
import { FaqList } from "@/components/site/faq-list";
import { Reveal } from "@/components/site/reveal";
import { BusinessJsonLd } from "@/components/site/business-jsonld";
import { db } from "@/server/db";
import { cardSelect } from "@/server/catalog";
import { getSettings, brandName } from "@/server/settings";

export const revalidate = 300;

const PROCESS = [
  { icon: CreditCard, title: "Commande & paiement sécurisé", text: "Ajoutez au panier, créez votre compte et réglez par carte, Apple Pay ou Google Pay via Stripe." },
  { icon: ShieldCheck, title: "Contrôle réglementaire", text: "Chaque commande est vérifiée automatiquement puis par notre équipe selon l'espèce et votre adresse." },
  { icon: FileCheck2, title: "Documents validés", text: "Déposez vos justificatifs dans votre espace sécurisé ; nous les validons avant toute expédition." },
  { icon: Truck, title: "Expédition adaptée", text: "Transport spécialisé pour les animaux vivants ou retrait sur place, avec suivi jusqu'à la réception." },
];

export default async function HomePage() {
  const [s, featured, testimonials, faqs] = await Promise.all([
    getSettings(),
    db.product.findMany({ where: { status: "PUBLISHED", featured: true }, orderBy: { updatedAt: "desc" }, take: 8, select: cardSelect }),
    db.testimonial.findMany({ where: { published: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.faq.findMany({ where: { published: true, onHome: true }, orderBy: { position: "asc" }, take: 6 }),
  ]);
  const name = brandName(s);
  const mapSrc = s.mapsQuery ? `https://www.google.com/maps?q=${encodeURIComponent(s.mapsQuery)}&output=embed` : null;

  return (
    <>
      <BusinessJsonLd s={s} />
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/10 to-background">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary">{name}</p>
            <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              {s.tagline ?? "Reptiles, accessoires et équipements"}
            </h1>
            {s.valueProposition && <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{s.valueProposition}</p>}
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button asChild size="lg"><Link href="/catalogue?type=ANIMAL">Voir les animaux disponibles</Link></Button>
              <Link href="/catalogue?type=ACCESSORY" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">ou parcourir les accessoires</Link>
            </div>
            <p className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 text-primary" aria-hidden /> Réponse à toutes les demandes sous 24 h ouvrées</p>
          </Reveal>
        </div>
      </section>

      {/* Processus */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" aria-labelledby="process-title">
        <h2 id="process-title" className="font-display text-3xl font-semibold">Comment se déroule une commande</h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map((p, i) => (
            <li key={p.title}>
              <Reveal delay={i * 0.08} className="h-full">
                <Card className="h-full">
                  <p className="text-sm font-bold text-accent">Étape {i + 1}</p>
                  <p.icon className="mt-3 h-7 w-7 text-primary" aria-hidden />
                  <h3 className="mt-3 font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
                </Card>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {featured.length > 0 && (
        <section className="bg-muted/50 py-20" aria-labelledby="featured-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-8 flex items-end justify-between gap-4">
              <h2 id="featured-title" className="font-display text-3xl font-semibold">Sélection du moment</h2>
              <Link href="/catalogue" className="text-sm font-semibold text-primary hover:underline">Tout le catalogue →</Link>
            </div>
            <ProductGrid products={featured} />
          </div>
        </section>
      )}

      {s.about && (
        <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6" aria-labelledby="about-title">
          <h2 id="about-title" className="font-display text-3xl font-semibold">Qui sommes-nous ?</h2>
          <p className="mt-6 whitespace-pre-line text-lg leading-relaxed text-muted-foreground">{s.about}</p>
          <Link href="/a-propos" className="mt-6 inline-block font-semibold text-primary hover:underline">En savoir plus</Link>
        </section>
      )}

      {testimonials.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" aria-labelledby="testi-title">
          <h2 id="testi-title" className="font-display text-3xl font-semibold">Ils nous ont fait confiance</h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <li key={t.id}><Card className="h-full"><blockquote className="text-muted-foreground">« {t.content} »</blockquote><p className="mt-4 text-sm font-semibold">{t.author}{t.location ? ` — ${t.location}` : ""}</p></Card></li>
            ))}
          </ul>
        </section>
      )}

      {faqs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6" aria-labelledby="faq-title">
          <h2 id="faq-title" className="mb-8 font-display text-3xl font-semibold">Questions fréquentes</h2>
          <FaqList items={faqs} />
          <Link href="/faq" className="mt-6 inline-block font-semibold text-primary hover:underline">Toutes les questions</Link>
        </section>
      )}

      {/* Contact */}
      <section className="border-t border-border bg-muted/50 py-20" aria-labelledby="contact-title">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 id="contact-title" className="font-display text-3xl font-semibold">Une question ? Écrivez-nous</h2>
            <p className="mt-3 text-muted-foreground">Nous répondons sous 24 h ouvrées.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {s.addressLine && <li className="flex gap-3"><MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden />{s.addressLine}, {s.postalCode} {s.city}</li>}
              {s.phone && <li className="flex gap-3"><Phone className="h-5 w-5 shrink-0 text-primary" aria-hidden /><a href={`tel:${s.phone.replace(/\s/g, "")}`} className="hover:underline">{s.phone}</a></li>}
              {s.email && <li className="flex gap-3"><Mail className="h-5 w-5 shrink-0 text-primary" aria-hidden /><a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a></li>}
              {s.openingHours && <li className="flex gap-3"><Clock className="h-5 w-5 shrink-0 text-primary" aria-hidden /><span className="whitespace-pre-line">{s.openingHours}</span></li>}
            </ul>
            {mapSrc && (
              <iframe title={`Plan d'accès — ${name}`} src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="mt-8 h-72 w-full rounded-xl border border-border" />
            )}
          </div>
          <Card className="p-6"><ContactForm compact /></Card>
        </div>
      </section>

      {/* CTA collant mobile */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden">
        <Button asChild className="w-full" size="lg"><Link href="/catalogue?type=ANIMAL">Voir les animaux disponibles</Link></Button>
      </div>
    </>
  );
}
