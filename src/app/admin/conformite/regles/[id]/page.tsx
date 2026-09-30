import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/card";
import { RuleForm, RuleLifecycle, type RuleFormValue } from "@/components/admin/rule-form";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { can } from "@/lib/domain/permissions";
import { ruleStatusLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { Zone } from "@/lib/domain/eligibility";

const zonesText = (zones: Zone[] | undefined) => (zones ?? []).map((z) => [z.country, z.region ?? "", z.department ?? "", z.postalPrefix ?? ""].join("/").replace(/\/+$/, "")).join("\n");
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function RulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ espece?: string }> }) {
  const user = await requirePermission("compliance.read");
  const { id } = await params;
  const isNew = id === "nouveau";
  if (isNew && !can(user.role, "compliance.rules.write")) notFound();
  const [rule, species] = await Promise.all([
    isNew ? null : db.complianceRule.findUnique({ where: { id }, include: { reviewedBy: { select: { email: true } }, supersedes: { select: { id: true, version: true } }, supersededBy: { select: { id: true, version: true } } } }),
    db.species.findMany({ orderBy: { commonName: "asc" }, select: { id: true, commonName: true } }),
  ]);
  if (!isNew && !rule) notFound();
  const history = rule ? await db.complianceRule.findMany({ where: { code: rule.code }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true, reviewedAt: true } }) : [];
  const cond = (rule?.conditions ?? {}) as { mode?: string; zones?: Zone[]; methods?: string[]; shipDays?: number[] };
  const value: RuleFormValue = rule ? {
    id: rule.id, code: rule.code, name: rule.name, jurisdiction: rule.jurisdiction, type: rule.type, basis: rule.basis, speciesId: rule.speciesId, regulatoryCategory: rule.regulatoryCategory,
    productTypes: rule.productTypes, mode: cond.mode ?? null, zonesText: zonesText(cond.zones), methods: cond.methods, shipDays: cond.shipDays, requiredDocuments: rule.requiredDocuments,
    minimumAge: rule.minimumAge, customerMessage: rule.customerMessage, legalReference: rule.legalReference, sourceUrl: rule.sourceUrl, effectiveFrom: day(rule.effectiveFrom), effectiveUntil: day(rule.effectiveUntil),
  } : { speciesId: (await searchParams).espece ?? null, productTypes: ["ANIMAL"], effectiveFrom: day(new Date()) };
  const locked = Boolean(rule && rule.status !== "DRAFT") || !can(user.role, "compliance.rules.write");

  return (
    <>
      <PageHeader title={rule ? `${rule.code} — version ${rule.version}` : "Nouvelle règle"} description={rule?.name}>
        {rule && <Badge tone={rule.status === "ACTIVE" ? "success" : rule.status === "DRAFT" ? "warning" : "muted"}>{ruleStatusLabel[rule.status]}</Badge>}
      </PageHeader>
      <Alert className="mb-6">Ne saisissez que des règles vérifiées : une obligation légale doit citer sa référence (texte, article, arrêté) et idéalement la source officielle. Une politique commerciale doit être présentée comme telle.</Alert>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card><RuleForm rule={value} species={species} locked={locked} /></Card>
        {rule && (
          <div className="space-y-6">
            <Card>
              <h2 className="mb-3 font-semibold">Cycle de vie</h2>
              {rule.reviewedAt && <p className="mb-3 text-sm">Validée le {formatDate(rule.reviewedAt, { dateStyle: "long", timeStyle: "short" })} par {rule.reviewedBy?.email}</p>}
              <RuleLifecycle ruleId={rule.id} status={rule.status} canApprove={can(user.role, "compliance.rules.approve")} canWrite={can(user.role, "compliance.rules.write")} />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Versions</h2>
              <ul className="space-y-1 text-sm">{history.map((h) => <li key={h.id}><Link href={`/admin/conformite/regles/${h.id}`} className={h.id === rule.id ? "font-semibold" : "text-primary hover:underline"}>v{h.version}</Link> — {ruleStatusLabel[h.status]}{h.reviewedAt ? ` · ${formatDate(h.reviewedAt, { dateStyle: "short" })}` : ""}</li>)}</ul>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
