import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/order-status";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { formatDate, formatPrice } from "@/lib/utils";

export const metadata = { title: "Mes commandes" };

export default async function OrdersPage() {
  const user = await requireUser("/compte/commandes");
  const orders = await withUserScope(user.id, (tx) => tx.order.findMany({ where: { userId: user.id, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } } }));
  return (
    <>
      <PageHeader title="Mes commandes" />
      {orders.length === 0 ? <Card><p className="text-muted-foreground">Vous n&apos;avez pas encore passé de commande.</p></Card> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-3">Commande</th><th className="p-3">Date</th><th className="p-3">Articles</th><th className="p-3">Total</th><th className="p-3">Statut</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="p-3"><Link href={`/compte/commandes/${o.number}`} className="font-semibold text-primary hover:underline">{o.number}</Link></td>
                  <td className="p-3">{formatDate(o.createdAt, { dateStyle: "medium" })}</td>
                  <td className="p-3">{o._count.items}</td>
                  <td className="p-3">{formatPrice(o.totalCents)}</td>
                  <td className="p-3"><OrderStatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
