import { Badge, Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { saveTaxRate } from "@/server/actions/admin/catalog";
import type { TaxRate } from "@/generated/prisma/client";

const fields = (t?: TaxRate): FieldDef[] => [
  { name: "code", label: "Code", required: true, defaultValue: t?.code, hint: "Ex. FR-STANDARD" },
  { name: "name", label: "Libellé", required: true, defaultValue: t?.name },
  { name: "rate", label: "Taux (%)", required: true, defaultValue: t ? (t.rateBps / 100).toString() : "", hint: "Vérifiez le taux applicable auprès de votre expert-comptable." },
  { name: "country", label: "Pays", required: true, defaultValue: t?.country ?? "FR" },
  { name: "active", label: "Actif", type: "checkbox", defaultChecked: t ? t.active : true },
];

export default async function TaxPage() {
  await requirePermission("settings.write");
  const rates = await db.taxRate.findMany({ orderBy: { rateBps: "desc" }, include: { _count: { select: { products: true } } } });
  return (
    <>
      <PageHeader title="Taux de TVA" description="Aucun taux n'est prérempli. Les commandes conservent le taux appliqué au moment de l'achat ; un taux utilisé ne peut pas être modifié (créez-en un nouveau)." />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouveau taux</h2><SimpleForm action={saveTaxRate} fields={fields()} resetOnSuccess /></Card>
      <div className="space-y-3">
        {rates.map((t) => (
          <details key={t.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{t.name} — {t.rateBps / 100} % <span className="text-sm font-normal text-muted-foreground">{t.code} · {t._count.products} produit(s)</span> {!t.active && <Badge tone="muted">Inactif</Badge>}</summary>
            <div className="mt-4"><SimpleForm action={saveTaxRate} fields={fields(t)} hidden={{ id: t.id }} /></div>
          </details>
        ))}
      </div>
    </>
  );
}
