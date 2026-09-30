import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/order-status";
import { CancelForm, FulfilForm, NoteForm, RefundForm } from "@/components/admin/order-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { nextStatuses } from "@/lib/domain/order-state";
import { invoiceKindLabelFr, paymentStrategyLabel, shippingMethodLabel, caseStatusLabel } from "@/lib/labels";
import { formatDate, formatPrice } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders.read");
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      user: true, items: true, complianceCase: { select: { number: true, status: true } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { email: true } } } },
      payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } },
      invoices: { orderBy: { issuedAt: "asc" } },
      reservations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();
  const addr = order.shippingAddress as Record<string, string | null>;
  const next = nextStatuses(order.status, "STAFF");
  const fulfilSteps = (["PREPARING", "SHIPPED", "DELIVERED", "DELIVERY_FAILED"] as const).filter((s) => next.includes(s));
  const refundable = order.amountPaidCents - order.amountRefundedCents;
  const canCancel = next.includes("CANCELLED") && order.amountPaidCents === 0 && order.amountAuthorizedCents === 0;

  return (
    <>
      <PageHeader title={`Commande ${order.number}`} description={`Créée le ${formatDate(order.createdAt, { dateStyle: "long", timeStyle: "short" })} — ${paymentStrategyLabel[order.paymentStrategy]}`}><OrderStatusBadge status={order.status} /></PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {order.complianceCase && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Dossier de conformité n° {order.complianceCase.number} — <Badge>{caseStatusLabel[order.complianceCase.status]}</Badge></p>
              {can(user.role, "compliance.read") && <Link href={`/admin/conformite/${order.id}`} className="text-sm font-semibold text-primary underline">Ouvrir le dossier</Link>}
            </Card>
          )}
          <Card>
            <h2 className="mb-3 font-semibold">Articles (snapshot à la commande)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th className="py-1">Article</th><th>Qté</th><th>PU TTC</th><th>TVA</th><th>Remise</th><th className="text-right">Total TTC</th></tr></thead>
                <tbody>{order.items.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-1.5">{i.name}{i.sku ? <span className="text-muted-foreground"> · {i.sku}</span> : null}{i.speciesName ? <em className="block text-xs text-muted-foreground">{i.speciesName}</em> : null}</td><td>{i.quantity}</td><td>{formatPrice(i.unitCents)}</td><td>{i.taxRateBps / 100} %</td><td>{i.discountCents ? `−${formatPrice(i.discountCents)}` : "—"}</td><td className="text-right">{formatPrice(i.totalCents)}</td></tr>)}</tbody>
              </table>
            </div>
            <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between"><dt>Livraison ({order.shippingTaxRateBps / 100} %)</dt><dd>{formatPrice(order.shippingCents)}</dd></div>
              <div className="flex justify-between"><dt>Total HT</dt><dd>{formatPrice(order.totalExclTaxCents)}</dd></div>
              <div className="flex justify-between"><dt>TVA</dt><dd>{formatPrice(order.taxCents)}</dd></div>
              <div className="flex justify-between font-bold"><dt>Total TTC</dt><dd>{formatPrice(order.totalCents)}</dd></div>
              <div className="flex justify-between"><dt>Encaissé</dt><dd>{formatPrice(order.amountPaidCents)}</dd></div>
              <div className="flex justify-between"><dt>Autorisé non encaissé</dt><dd>{formatPrice(order.amountAuthorizedCents)}</dd></div>
              <div className="flex justify-between"><dt>Remboursé</dt><dd>{formatPrice(order.amountRefundedCents)}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Historique</h2>
            <ol className="space-y-3 border-l-2 border-border pl-4 text-sm">
              {order.events.map((e) => (
                <li key={e.id}><span className="block text-xs text-muted-foreground">{formatDate(e.createdAt, { dateStyle: "short", timeStyle: "short" })} · {e.actor?.email ?? "système"}{e.internal ? " · interne" : ""}{e.fromStatus && e.status ? ` · ${e.fromStatus} → ${e.status}` : ""}{e.requestId ? ` · ${e.requestId.slice(0, 18)}` : ""}</span>{e.message}</li>
              ))}
            </ol>
            <div className="mt-6"><NoteForm orderId={order.id} /></div>
          </Card>
        </div>
        <div className="space-y-6">
          {fulfilSteps.length > 0 && can(user.role, "orders.fulfil") && (
            <Card><h2 className="mb-3 font-semibold">Logistique</h2><div className="space-y-3">{fulfilSteps.map((s) => <FulfilForm key={s} orderId={order.id} step={s} pickup={order.shippingMethod === "PICKUP"} canOverride={can(user.role, "compliance.override")} />)}</div></Card>
          )}
          <Card>
            <h2 className="mb-2 font-semibold">Client & livraison</h2>
            <p className="text-sm">{order.user.firstName} {order.user.lastName} · {order.user.email}</p>
            <p className="mt-2 text-sm">{shippingMethodLabel[order.shippingMethod]} — {order.shippingRateName}</p>
            <address className="mt-1 text-sm not-italic text-muted-foreground">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />{addr.postalCode} {addr.city} ({addr.country}) · {addr.phone}</address>
            {order.trackingNumber && <p className="mt-2 text-sm">Suivi : {order.trackingCarrier} {order.trackingNumber}</p>}
            {order.customerNote && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">Note client : {order.customerNote}</p>}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Réservations</h2>
            <ul className="space-y-1 text-sm">{order.reservations.map((r) => <li key={r.id}>{r.animalId ? "Animal" : "Article"} ×{r.quantity} — <Badge tone={r.status === "RELEASED" ? "muted" : "default"}>{r.status}</Badge>{r.expiresAt ? ` · expire ${formatDate(r.expiresAt, { dateStyle: "short", timeStyle: "short" })}` : ""}</li>)}</ul>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Paiements</h2>
            <ul className="space-y-2 text-sm">
              {order.payments.map((p) => (
                <li key={p.id}>{p.kind} · {formatPrice(p.amountCents)} · <Badge tone={p.status === "SUCCEEDED" ? "success" : p.status === "AUTHORIZED" ? "warning" : "muted"}>{p.status}</Badge>{p.manualCapture ? " · capture manuelle" : ""}{p.failureMessage ? <span className="block text-xs text-danger">{p.failureMessage}</span> : null}
                  {p.refunds.map((r) => <span key={r.id} className="block text-xs text-muted-foreground">Remboursé {formatPrice(r.amountCents)} — {r.reason}</span>)}</li>
              ))}
            </ul>
            {order.invoices.length > 0 && <ul className="mt-3 space-y-1 text-sm">{order.invoices.map((i) => <li key={i.id}>{i.pdfStatus === "READY" ? <a href={`/api/invoices/${i.id}`} className="text-primary underline">{i.number}</a> : `${i.number} (PDF ${i.pdfStatus === "FAILED" ? "en échec" : "en préparation"})`} · {invoiceKindLabelFr[i.kind]} · {formatPrice(i.totalCents)}</li>)}</ul>}
            {can(user.role, "orders.refund") && refundable > 0 && <div className="mt-4 border-t border-border pt-4"><h3 className="mb-2 text-sm font-semibold">Remboursement</h3><RefundForm orderId={order.id} max={refundable} canFull={next.includes("REFUND_PENDING")} /></div>}
            {can(user.role, "orders.update") && canCancel && <div className="mt-4 border-t border-border pt-4"><CancelForm orderId={order.id} /></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
