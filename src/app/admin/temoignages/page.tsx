import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { deleteTestimonial, saveTestimonial } from "@/server/actions/admin/content";
import type { Testimonial } from "@/generated/prisma/client";

const fields = (t?: Testimonial): FieldDef[] => [
  { name: "author", label: "Auteur (tel qu'il accepte d'être cité)", required: true, defaultValue: t?.author },
  { name: "location", label: "Ville / région", defaultValue: t?.location },
  { name: "content", label: "Témoignage (texte exact du client)", type: "textarea", required: true, defaultValue: t?.content, span: true },
  { name: "consentAt", label: "Date du consentement écrit à la publication", type: "date", required: true, defaultValue: t ? t.consentAt.toISOString().slice(0, 10) : "" },
  { name: "published", label: "Publié", type: "checkbox", defaultChecked: t?.published },
];

export default async function AdminTestimonials() {
  await requirePermission("content.write");
  const items = await db.testimonial.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Témoignages" description="Ne publiez que des avis réels, reproduits fidèlement, avec l'accord écrit de leur auteur (Code de la consommation, art. L121-4)." />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouveau témoignage</h2><SimpleForm action={saveTestimonial} fields={fields()} resetOnSuccess /></Card>
      <div className="space-y-3">
        {items.map((t) => (
          <details key={t.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{t.author} {!t.published && <span className="text-sm font-normal text-muted-foreground">(non publié)</span>}</summary>
            <div className="mt-4"><SimpleForm action={saveTestimonial} fields={fields(t)} hidden={{ id: t.id }} /></div>
            <form action={deleteTestimonial} className="mt-3"><input type="hidden" name="id" value={t.id} /><button className="text-sm text-danger underline">Supprimer</button></form>
          </details>
        ))}
      </div>
    </>
  );
}
