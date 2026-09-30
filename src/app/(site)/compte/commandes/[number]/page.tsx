import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Alert, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge, CUSTOMER_STEPS } from "@/components/order-status";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { confirmReception, payOrder } from "@/server/actions/account";
import { formatDate, formatPrice, cn } from "@/lib/utils";
import { documentStatusLabel, documentTypeLabel, invoiceKindLabelFr, paymentStrategyLabel, shippingMethodLabel } from "@/lib/labels";
import type { EligibilityResult } from "@/lib/domain/eligibility";

export const metadata = { title: "Suivi de commande" };

export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ paiement?: string }> }) {
  const { number } = await params;
  const { paiement } = await searchParams;
  const user = await requireUser(`/compte/commandes/${number}`);
  const order = await withUserScope(user.id, (tx) =>
    tx.order.findFirst({ where: { number, userId: user.id }, include: { items: true, events: { where: { internal: false }, orderBy: { createdAt: "desc" } }, invoices: { orderBy: { issuedAt: "asc" } }, complianceCase: { select: { lastEvaluation: true } }, reservations: { where: { status: { in: ["ACTIVE", "ALLOCATED"] } }, select: { expiresAt: true } } } }),
  );
  if (!order || order.status === "DRAFT") notFound();
  const evaluation = order.complianceCase?.lastEvaluation as unknown as EligibilityResult | undefined;
  const required = evaluation?.requiredDocuments ?? [];
  const currentStep = CUSTOMER_STEPS.findIndex((s) => s.status.includes(order.status));
  const addr = order.shippingAddress as Record<string, string | null>;
  const due = order.totalCents - order.amountPaidCents;
  const canPay = ["PENDING_PAYMENT", "PAYMENT_FAILED", "AWAITING_BALANCE"].includes(order.status) && order.reservations.length > 0;
  const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 10);

  return (
    <>
      <PageHeader title={`Commande ${order.number}`} description={`Passée le ${formatDate(order.createdAt)} — ${paymentStrategyLabel[order.paymentStrategy]}`}><OrderStatusBadge status={order.status} /></PageHeader>

      {currentStep >= 0 && (
        <ol className="mb-8 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Avancement de la commande">
          {CUSTOMER_STEPS.map((s, i) => (
            <li key={s.label} className={cn("rounded-lg border p-2 text-center text-xs font-medium", i < currentStep ? "border-success/40 bg-success/5 text-success" : i === currentStep ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")} aria-current={i === currentStep ? "step" : undefined}>
              {i < currentStep && <Check className="mx-auto mb-1 h-4 w-4" aria-hidden />}{s.label}
            </li>
          ))}
        </ol>
      )}

      {paiement === "indisponible" && <Alert tone="danger" className="mb-6">Le paiement n&apos;est pas disponible pour cette commande (réservation expirée ou aucun montant dû).</Alert>}
      {canPay && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm">{order.status === "AWAITING_BALANCE" ? <>Votre commande est validée. Montant restant à régler : <strong>{formatPrice(due)}</strong>{order.reservationExpiresAt && <> — réservation conservée jusqu&apos;au {formatDate(order.reservationExpiresAt, { dateStyle: "long", timeStyle: "short" })}</>}.</> : order.status === "PAYMENT_FAILED" ? "Le paiement n'a pas abouti. Vous pouvez réessayer tant que la réservation est active." : "Paiement en attente."}</p>
          <form action={payOrder}><input type="hidden" name="number" value={order.number} /><Button type="submit">Payer {formatPrice(order.status === "AWAITING_BALANCE" ? due : order.amountDueNowCents)}</Button></form>
        </Card>
      )}

      {required.length > 0 && ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "COMPLIANCE_PENDING"].includes(order.status) && (
        <Card className="mb-6">
          <h2 className="font-semibold">Documents pour cette commande</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ils sont exigés par la réglementation ou notre politique de vente pour l&apos;espèce concernée et votre adresse. Formats acceptés : PDF, JPG, PNG, WEBP — {maxMb} Mo maximum.</p>
          <ul className="mt-4 divide-y divide-border text-sm">
            {required.map((d) => (
              <li key={d.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{documentTypeLabel[d.type]}</span>
                <span className={d.status === "APPROVED" ? "text-success" : d.status === "PENDING_REVIEW" ? "text-muted-foreground" : "font-semibold text-warning"}>
                  {d.status === "MISSING" ? "Manquant" : d.status === "EXPIRED" ? "Expiré — à renouveler" : d.status === "REJECTED" ? "Refusé — à renvoyer" : documentStatusLabel[d.status]}
                </span>
              </li>
            ))}
          </ul>
          {order.reservationExpiresAt && order.status === "DOCUMENTS_REQUIRED" && <p className="mt-3 text-sm">Date limite de dépôt : <strong>{formatDate(order.reservationExpiresAt, { dateStyle: "long", timeStyle: "short" })}</strong></p>}
          {order.status === "DOCUMENTS_REQUIRED" && <Button asChild size="sm" className="mt-4"><Link href="/compte/documents">Déposer mes documents</Link></Button>}
        </Card>
      )}
      {order.status === "COMPLIANCE_REJECTED" || order.status === "REFUND_PENDING" ? <Alert tone="danger" className="mb-6">Cette commande n&apos;a pas pu être validée. Tout montant réglé est remboursé et toute autorisation bancaire annulée.</Alert> : null}
      {order.status === "SHIPPED" && (
        <Card className="mb-6">
          <p className="font-semibold">{order.shippingMethod === "PICKUP" ? "Votre commande est prête" : "Votre commande est en route"}</p>
          {order.trackingNumber && <p className="mt-1 text-sm">{order.trackingCarrier} — n° {order.trackingUrl ? <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{order.trackingNumber}</a> : order.trackingNumber}</p>}
          <form action={confirmReception} className="mt-4"><input type="hidden" name="number" value={order.number} /><Button type="submit">Je confirme la réception</Button></form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="mb-3 font-semibold">Articles</h2>
          <ul className="divide-y divide-border text-sm">
            {order.items.map((i) => <li key={i.id} className="flex justify-between py-2"><span>{i.quantity} × {i.name}</span><span>{formatPrice(i.totalCents)}</span></li>)}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            {order.discountCents > 0 && <div className="flex justify-between"><dt>Remise incluse</dt><dd>−{formatPrice(order.discountCents)}</dd></div>}
            <div className="flex justify-between"><dt>Livraison ({order.shippingRateName})</dt><dd>{formatPrice(order.shippingCents)}</dd></div>
            <div className="flex justify-between font-bold"><dt>Total TTC</dt><dd>{formatPrice(order.totalCents)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>dont TVA</dt><dd>{formatPrice(order.taxCents)}</dd></div>
            <div className="flex justify-between text-muted-foreground"><dt>Réglé</dt><dd>{formatPrice(order.amountPaidCents)}</dd></div>
            {order.amountAuthorizedCents > 0 && <div className="flex justify-between text-muted-foreground"><dt>Autorisé (non prélevé)</dt><dd>{formatPrice(order.amountAuthorizedCents)}</dd></div>}
            {order.amountRefundedCents > 0 && <div className="flex justify-between text-muted-foreground"><dt>Remboursé</dt><dd>{formatPrice(order.amountRefundedCents)}</dd></div>}
          </dl>
          <h2 className="mb-3 mt-8 font-semibold">Historique</h2>
          <ol className="space-y-3 border-l-2 border-border pl-4 text-sm">
            {order.events.map((e) => <li key={e.id}><span className="block text-xs text-muted-foreground">{formatDate(e.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>{e.message}</li>)}
          </ol>
        </Card>
        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-semibold">Livraison</h2>
            <p className="text-sm">{shippingMethodLabel[order.shippingMethod]}</p>
            <address className="mt-2 text-sm not-italic text-muted-foreground">{addr.firstName} {addr.lastName}<br />{addr.line1}<br />{addr.line2 && <>{addr.line2}<br /></>}{addr.postalCode} {addr.city}<br />{addr.country}</address>
          </Card>
          {order.invoices.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Factures et avoirs</h2>
              <ul className="space-y-1 text-sm">{order.invoices.map((i) => <li key={i.id}>{i.pdfStatus === "READY" ? <a href={`/api/invoices/${i.id}`} className="text-primary underline">{invoiceKindLabelFr[i.kind]} {i.number}</a> : <span>{invoiceKindLabelFr[i.kind]} {i.number} (PDF en préparation)</span>} — {formatPrice(i.totalCents)}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";

