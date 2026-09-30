import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { OrderStatusBadge } from "@/components/order-status";
import { Pagination } from "@/components/pagination";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate, formatPrice } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/labels";
import type { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export default async function AdminOrders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("orders.read");
  const sp = await searchParams;
  const status = sp.status && sp.status in orderStatusLabel ? (sp.status as OrderStatus) : undefined;
  const q = sp.q?.trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : { status: { notIn: ["DRAFT"] } }),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { user: { lastName: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { user: { select: { firstName: true, lastName: true, email: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Commandes" description={`${total} commande(s)`} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><a download href={`/api/admin/export/commandes${status ? `?status=${encodeURIComponent(status)}` : ""}`} className="order-last h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Exporter CSV</a>
      <form className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">Recherche</label>
        <input id="q" name="q" defaultValue={q} placeholder="N°, email, nom…" className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
        <label htmlFor="status" className="sr-only">Statut</label>
        <select id="status" name="status" defaultValue={status ?? ""} className="h-10 rounded-lg border border-border bg-card px-3 text-sm">
          <option value="">Tous</option>
          {Object.entries(orderStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Filtrer</button>
      </form></div>
      <AdminTable head={["N°", "Date", "Client", "Total", "Encaissé", "Animaux", "Statut"]}>
        {orders.map((o) => (
          <tr key={o.id}>
            <td><Link href={`/admin/commandes/${o.id}`} className="font-semibold text-primary hover:underline">{o.number}</Link></td>
            <td className="whitespace-nowrap">{formatDate(o.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
            <td>{o.user.firstName} {o.user.lastName}<br /><span className="text-xs text-muted-foreground">{o.user.email}</span></td>
            <td>{formatPrice(o.totalCents)}</td>
            <td>{formatPrice(o.amountPaidCents)}</td>
            <td>{o.containsAnimals ? "Oui" : "—"}</td>
            <td><OrderStatusBadge status={o.status} /></td>
          </tr>
        ))}
      </AdminTable>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 50))} basePath="/admin/commandes" params={sp} />
    </>
  );
}
