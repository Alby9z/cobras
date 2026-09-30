import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { updateRequest } from "@/server/actions/admin/content";
import { formatDate } from "@/lib/utils";

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("crm.write");
  const { id } = await params;
  const r = await db.contactRequest.findUnique({ where: { id } });
  if (!r) notFound();
  const [staff, history] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ADMIN", "SALES_MANAGER", "SALES_AGENT", "SUPPORT_AGENT"] } }, select: { id: true, firstName: true, lastName: true } }),
    db.contactRequest.findMany({ where: { email: { equals: r.email, mode: "insensitive" }, id: { not: r.id } }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title={r.subject ?? `Demande de ${r.name}`} description={`Reçue le ${formatDate(r.createdAt, { dateStyle: "long", timeStyle: "short" })}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="font-semibold">{r.name}</p>
          <p className="text-sm"><a href={`mailto:${r.email}`} className="text-primary underline">{r.email}</a>{r.phone && <> · <a href={`tel:${r.phone}`} className="text-primary underline">{r.phone}</a></>}</p>
          <p className="mt-4 whitespace-pre-line text-sm">{r.message}</p>
          <p className="mt-4 text-xs text-muted-foreground">Consentement RGPD recueilli le {formatDate(r.consentAt, { dateStyle: "short", timeStyle: "short" })}</p>
          {history.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <h2 className="mb-2 text-sm font-semibold">Historique des échanges ({history.length})</h2>
              <ul className="space-y-2 text-sm">{history.map((h) => <li key={h.id}><a href={`/admin/demandes/${h.id}`} className="text-primary underline">{formatDate(h.createdAt, { dateStyle: "short" })}</a> — {h.subject ?? h.message.slice(0, 80)}</li>)}</ul>
            </div>
          )}
        </Card>
        <Card>
          <SimpleForm action={updateRequest} hidden={{ id: r.id }} fields={[
            { name: "status", label: "Statut", type: "select", options: [["NEW", "Nouvelle"], ["IN_PROGRESS", "En cours"], ["CLOSED", "Clôturée"]], defaultValue: r.status },
            { name: "assignedToId", label: "Attribuée à", type: "select", options: [["", "— Personne —"], ...staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`] as [string, string])], defaultValue: r.assignedToId },
            { name: "internalNotes", label: "Notes internes", type: "textarea", rows: 8, defaultValue: r.internalNotes, span: true },
          ]} />
        </Card>
      </div>
    </>
  );
}
