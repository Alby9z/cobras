import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { SpeciesForm } from "@/components/admin/species-form";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { ruleStatusLabel, ruleTypeLabel } from "@/lib/labels";

export default async function EditSpecies({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("compliance.read");
  const { id } = await params;
  const isNew = id === "nouveau";
  if (isNew && !can(user.role, "compliance.rules.write")) notFound();
  const species = isNew ? null : await db.species.findUnique({ where: { id }, include: { rules: { orderBy: [{ code: "asc" }, { version: "desc" }] } } });
  if (!isNew && !species) notFound();
  const categoryRules = species ? await db.complianceRule.findMany({ where: { regulatoryCategory: species.regulatoryCategory, status: "ACTIVE" } }) : [];
  return (
    <>
      <PageHeader title={isNew ? "Nouvelle espèce" : species!.commonName} description={species?.scientificName} />
      {species && (
        <Card className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Règles de conformité applicables</h2>
            {can(user.role, "compliance.rules.write") && <Link href={`/admin/conformite/regles/nouveau?espece=${species.id}`} className="text-sm font-semibold text-primary underline">Créer une règle pour cette espèce</Link>}
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {[...species.rules, ...categoryRules].map((r) => (
              <li key={r.id}><Link href={`/admin/conformite/regles/${r.id}`} className="text-primary hover:underline"><code>{r.code}@v{r.version}</code></Link> — {ruleTypeLabel[r.type]} · <Badge tone={r.status === "ACTIVE" ? "success" : "muted"}>{ruleStatusLabel[r.status]}</Badge>{r.regulatoryCategory ? " · via la catégorie" : ""}</li>
            ))}
            {!species.rules.length && !categoryRules.length && <li className="text-danger">Aucune règle : les animaux de cette espèce ne peuvent pas être vendus.</li>}
          </ul>
        </Card>
      )}
      <Card><SpeciesForm species={species ? { ...species } : undefined} readOnly={!can(user.role, "compliance.rules.write")} /></Card>
    </>
  );
}
