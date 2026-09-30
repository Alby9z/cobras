import { PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { Pagination } from "@/components/pagination";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action ? { action: { startsWith: sp.action } } : {}),
    ...(sp.entite ? { entity: sp.entite } : {}),
    ...(sp.id ? { entityId: sp.id } : {}),
    ...(sp.acteur ? { actorId: sp.acteur } : {}),
    ...(sp.req ? { requestId: sp.req } : {}),
  };
  const [total, logs] = await Promise.all([db.auditLog.count({ where }), db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100 })]);
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[])] } }, select: { id: true, email: true } });
  return (
    <>
      <PageHeader title="Journal d'audit" description="Ajout seul : la base de données refuse toute modification ou suppression, y compris depuis l'administration." />
      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        {(["action", "entite", "id", "acteur", "req"] as const).map((k) => <input key={k} name={k} defaultValue={sp[k]} placeholder={{ action: "Action (préfixe)", entite: "Entité", id: "ID entité", acteur: "ID acteur", req: "Request ID" }[k]} aria-label={k} className="h-10 rounded-lg border border-border bg-card px-3" />)}
        <button className="h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Filtrer</button>
        <a href="/api/admin/export/audit" download className="h-10 rounded-lg border border-border px-4 py-2 font-semibold hover:bg-muted">Exporter CSV</a>
      </form>
      <AdminTable head={["Date", "Acteur", "Action", "Entité", "Motif", "Détail", "IP / requête"]}>
        {logs.map((l) => (
          <tr key={l.id} className="align-top">
            <td className="whitespace-nowrap">{formatDate(l.createdAt, { dateStyle: "short", timeStyle: "medium" })}</td>
            <td className="text-xs">{actors.find((a) => a.id === l.actorId)?.email ?? l.actorRole ?? "—"}</td>
            <td><code className="text-xs">{l.action}</code></td>
            <td className="text-xs">{l.entity}{l.entityId ? ` · ${l.entityId.slice(0, 14)}` : ""}</td>
            <td className="max-w-xs text-xs">{l.reason ?? "—"}</td>
            <td className="max-w-md text-xs">{(l.before || l.after || l.data) ? <details><summary className="cursor-pointer">voir</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify({ before: l.before, after: l.after, data: l.data }, null, 1)}</pre></details> : "—"}</td>
            <td className="text-xs">{l.ip ?? "—"}<br />{l.requestId?.slice(0, 20)}</td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 100))} basePath="/admin/audit" params={sp} />
    </>
  );
}
