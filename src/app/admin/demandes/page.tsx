import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate } from "@/lib/utils";

const KIND = { CONTACT: "Contact", QUOTE: "Devis", AUDIT: "Audit" } as const;
const STATUS = { NEW: "Nouvelle", IN_PROGRESS: "En cours", CLOSED: "Clôturée" } as const;

export default async function AdminRequests({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  await requirePermission("crm.write");
  const sp = await searchParams;
  const status = sp.status && sp.status in STATUS ? (sp.status as keyof typeof STATUS) : undefined;
  const kind = sp.kind && sp.kind in KIND ? (sp.kind as keyof typeof KIND) : undefined;
  const items = await db.contactRequest.findMany({ where: { status, kind }, orderBy: { createdAt: "desc" }, take: 200 });
  const emails = [...new Set(items.map((i) => i.email.toLowerCase()))];
  const customers = await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, _count: { select: { orders: true } } } });
  return (
    <>
      <PageHeader title="Demandes & prospects" description="Contacts, devis et audits. Un email déjà client est signalé avec son nombre de commandes." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="kind" defaultValue={kind ?? ""} aria-label="Type" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tous types</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="status" defaultValue={status ?? ""} aria-label="Statut" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tous statuts</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Filtrer</button>
      </form>
      <AdminTable head={["Date", "Type", "Contact", "Objet", "Client ?", "Statut"]}>
        {items.map((r) => {
          const c = customers.find((u) => u.email.toLowerCase() === r.email.toLowerCase());
          return (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{formatDate(r.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
              <td>{KIND[r.kind]}</td>
              <td><Link href={`/admin/demandes/${r.id}`} className="font-semibold text-primary hover:underline">{r.name}</Link><span className="block text-xs text-muted-foreground">{r.email}</span></td>
              <td className="max-w-xs truncate">{r.subject ?? r.message.slice(0, 80)}</td>
              <td>{c ? `Oui (${c._count.orders} cmd)` : "Prospect"}</td>
              <td><Badge tone={r.status === "NEW" ? "warning" : r.status === "IN_PROGRESS" ? "default" : "muted"}>{STATUS[r.status]}</Badge></td>
            </tr>
          );
        })}
      </AdminTable>
    </>
  );
}
