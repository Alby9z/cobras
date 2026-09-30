import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { documentStatusLabel, documentTypeLabel, reasonLabel, ruleBasisLabel, ruleTypeLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { EligibilityResult } from "@/lib/domain/eligibility";

/** Rendu explicable d'une décision : contrôles, motifs, règles (code@version, base, référence), documents, jeu de règles. */
export function EligibilityReport({ r }: { r: EligibilityResult }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={r.decision === "BLOCKED" ? "danger" : r.decision === "ALLOWED" ? "success" : "warning"}>
          {r.decision === "BLOCKED" ? "Bloquée" : r.decision === "DOCUMENTS_REQUIRED" ? "Documents requis" : r.decision === "REVIEW_REQUIRED" ? "Examen humain requis" : "Autorisée"}
        </Badge>
        <span className="text-muted-foreground">Étape {r.stage} · {formatDate(r.evaluatedAt, { dateStyle: "short", timeStyle: "medium" })} · jeu de règles <code>{r.ruleSetVersion}</code></span>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {r.checks.map((c) => (
          <li key={c.code} className="flex items-center gap-2">
            {c.passed ? <Check className="h-4 w-4 text-success" aria-label="Satisfait" /> : <X className="h-4 w-4 text-danger" aria-label="Non satisfait" />}
            <span>{c.label}{c.detail ? <span className="text-muted-foreground"> — {c.detail}</span> : null}</span>
          </li>
        ))}
      </ul>
      {r.reasons.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="font-semibold text-danger">Motifs de blocage</p>
          <ul className="mt-1 space-y-1">{r.reasons.map((x, i) => <li key={i}><Badge tone="danger">{reasonLabel[x.code] ?? x.code}</Badge> {x.message}{x.rule ? <code className="ml-1 text-xs">({x.rule.code}@v{x.rule.version})</code> : null}</li>)}</ul>
        </div>
      )}
      {r.requiredDocuments.length > 0 && (
        <div>
          <p className="font-semibold">Documents exigés</p>
          <ul className="mt-1 space-y-1">{r.requiredDocuments.map((d) => <li key={d.type}>{documentTypeLabel[d.type]} — <Badge tone={d.status === "APPROVED" ? "success" : d.status === "PENDING_REVIEW" ? "warning" : "danger"}>{d.status === "MISSING" ? "Manquant" : d.status === "EXPIRED" ? "Expiré" : documentStatusLabel[d.status]}</Badge> <span className="text-xs text-muted-foreground">({d.rules.map((x) => `${x.code}@v${x.version}`).join(", ")})</span></li>)}</ul>
        </div>
      )}
      <div>
        <p className="font-semibold">Règles appliquées</p>
        {r.appliedRules.length === 0 ? <p className="text-muted-foreground">Aucune règle applicable.</p> : (
          <ul className="mt-1 space-y-1">{r.appliedRules.map((x) => <li key={x.code}><code>{x.code}@v{x.version}</code> — {ruleTypeLabel[x.type]} · {ruleBasisLabel[x.basis]}{x.legalReference ? ` · ${x.legalReference}` : ""}</li>)}</ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Destination évaluée : {[r.destination.country, r.destination.region && `région ${r.destination.region}`, r.destination.department && `dép. ${r.destination.department}`, r.destination.postalCode].filter(Boolean).join(" · ")}{r.warnings.length ? ` · Avertissements : ${r.warnings.join(", ")}` : ""}</p>
    </div>
  );
}
