import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminTable } from "@/components/admin/table";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { regulatoryCategoryLabel } from "@/lib/labels";

export default async function AdminSpecies() {
  const user = await requirePermission("compliance.read");
  const [species, categoryRules] = await Promise.all([
    db.species.findMany({ orderBy: { commonName: "asc" }, include: { _count: { select: { animals: true } }, rules: { where: { status: "ACTIVE" }, select: { id: true } } } }),
    db.complianceRule.findMany({ where: { status: "ACTIVE", regulatoryCategory: { not: null } }, select: { regulatoryCategory: true } }),
  ]);
  const covered = new Set(categoryRules.map((r) => r.regulatoryCategory));
  return (
    <>
      <PageHeader title="Espèces" description="Référentiel taxonomique, transport et maintenance. La couverture indique si au moins une règle validée s'applique (sinon, les animaux de l'espèce ne peuvent pas être vendus).">
        {can(user.role, "compliance.rules.write") && <Button asChild><Link href="/admin/especes/nouveau">Nouvelle espèce</Link></Button>}
      </PageHeader>
      <AdminTable head={["Espèce", "Catégorie", "CITES", "Règles actives", "Animaux"]}>
        {species.map((s) => {
          const ok = s.rules.length > 0 || covered.has(s.regulatoryCategory);
          return (
            <tr key={s.id}>
              <td><Link href={`/admin/especes/${s.id}`} className="font-semibold text-primary hover:underline">{s.commonName}</Link><span className="block text-xs italic text-muted-foreground">{s.scientificName}</span></td>
              <td><Badge tone={s.regulatoryCategory === "SALE_PROHIBITED" ? "danger" : s.regulatoryCategory === "SALE_ALLOWED" ? "success" : "warning"}>{regulatoryCategoryLabel[s.regulatoryCategory]}</Badge></td>
              <td>{s.citesAnnex ?? "—"}</td>
              <td>{ok ? <Badge tone="success">{s.rules.length} spécifique(s){covered.has(s.regulatoryCategory) ? " + catégorie" : ""}</Badge> : <Badge tone="danger">Non couverte</Badge>}</td>
              <td>{s._count.animals}</td>
            </tr>
          );
        })}
      </AdminTable>
    </>
  );
}
