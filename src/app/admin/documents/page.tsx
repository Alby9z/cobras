import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { DocumentReviewForm } from "@/components/admin/order-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { documentTypeLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDocuments() {
  await requirePermission("documents.review");
  const docs = await db.document.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true, birthDate: true, orders: { where: { status: { in: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "COMPLIANCE_PENDING"] } }, select: { id: true, number: true } } } } },
  });
  return (
    <>
      <PageHeader title="Documents à valider" description="Vérifiez la concordance nom / prénom / date de naissance et la validité de chaque justificatif. Toute ouverture est journalisée." />
      {docs.length === 0 ? <Card><p className="text-muted-foreground">Aucun document en attente.</p></Card> : (
        <ul className="space-y-4">
          {docs.map((d) => (
            <li key={d.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{documentTypeLabel[d.type]}</p>
                    <p className="text-sm">{d.user.firstName} {d.user.lastName} · né(e) le {formatDate(d.user.birthDate)} · {d.user.email}</p>
                    <p className="text-sm text-muted-foreground">{d.originalName} · {d.extension.toUpperCase()} · {(d.sizeBytes / 1024).toFixed(0)} Ko · déposé le {formatDate(d.createdAt, { dateStyle: "short", timeStyle: "short" })} · SHA-256 {d.sha256.slice(0, 12)}…</p>
                    {d.user.orders.length > 0 && <p className="mt-1 text-sm">Dossiers : {d.user.orders.map((o) => <Link key={o.id} href={`/admin/conformite/${o.id}`} className="mr-2 text-primary underline">{o.number}</Link>)}</p>}
                  </div>
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline">Ouvrir le document</a>
                </div>
                <div className="mt-4"><DocumentReviewForm documentId={d.id} /></div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
