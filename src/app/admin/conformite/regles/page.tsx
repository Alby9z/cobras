import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminTable } from "@/components/admin/table";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { regulatoryCategoryLabel, ruleBasisLabel, ruleStatusLabel, ruleTypeLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { ruleSetVersion } from "@/lib/domain/eligibility";
import type { RuleStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const user = await requirePermission("compliance.read");
  const { statut } = await searchParams;
  const status = statut && statut in ruleStatusLabel ? (statut as RuleStatus) : undefined;
  const [rules, active] = await Promise.all([
    db.complianceRule.findMany({ where: status ? { status } : { status: { in: ["DRAFT", "ACTIVE"] } }, orderBy: [{ status: "asc" }, { code: "asc" }, { version: "desc" }], include: { species: { select: { commonName: true } }, reviewedBy: { select: { email: true } } } }),
    db.complianceRule.findMany({ where: { status: "ACTIVE" }, select: { code: true, version: true } }),
  ]);
  return (
    <>
      <PageHeader title="Règles de conformité" description={`Jeu de règles actif : ${ruleSetVersion(active)} (${active.length} règle(s)). Chaque règle est versionnée, sourcée et validée avant publication ; les évaluations enregistrent la version appliquée.`}>
        {can(user.role, "compliance.rules.write") && <Button asChild><Link href="/admin/conformite/regles/nouveau">Nouvelle règle</Link></Button>}
      </PageHeader>
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filtrer par statut">
        <Link href="/admin/conformite/regles" className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">Brouillons et actives</Link>
        {Object.entries(ruleStatusLabel).map(([k, v]) => <Link key={k} href={`/admin/conformite/regles?statut=${k}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">{v}</Link>)}
      </nav>
      <AdminTable head={["Règle", "Type", "Périmètre", "Fondement", "Statut", "Validation"]}>
        {rules.map((r) => (
          <tr key={r.id}>
            <td><Link href={`/admin/conformite/regles/${r.id}`} className="font-semibold text-primary hover:underline"><code>{r.code}@v{r.version}</code></Link><span className="block text-xs text-muted-foreground">{r.name}</span></td>
            <td>{ruleTypeLabel[r.type]}</td>
            <td className="text-xs">{[r.species?.commonName, r.regulatoryCategory && regulatoryCategoryLabel[r.regulatoryCategory], r.productTypes.join(", ")].filter(Boolean).join(" · ") || "Global"}</td>
            <td className="text-xs">{ruleBasisLabel[r.basis]}{r.legalReference ? <span className="block text-muted-foreground">{r.legalReference}</span> : null}</td>
            <td><Badge tone={r.status === "ACTIVE" ? "success" : r.status === "DRAFT" ? "warning" : "muted"}>{ruleStatusLabel[r.status]}</Badge></td>
            <td className="text-xs">{r.reviewedAt ? `${formatDate(r.reviewedAt, { dateStyle: "short" })} · ${r.reviewedBy?.email ?? "—"}` : "—"}</td>
          </tr>
        ))}
      </AdminTable>
    </>
  );
}
