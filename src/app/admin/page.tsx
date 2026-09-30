import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { formatPrice } from "@/lib/utils";
import { orderStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

function Kpi({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (<Card className="h-full"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</Card>);
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

/** Indicateurs calculés en direct sur les données réelles (30 derniers jours). */
export default async function Dashboard() {
  const user = await requirePermission("dashboard.view");
  const since = new Date(Date.now() - 30 * 24 * 3600e3);
  const finance = can(user.role, "payments.read") || can(user.role, "analytics.read");
  const [paid, refunds, ordersPaid, byStatus, docs, leads, animals, lowStock, carts, failedEmails, failedEvents, openCases] = await Promise.all([
    db.payment.aggregate({ where: { status: "SUCCEEDED", capturedAt: { gte: since } }, _sum: { amountCents: true } }),
    db.refund.aggregate({ where: { createdAt: { gte: since } }, _sum: { amountCents: true } }),
    db.order.findMany({ where: { createdAt: { gte: since }, amountPaidCents: { gt: 0 } }, select: { totalCents: true } }),
    db.order.groupBy({ by: ["status"], _count: true, where: { status: { notIn: ["DRAFT"] } } }),
    db.document.count({ where: { status: "PENDING_REVIEW" } }),
    db.contactRequest.groupBy({ by: ["kind"], _count: true, where: { status: "NEW" } }),
    db.animal.groupBy({ by: ["status"], _count: true }),
    db.product.findMany({ where: { status: "PUBLISHED", type: { not: "ANIMAL" } }, select: { id: true, name: true, stockOnHand: true, stockReserved: true, lowStockAlert: true }, orderBy: { stockOnHand: "asc" }, take: 100 }),
    db.cart.count({ where: { items: { some: {} }, createdAt: { gte: since } } }),
    db.emailLog.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    db.stripeEvent.count({ where: { status: "FAILED" } }),
    db.complianceCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW", "AWAITING_DOCUMENTS"] } } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const net = (paid._sum.amountCents ?? 0) - (refunds._sum.amountCents ?? 0);
  const avg = ordersPaid.length ? Math.round(ordersPaid.reduce((s, o) => s + o.totalCents, 0) / ordersPaid.length) : 0;
  const conversion = carts ? ((ordersPaid.length / carts) * 100).toFixed(1) : "—";
  const low = lowStock.filter((p) => p.stockOnHand - p.stockReserved <= p.lowStockAlert);
  const available = animals.find((a) => a.status === "AVAILABLE")?._count ?? 0;

  return (
    <>
      <PageHeader title="Tableau de bord" description="Données réelles des 30 derniers jours." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {finance && <Kpi label="Encaissements nets" value={formatPrice(net)} hint="Encaissé − remboursé" />}
        {finance && <Kpi label="Commandes payées" value={ordersPaid.length} hint={`Panier moyen ${formatPrice(avg)}`} />}
        {finance && <Kpi label="Conversion panier → commande" value={`${conversion} %`} hint={`${carts} panier(s) créé(s)`} />}
        <Kpi label="Animaux disponibles" value={available} href="/admin/produits?animal=AVAILABLE" />
        <Kpi label="Dossiers de conformité ouverts" value={openCases} href="/admin/conformite" />
        <Kpi label="Documents à vérifier" value={docs} href="/admin/documents" />
        <Kpi label="Prêtes à préparer" value={count("READY_FOR_FULFILLMENT")} href="/admin/commandes?status=READY_FOR_FULFILLMENT" />
        <Kpi label="Soldes attendus" value={count("AWAITING_BALANCE")} href="/admin/commandes?status=AWAITING_BALANCE" />
        <Kpi label="Leads / devis / audits" value={leads.map((l) => l._count).reduce((a, b) => a + b, 0)} hint={leads.map((l) => `${l.kind} ${l._count}`).join(" · ") || "aucun nouveau"} href="/admin/demandes" />
        {finance && <Kpi label="Remboursements (30 j)" value={formatPrice(refunds._sum.amountCents ?? 0)} />}
        <Kpi label="Erreurs système" value={failedEmails + failedEvents} hint={`${failedEmails} e-mail(s), ${failedEvents} événement(s) Stripe`} href="/admin/systeme" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Commandes par statut</h2>
          <ul className="space-y-1 text-sm">
            {byStatus.sort((a, b) => b._count - a._count).map((b) => <li key={b.status} className="flex justify-between"><Link href={`/admin/commandes?status=${b.status}`} className="hover:underline">{orderStatusLabel[b.status]}</Link><span className="font-semibold tabular-nums">{b._count}</span></li>)}
            {!byStatus.length && <li className="text-muted-foreground">Aucune commande.</li>}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Stock critique</h2>
          {!low.length ? <p className="text-sm text-muted-foreground">Aucun article sous le seuil d&apos;alerte.</p> : (
            <ul className="space-y-1 text-sm">{low.map((p) => <li key={p.id} className="flex justify-between"><Link href={`/admin/produits/${p.id}`} className="hover:underline">{p.name}</Link><span className="font-semibold text-danger tabular-nums">{p.stockOnHand - p.stockReserved}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
