import { Badge, Card, PageHeader } from "@/components/ui/card";
import type { FieldDef } from "@/components/admin/simple-forms";
import { Checkbox } from "@/components/ui/form";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { saveShippingRate } from "@/server/actions/admin/content";
import { COUNTRIES } from "@/lib/geo-fr";
import { shippingMethodLabel } from "@/lib/labels";
import { formatPrice } from "@/lib/utils";
import type { ShippingRate } from "@/generated/prisma/client";

function RateForm({ r }: { r?: ShippingRate }) {
  const fields: FieldDef[] = [
    { name: "name", label: "Nom affiché", required: true, defaultValue: r?.name },
    { name: "method", label: "Mode", type: "select", options: Object.entries(shippingMethodLabel), defaultValue: r?.method ?? "SPECIALIZED_CARRIER" },
    { name: "price", label: "Prix TTC (€)", required: true, defaultValue: r ? (r.priceCents / 100).toFixed(2) : "" },
    { name: "freeAbove", label: "Offert à partir de (€)", defaultValue: r?.freeAboveCents != null ? (r.freeAboveCents / 100).toFixed(2) : "" },
    { name: "position", label: "Ordre", type: "number", defaultValue: r?.position ?? 0 },
    { name: "active", label: "Actif", type: "checkbox", defaultChecked: r ? r.active : true },
  ];
  return (
    <ActionForm action={saveShippingRate} resetOnSuccess={!r} className="space-y-4">
      {r && <input type="hidden" name="id" value={r.id} />}
      <div className="grid gap-4 md:grid-cols-3">
        {fields.map((f) => f.type === "checkbox" ? <Checkbox key={f.name} name={f.name} defaultChecked={f.defaultChecked} label={f.label} className="self-end" /> : (
          <div key={f.name}>
            <label htmlFor={`${r?.id ?? "n"}-${f.name}`} className="mb-1.5 block text-sm font-medium">{f.label}</label>
            {f.type === "select" ? <select id={`${r?.id ?? "n"}-${f.name}`} name={f.name} defaultValue={f.defaultValue ?? ""} className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm">{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              : <input id={`${r?.id ?? "n"}-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={f.defaultValue ?? ""} required={"required" in f && f.required} className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm" />}
          </div>
        ))}
      </div>
      <fieldset><legend className="mb-2 text-sm font-medium">Pays desservis (sauf retrait)</legend>
        <div className="flex flex-wrap gap-4">{Object.entries(COUNTRIES).map(([c, n]) => <Checkbox key={c} name="countries" value={c} defaultChecked={r ? r.countries.includes(c) : c === "FR"} label={n} />)}</div>
      </fieldset>
      <SubmitButton>Enregistrer</SubmitButton>
    </ActionForm>
  );
}

export default async function AdminShipping() {
  await requirePermission("shipping.write");
  const rates = await db.shippingRate.findMany({ orderBy: { position: "asc" } });
  return (
    <>
      <PageHeader title="Livraison" description="Les modes réellement proposés sont filtrés selon les espèces du panier (un animal vivant n'est jamais proposé en colis standard)." />
      <Card className="mb-8"><h2 className="mb-4 font-semibold">Nouveau tarif</h2><RateForm /></Card>
      <div className="space-y-3">
        {rates.map((r) => (
          <details key={r.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">{r.name} <span className="text-sm font-normal text-muted-foreground">{shippingMethodLabel[r.method]} · {formatPrice(r.priceCents)}</span> {!r.active && <Badge tone="muted">Inactif</Badge>}</summary>
            <div className="mt-4"><RateForm r={r} /></div>
          </details>
        ))}
      </div>
    </>
  );
}
