import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { deleteFaq, saveFaq } from "@/server/actions/admin/content";
import type { Faq } from "@/generated/prisma/client";

const fields = (f?: Faq): FieldDef[] => [
  { name: "question", label: "Question", required: true, defaultValue: f?.question, span: true },
  { name: "answer", label: "Réponse (Markdown)", type: "textarea", required: true, defaultValue: f?.answer, span: true },
  { name: "position", label: "Ordre", type: "number", defaultValue: f?.position ?? 0 },
  { name: "onHome", label: "Afficher sur l'accueil", type: "checkbox", defaultChecked: f?.onHome },
  { name: "published", label: "Publiée", type: "checkbox", defaultChecked: f ? f.published : true },
];

export default async function AdminFaq() {
  await requirePermission("content.write");
  const faqs = await db.faq.findMany({ orderBy: { position: "asc" } });
  return (
    <>
      <PageHeader title="FAQ" description="Les questions publiées alimentent la page FAQ et les données structurées FAQPage." />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouvelle question</h2><SimpleForm action={saveFaq} fields={fields()} resetOnSuccess /></Card>
      <div className="space-y-3">
        {faqs.map((f) => (
          <details key={f.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{f.question}</summary>
            <div className="mt-4"><SimpleForm action={saveFaq} fields={fields(f)} hidden={{ id: f.id }} /></div>
            <form action={deleteFaq} className="mt-3"><input type="hidden" name="id" value={f.id} /><button className="text-sm text-danger underline">Supprimer</button></form>
          </details>
        ))}
      </div>
    </>
  );
}
