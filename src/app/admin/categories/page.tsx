import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { deleteCategory, saveCategory } from "@/server/actions/admin/catalog";

export default async function AdminCategories() {
  await requirePermission("products.write");
  const cats = await db.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
  const fields = (c?: (typeof cats)[number]): FieldDef[] => [
    { name: "name", label: "Nom", required: true, defaultValue: c?.name },
    { name: "parentId", label: "Catégorie parente", type: "select", options: [["", "— Aucune —"], ...cats.filter((x) => x.id !== c?.id).map((x) => [x.id, x.name] as [string, string])], defaultValue: c?.parentId },
    { name: "position", label: "Ordre d'affichage", type: "number", defaultValue: c?.position ?? 0 },
    { name: "metaTitle", label: "Meta title", defaultValue: c?.metaTitle },
    { name: "description", label: "Description (affichée en haut de page)", type: "textarea", defaultValue: c?.description, span: true, rows: 3 },
    { name: "metaDescription", label: "Meta description", defaultValue: c?.metaDescription, span: true },
  ];
  return (
    <>
      <PageHeader title="Catégories" />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouvelle catégorie</h2><SimpleForm action={saveCategory} fields={fields()} resetOnSuccess /></Card>
      <div className="space-y-3">
        {cats.map((c) => (
          <details key={c.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{c.name} <span className="text-sm font-normal text-muted-foreground">/categorie/{c.slug} · {c._count.products} produit(s)</span></summary>
            <div className="mt-4"><SimpleForm action={saveCategory} fields={fields(c)} hidden={{ id: c.id }} /></div>
            {c._count.products === 0 && <form action={deleteCategory} className="mt-3"><input type="hidden" name="id" value={c.id} /><button className="text-sm text-danger underline">Supprimer</button></form>}
          </details>
        ))}
      </div>
    </>
  );
}
