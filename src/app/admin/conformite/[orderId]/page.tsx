import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/order-status";
import { EligibilityReport } from "@/components/admin/eligibility-report";
import { ApproveForm, DocumentReviewForm, RejectForm, RequestDocsForm } from "@/components/admin/order-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { caseStatusLabel, documentStatusLabel, documentTypeLabel, paymentStrategyLabel } from "@/lib/labels";
import { formatDate, formatPrice, ageOn } from "@/lib/utils";
import type { EligibilityResult } from "@/lib/domain/eligibility";

export const dynamic = "force-dynamic";

export default async function ComplianceCasePage({ params }: { params: Promise<{ orderId: string }> }) {
  const viewer = await requirePermission("compliance.read");
  const { orderId } = await params;
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: true, items: true,
      complianceCase: { include: { decidedBy: { select: { email: true } }, evaluations: { orderBy: { createdAt: "desc" } } } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order || !order.complianceCase) notFound();
  const kase = order.complianceCase;
  const ev = kase.lastEvaluation as unknown as EligibilityResult;
  const docs = await db.document.findMany({ where: { userId: order.userId }, orderBy: { createdAt: "desc" } });
  const addr = order.shippingAddress as Record<string, string | null>;
  const open = ["COMPLIANCE_PENDING", "DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW"].includes(order.status);
  const canDecide = can(viewer.role, "compliance.review");
  const auth = order.payments.find((p) => p.status === "AUTHORIZED");

  return (
    <>
      <PageHeader title={`Dossier de conformité n° ${kase.number}`} description={`Commande ${order.number} — ${paymentStrategyLabel[order.paymentStrategy]}`}>
        <div className="flex items-center gap-2"><Badge>{caseStatusLabel[kase.status]}</Badge><OrderStatusBadge status={order.status} /></div>
      </PageHeader>
      {auth?.authorizationExpiresAt && <Alert tone="warning" className="mb-6">Autorisation bancaire de {formatPrice(auth.amountCents)} valable jusqu&apos;au {formatDate(auth.authorizationExpiresAt, { dateStyle: "long", timeStyle: "short" })}. Passé ce délai, un nouveau paiement devra être demandé au client.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card><h2 className="mb-3 font-semibold">Dernière évaluation</h2><EligibilityReport r={ev} /></Card>

          <Card>
            <h2 className="mb-3 font-semibold">Données utilisées</h2>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Client</dt><dd>{order.user.firstName} {order.user.lastName} ({order.user.email})</dd>
              <dt className="text-muted-foreground">Date de naissance</dt><dd>{formatDate(order.user.birthDate)} — {ageOn(order.user.birthDate)} ans</dd>
              <dt className="text-muted-foreground">Email vérifié</dt><dd>{order.user.emailVerified ? "Oui" : "Non"}</dd>
              <dt className="text-muted-foreground">Adresse de détention</dt><dd>{addr.line1}, {addr.postalCode} {addr.city} ({addr.country})</dd>
              <dt className="text-muted-foreground">Mode de remise</dt><dd>{order.shippingMethod}</dd>
            </dl>
            <ul className="mt-3 divide-y divide-border text-sm">{order.items.map((i) => <li key={i.id} className="py-1.5">{i.name}{i.speciesName ? <em className="text-muted-foreground"> — {i.speciesName}</em> : null}</li>)}</ul>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Documents du client</h2>
            {docs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun document déposé.</p> : (
              <ul className="space-y-3">
                {docs.map((d) => (
                  <li key={d.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><strong>{documentTypeLabel[d.type]}</strong> · {d.originalName} · {formatDate(d.createdAt, { dateStyle: "short" })}{d.expiresAt ? ` · expire le ${formatDate(d.expiresAt, { dateStyle: "short" })}` : ""}</span>
                      <span className="flex items-center gap-3">
                        <Badge tone={d.status === "APPROVED" ? "success" : d.status === "PENDING_REVIEW" ? "warning" : "danger"}>{documentStatusLabel[d.status]}</Badge>
                        {can(viewer.role, "documents.read_sensitive") && ["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(d.status) && <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ouvrir</a>}
                      </span>
                    </div>
                    {d.status === "PENDING_REVIEW" && can(viewer.role, "documents.review") && <div className="mt-3"><DocumentReviewForm documentId={d.id} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Historique des évaluations</h2>
            <ol className="space-y-2 text-sm">
              {kase.evaluations.map((e) => {
                const r = e.result as unknown as EligibilityResult;
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{formatDate(e.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>
                    <Badge tone="muted">{e.stage}</Badge>
                    <Badge tone={e.allowed ? "success" : "danger"}>{e.allowed ? "Conforme" : "Non conforme"}</Badge>
                    <code className="text-xs">{e.ruleSetVersion}</code>
                    {r.reasons.length > 0 && <span className="text-xs text-danger">{r.reasons.map((x) => x.code).join(", ")}</span>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {kase.decidedAt && (
            <Card>
              <h2 className="font-semibold">Décision</h2>
              <p className="mt-2 text-sm">{caseStatusLabel[kase.status]} le {formatDate(kase.decidedAt, { dateStyle: "long", timeStyle: "short" })}{kase.decidedBy ? ` par ${kase.decidedBy.email}` : " (automatique)"}</p>
              {kase.justification && <p className="mt-2 rounded-lg bg-muted p-3 text-sm">{kase.justification}</p>}
              {kase.overridden && <Alert tone="warning" className="mt-3">Dérogation : {kase.overriddenChecks.join(", ")}</Alert>}
            </Card>
          )}
          {open && canDecide && (
            <>
              <Card><h2 className="mb-3 font-semibold">Approuver</h2><ApproveForm orderId={order.id} blocked={ev.reasons.length > 0 || ev.requiredDocuments.some((d) => d.status !== "APPROVED")} canOverride={can(viewer.role, "compliance.override")} /><p className="mt-2 text-xs text-muted-foreground">Les contrôles sont réévalués au moment de la décision avec les règles en vigueur.</p></Card>
              <Card><h2 className="mb-3 font-semibold">Demander des documents</h2><RequestDocsForm orderId={order.id} /></Card>
              <Card><h2 className="mb-3 font-semibold">Refuser</h2><RejectForm orderId={order.id} /></Card>
            </>
          )}
          <Link href={`/admin/commandes/${order.id}`} className="block text-sm text-primary underline">Voir la commande (paiements, logistique)</Link>
        </div>
      </div>
    </>
  );
}
