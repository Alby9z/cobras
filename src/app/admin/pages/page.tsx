import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { CMS_PAGES } from "@/lib/cms";
import { formatDate } from "@/lib/utils";

export default async function AdminPages() {
  await requirePermission("content.write");
  const pages = await db.page.findMany();
  return (
    <>
      <PageHeader title="Pages & mentions légales" description="Rédigez ou faites valider ces textes par un professionnel du droit : ils engagent votre responsabilité. Une page non publiée renvoie une erreur 404." />
      <AdminTable head={["Page", "URL", "Statut", "Mise à jour"]}>
        {Object.entries(CMS_PAGES).map(([slug, label]) => {
          const p = pages.find((x) => x.slug === slug);
          return (
            <tr key={slug}>
              <td><Link href={`/admin/pages/${slug}`} className="font-semibold text-primary hover:underline">{p?.title ?? label}</Link></td>
              <td>/{slug}</td>
              <td>{p?.published ? <Badge tone="success">Publiée</Badge> : p ? <Badge tone="muted">Brouillon</Badge> : <Badge tone="warning">À rédiger</Badge>}</td>
              <td>{p ? formatDate(p.updatedAt, { dateStyle: "short" }) : "—"}</td>
            </tr>
          );
        })}
      </AdminTable>
    </>
  );
}
