import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { ReplayForm } from "@/components/admin/order-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { formatDate, formatPrice } from "@/lib/utils";
import { can } from "@/lib/domain/permissions";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const user = await requirePermission("payments.read");
  const canReplay = can(user.role, "orders.update");
  const [payments, events] = await Promise.all([
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { order: { select: { id: true, number: true } }, refunds: true } }),
    db.stripeEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 100, select: { id: true, type: true, status: true, attempts: true, lastError: true, receivedAt: true, processedAt: true } }),
  ]);
  return (
    <>
      <PageHeader title="Paiements & événements Stripe" description="La redirection du client n'est jamais une preuve de paiement : l'état est toujours relu auprès de Stripe. Chaque événement est enregistré, dédupliqué et rejouable." />
      <h2 className="mb-3 font-semibold">Paiements récents</h2>
      <AdminTable head={["Date", "Commande", "Type", "Montant", "Statut", "Capture", "Remboursé"]}>
        {payments.map((p) => (
          <tr key={p.id}>
            <td className="whitespace-nowrap text-xs">{formatDate(p.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
            <td><Link href={`/admin/commandes/${p.order.id}`} className="text-primary hover:underline">{p.order.number}</Link></td>
            <td>{p.kind}</td>
            <td>{formatPrice(p.amountCents)}</td>
            <td><Badge tone={p.status === "SUCCEEDED" ? "success" : p.status === "AUTHORIZED" ? "warning" : p.status === "FAILED" ? "danger" : "muted"}>{p.status}</Badge></td>
            <td className="text-xs">{p.manualCapture ? `manuelle${p.authorizationExpiresAt ? ` · expire ${formatDate(p.authorizationExpiresAt, { dateStyle: "short" })}` : ""}` : "automatique"}</td>
            <td>{p.refunds.length ? formatPrice(p.refunds.reduce((s, r) => s + r.amountCents, 0)) : "—"}</td>
          </tr>
        ))}
      </AdminTable>
      <Card className="mt-8">
        <h2 className="mb-3 font-semibold">Événements webhook</h2>
        <AdminTable head={["Reçu", "Type", "Statut", "Tentatives", "Erreur", ""]}>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-xs">{formatDate(e.receivedAt, { dateStyle: "short", timeStyle: "medium" })}</td>
              <td className="text-xs"><code>{e.type}</code><span className="block text-muted-foreground">{e.id}</span></td>
              <td><Badge tone={e.status === "PROCESSED" ? "success" : e.status === "FAILED" ? "danger" : "muted"}>{e.status}</Badge></td>
              <td>{e.attempts}</td>
              <td className="max-w-xs truncate text-xs">{e.lastError ?? "—"}</td>
              <td>{e.status === "FAILED" && canReplay && <ReplayForm eventId={e.id} />}</td>
            </tr>
          ))}
        </AdminTable>
      </Card>
    </>
  );
}
