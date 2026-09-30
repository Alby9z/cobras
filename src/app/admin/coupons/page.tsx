import { Badge, Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { saveCoupon } from "@/server/actions/admin/content";
import type { Coupon } from "@/generated/prisma/client";

const dt = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fields = (c?: Coupon): FieldDef[] => [
  { name: "code", label: "Code", required: true, defaultValue: c?.code },
  { name: "type", label: "Type", type: "select", options: [["PERCENT", "Pourcentage"], ["FIXED", "Montant fixe (€)"], ["FREE_SHIPPING", "Livraison offerte"]], defaultValue: c?.type },
  { name: "value", label: "Valeur (% ou €)", defaultValue: c ? (c.type === "FIXED" ? (c.value / 100).toFixed(2) : c.value) : "" },
  { name: "minOrder", label: "Minimum de commande (€)", defaultValue: c ? (c.minOrderCents / 100).toFixed(2) : "" },
  { name: "maxUses", label: "Utilisations max.", type: "number", defaultValue: c?.maxUses },
  { name: "startsAt", label: "Début", type: "datetime-local", defaultValue: dt(c?.startsAt ?? null) },
  { name: "endsAt", label: "Fin", type: "datetime-local", defaultValue: dt(c?.endsAt ?? null) },
  { name: "accessoriesOnly", label: "Accessoires uniquement", type: "checkbox", defaultChecked: c?.accessoriesOnly },
  { name: "active", label: "Actif", type: "checkbox", defaultChecked: c ? c.active : true },
];

export default async function AdminCoupons() {
  await requirePermission("marketing.write");
  const coupons = await db.coupon.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Codes promotionnels" />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouveau code</h2><SimpleForm action={saveCoupon} fields={fields()} resetOnSuccess /></Card>
      <div className="space-y-3">
        {coupons.map((c) => (
          <details key={c.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{c.code} <span className="text-sm font-normal text-muted-foreground">{c.usedCount} utilisation(s)</span> {!c.active && <Badge tone="muted">Inactif</Badge>}</summary>
            <div className="mt-4"><SimpleForm action={saveCoupon} fields={fields(c)} hidden={{ id: c.id }} /></div>
          </details>
        ))}
      </div>
    </>
  );
}
