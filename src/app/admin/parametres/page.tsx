import { Card, PageHeader } from "@/components/ui/card";
import { SimpleForm, type FieldDef } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { saveSettings } from "@/server/actions/admin/content";
import { SETTING_KEYS } from "@/server/settings";
import { paymentStrategyLabel } from "@/lib/labels";

const LONG = new Set(["valueProposition", "about", "openingHours"]);

export default async function AdminSettings() {
  await requirePermission("settings.write");
  const [rows, taxRates] = await Promise.all([db.setting.findMany(), db.taxRate.findMany({ where: { active: true }, orderBy: { code: "asc" } })]);
  const none: [string, string] = ["", "— Non configuré —"];
  const SELECTS: Record<string, [string, string][]> = {
    vatRegime: [none, ["NORMAL", "Régime normal (TVA collectée)"], ["FRANCHISE", "Franchise en base (TVA non applicable)"]],
    paymentStrategyAnimals: [none, ...Object.entries(paymentStrategyLabel)],
    shippingTaxRateCode: [none, ...taxRates.map((t): [string, string] => [t.code, `${t.code} — ${t.name} (${t.rateBps / 100} %)`])],
  };
  const fields: FieldDef[] = Object.entries(SETTING_KEYS).map(([k, label]) => {
    const defaultValue = rows.find((r) => r.key === k)?.value ?? "";
    if (SELECTS[k]) return { name: k, label, type: "select" as const, options: SELECTS[k], defaultValue };
    return LONG.has(k) ? { name: k, label, type: "textarea" as const, defaultValue, span: true, rows: 4 } : { name: k, label, defaultValue };
  });
  return (
    <>
      <PageHeader title="Paramètres de l'entreprise" description="Ces informations alimentent le site, les factures, les emails et les données structurées Google. Seules les informations saisies sont affichées." />
      <Card><SimpleForm action={saveSettings} fields={fields} /></Card>
    </>
  );
}
