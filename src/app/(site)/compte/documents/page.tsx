import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { DocumentUpload } from "@/components/document-upload";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { DOCUMENT_QUOTA } from "@/server/documents";
import { documentStatusLabel, documentTypeLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { EligibilityResult } from "@/lib/domain/eligibility";
import type { DocumentType } from "@/generated/prisma/enums";

export const metadata = { title: "Mes documents" };

export default async function DocumentsPage() {
  const user = await requireUser("/compte/documents");
  const { docs, orders } = await withUserScope(user.id, async (tx) => ({
    docs: await tx.document.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    orders: await tx.order.findMany({ where: { userId: user.id, status: { in: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "COMPLIANCE_PENDING"] } }, select: { number: true, reservationExpiresAt: true, complianceCase: { select: { lastEvaluation: true } } } }),
  }));
  const needs = new Map<DocumentType, { status: string; orders: string[]; deadline: Date | null }>();
  for (const o of orders) {
    const ev = o.complianceCase?.lastEvaluation as unknown as EligibilityResult | undefined;
    for (const d of ev?.requiredDocuments ?? []) {
      if (d.status === "APPROVED") continue;
      const cur = needs.get(d.type) ?? { status: d.status, orders: [], deadline: null };
      cur.orders.push(o.number);
      if (o.reservationExpiresAt && (!cur.deadline || o.reservationExpiresAt < cur.deadline)) cur.deadline = o.reservationExpiresAt;
      needs.set(d.type, cur);
    }
  }
  const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 10);
  const used = docs.reduce((s, d) => s + d.sizeBytes, 0);

  return (
    <>
      <PageHeader title="Mes documents" description="Vos justificatifs sont stockés dans un espace privé chiffré, analysés par un antivirus, et consultés uniquement par l'équipe conformité habilitée." />
      {needs.size > 0 && (
        <Card className="mb-6 border-warning/50">
          <h2 className="font-semibold">Documents attendus</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {[...needs.entries()].map(([type, n]) => (
              <li key={type} className="rounded-lg border border-border p-3">
                <p className="font-semibold">{documentTypeLabel[type]}</p>
                <p className="text-muted-foreground">Pourquoi : exigé pour la commande {n.orders.join(", ")} (espèce et adresse de détention).</p>
                <p className="text-muted-foreground">Statut : <strong className="text-foreground">{n.status === "MISSING" ? "manquant" : n.status === "EXPIRED" ? "expiré" : n.status === "REJECTED" ? "refusé" : "en cours de validation"}</strong> · Formats : PDF, JPG, PNG, WEBP · Taille maximale : {maxMb} Mo{n.deadline ? ` · Date limite : ${formatDate(n.deadline, { dateStyle: "long" })}` : ""}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="mb-8">
        <h2 className="mb-4 font-semibold">Déposer un document</h2>
        <DocumentUpload maxMb={maxMb} preselect={[...needs.keys()].find((t) => needs.get(t)!.status !== "PENDING_REVIEW")} />
        <p className="mt-3 text-xs text-muted-foreground">Espace utilisé : {(used / 1024 / 1024).toFixed(1)} Mo sur {DOCUMENT_QUOTA.bytes / 1024 / 1024} Mo ({docs.length}/{DOCUMENT_QUOTA.count} documents).</p>
      </Card>
      <h2 className="mb-3 font-semibold">Documents déposés</h2>
      {docs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun document.</p> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {docs.map((d) => {
            const expired = d.expiresAt && d.expiresAt < new Date();
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-medium">{documentTypeLabel[d.type]}</p>
                  <p className="text-muted-foreground">{d.originalName} · déposé le {formatDate(d.createdAt, { dateStyle: "short" })}{d.expiresAt ? ` · ${expired ? "expiré le" : "valable jusqu'au"} ${formatDate(d.expiresAt, { dateStyle: "short" })}` : ""}</p>
                  {d.reviewNote && d.status === "REJECTED" && <p className="mt-1 text-danger">Motif : {d.reviewNote}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={expired ? "danger" : d.status === "APPROVED" ? "success" : ["REJECTED", "INFECTED", "SCAN_FAILED"].includes(d.status) ? "danger" : "warning"}>{expired ? "Expiré" : documentStatusLabel[d.status]}</Badge>
                  {["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(d.status) && <a href={`/api/documents/${d.id}`} className="text-primary underline">Télécharger</a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {docs.some((d) => d.status === "PENDING_SCAN") && <Alert className="mt-4">Analyse antivirus en cours : actualisez la page dans quelques instants.</Alert>}
    </>
  );
}
