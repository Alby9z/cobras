import { Badge, PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { Pagination } from "@/components/pagination";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate } from "@/lib/utils";
import type { EmailStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("system.read");
  const sp = await searchParams;
  const status = (["QUEUED", "SENT", "FAILED"] as EmailStatus[]).find((s) => s === sp.statut);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { ...(status ? { status } : {}), ...(sp.q ? { to: { contains: sp.q } } : {}) };
  const [total, logs] = await Promise.all([db.emailLog.count({ where }), db.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100, select: { id: true, template: true, templateVersion: true, to: true, subject: true, status: true, providerId: true, error: true, retryCount: true, sentAt: true, createdAt: true } })]);
  return (
    <>
      <PageHeader title="Journal des e-mails" description="Chaque e-mail est dédupliqué, envoyé par le worker avec reprises automatiques (5 tentatives, délai croissant) ; les échecs définitifs restent visibles ici." />
      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        <select name="statut" defaultValue={status ?? ""} aria-label="Statut" className="h-10 rounded-lg border border-border bg-card px-3"><option value="">Tous</option><option value="QUEUED">En file</option><option value="SENT">Envoyés</option><option value="FAILED">En échec</option></select>
        <input name="q" defaultValue={sp.q} placeholder="Destinataire" aria-label="Destinataire" className="h-10 rounded-lg border border-border bg-card px-3" />
        <button className="h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Filtrer</button>
      </form>
      <AdminTable head={["Créé", "Modèle", "Destinataire", "Objet", "Statut", "Envoyé", "Tentatives", "ID fournisseur / erreur"]}>
        {logs.map((l) => (
          <tr key={l.id}>
            <td className="whitespace-nowrap text-xs">{formatDate(l.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
            <td className="text-xs">{l.template} v{l.templateVersion}</td>
            <td className="text-xs">{l.to}</td>
            <td className="max-w-xs truncate text-xs">{l.subject}</td>
            <td><Badge tone={l.status === "SENT" ? "success" : l.status === "FAILED" ? "danger" : "warning"}>{l.status}</Badge></td>
            <td className="text-xs">{l.sentAt ? formatDate(l.sentAt, { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
            <td>{l.retryCount}</td>
            <td className="max-w-xs truncate text-xs">{l.providerId ?? l.error ?? "—"}</td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 100))} basePath="/admin/emails" params={sp} />
    </>
  );
}
