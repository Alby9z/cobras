import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, PageHeader } from "@/components/ui/card";
import { db } from "@/server/db";
import { formatDate } from "@/lib/utils";

export const revalidate = 600;
export const metadata: Metadata = { title: "Témoignages clients", alternates: { canonical: "/temoignages" } };

export default async function TestimonialsPage() {
  const items = await db.testimonial.findMany({ where: { published: true }, orderBy: { createdAt: "desc" } });
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Témoignages" }]} />
      <PageHeader title="Témoignages clients" description="Avis publiés avec l'accord écrit de leurs auteurs." />
      {items.length === 0 ? <p className="text-muted-foreground">Aucun témoignage publié pour le moment.</p> : (
        <ul className="grid gap-6 md:grid-cols-2">
          {items.map((t) => (
            <li key={t.id}><Card className="h-full"><blockquote>« {t.content} »</blockquote><p className="mt-4 text-sm font-semibold">{t.author}{t.location ? ` — ${t.location}` : ""}</p><p className="text-xs text-muted-foreground">{formatDate(t.createdAt, { month: "long", year: "numeric" })}</p></Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}
