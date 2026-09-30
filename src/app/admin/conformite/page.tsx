import Link from "next/link";
import { PageHeader, Badge } from "@/components/ui/card";
import { AdminTable } from "@/components/admin/table";
import { OrderStatusBadge } from "@/components/order-status";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { caseStatusLabel, reasonLabel } from "@/lib/labels";
import { formatDate, formatPrice } from "@/lib/utils";
import type { EligibilityResult } from "@/lib/domain/eligibility";
import type { ComplianceCaseStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export default async function ComplianceQueue({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  await requirePermission("compliance.read");
  const { statut } = await searchParams;
  const status = (statut && statut in caseStatusLabel ? [statut] : ["OPEN", "AWAITING_DOCUMENTS", "IN_REVIEW"]) as ComplianceCaseStatus[];
  const cases = await db.complianceCase.findMany({
    where: { status: { in: status }, order: { status: { notIn: ["DRAFT", "PENDING_PAYMENT", "CANCELLED"] } } },
    orderBy: { updatedAt: "asc" },
    take: 200,
    include: { order: { select: { id: true, number: true, status: true, totalCents: true, createdAt: true, paymentStrategy: true, user: { select: { firstName: true, lastName: true } }, payments: { where: { status: "AUTHORIZED" }, select: { authorizationExpiresAt: true } } } } },
  });
  return (
    <>
      <PageHeader title="File d'examen de conformité" description="Commandes en attente de décision, de la plus ancienne à la plus récente. Chaque dossier présente les contrôles, les règles appliquées et les documents examinés." />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filtrer">
        <Link href="/admin/conformite" className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">En cours</Link>
        {Object.entries(caseStatusLabel).map(([k, v]) => <Link key={k} href={`/admin/conformite?statut=${k}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">{v}</Link>)}
      </nav>
      <AdminTable head={["Dossier", "Commande", "Client", "Montant", "Statut commande", "Alertes", "Depuis"]}>
        {cases.map((c) => {
          const ev = c.lastEvaluation as unknown as EligibilityResult;
          const authExpiry = c.order.payments[0]?.authorizationExpiresAt;
          return (
            <tr key={c.id}>
              <td><Link href={`/admin/conformite/${c.order.id}`} className="font-semibold text-primary hover:underline">n° {c.number}</Link><span className="block text-xs text-muted-foreground">{caseStatusLabel[c.status]}</span></td>
              <td>{c.order.number}</td>
              <td>{c.order.user.firstName} {c.order.user.lastName}</td>
              <td>{formatPrice(c.order.totalCents)}</td>
              <td><OrderStatusBadge status={c.order.status} /></td>
              <td className="space-x-1">
                {ev.reasons.slice(0, 3).map((r, i) => <Badge key={i} tone="danger">{reasonLabel[r.code] ?? r.code}</Badge>)}
                {ev.requiredDocuments.filter((d) => d.status !== "APPROVED").length > 0 && <Badge tone="warning">{ev.requiredDocuments.filter((d) => d.status !== "APPROVED").length} doc.</Badge>}
                {authExpiry && authExpiry.getTime() - Date.now() < 48 * 3600e3 && <Badge tone="danger">Autorisation expire {formatDate(authExpiry, { dateStyle: "short" })}</Badge>}
              </td>
              <td className="whitespace-nowrap">{formatDate(c.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
            </tr>
          );
        })}
      </AdminTable>
      {cases.length === 0 && <p className="mt-6 text-center text-muted-foreground">Aucun dossier dans cette file.</p>}
    </>
  );
}
