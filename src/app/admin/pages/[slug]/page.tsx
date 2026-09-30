import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { savePage } from "@/server/actions/admin/content";
import { CMS_PAGES } from "@/lib/cms";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission("content.write");
  const { slug } = await params;
  if (!(slug in CMS_PAGES)) notFound();
  const p = await db.page.findUnique({ where: { slug } });
  return (
    <>
      <PageHeader title={p?.title ?? CMS_PAGES[slug]} description={`/${slug}`} />
      <Card>
        <SimpleForm action={savePage} hidden={{ slug }} fields={[
          { name: "title", label: "Titre", required: true, defaultValue: p?.title ?? CMS_PAGES[slug] },
          { name: "metaDescription", label: "Meta description", defaultValue: p?.metaDescription },
          { name: "content", label: "Contenu (Markdown : ## titres, **gras**, - listes, [liens](https://…))", type: "textarea", rows: 24, required: true, defaultValue: p?.content, span: true },
          { name: "published", label: "Publiée", type: "checkbox", defaultChecked: p?.published },
        ]} />
      </Card>
    </>
  );
}
