"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { saveSpecies } from "@/server/actions/admin/catalog";
import { regulatoryCategoryLabel } from "@/lib/labels";

type S = Record<string, unknown> & { id?: string; shippingMethods?: string[]; allowedShipDays?: number[]; synonyms?: string[] };
const v = (x: unknown) => (x == null ? "" : String(x));
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function F({ name, label, children, hint, className }: { name: string; label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return <div className={className}><Label htmlFor={name}>{label}</Label>{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}<FieldError name={name} /></div>;
}

export function SpeciesForm({ species, readOnly }: { species?: S; readOnly?: boolean }) {
  return (
    <ActionForm action={saveSpecies} className="space-y-6">
      <fieldset disabled={readOnly} className="space-y-6">
        <input type="hidden" name="id" value={v(species?.id)} />
        <div className="grid gap-4 md:grid-cols-2">
          <F name="commonName" label="Nom commun *"><Input id="commonName" name="commonName" required defaultValue={v(species?.commonName)} /></F>
          <F name="scientificName" label="Nom scientifique *"><Input id="scientificName" name="scientificName" required defaultValue={v(species?.scientificName)} /></F>
          <F name="synonyms" label="Synonymes (recherche)" hint="Séparés par des virgules : noms vernaculaires, anciens noms scientifiques."><Input id="synonyms" name="synonyms" defaultValue={species?.synonyms?.join(", ") ?? ""} /></F>
          <F name="family" label="Famille"><Input id="family" name="family" defaultValue={v(species?.family)} /></F>
        </div>
        <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
          <legend className="px-2 font-semibold">Classement réglementaire (information)</legend>
          <p className="text-sm text-muted-foreground md:col-span-3">La catégorie est descriptive. Les exigences effectives (documents, âge, zones, transport) sont définies par des <strong>règles de conformité validées</strong> ; « Vente interdite » bloque toute vente et « Restreinte » impose un examen renforcé.</p>
          <F name="regulatoryCategory" label="Catégorie *" className="md:col-span-2"><Select id="regulatoryCategory" name="regulatoryCategory" defaultValue={v(species?.regulatoryCategory) || "SALE_ALLOWED"}>{Object.entries(regulatoryCategoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
          <F name="citesAnnex" label="Annexe CITES (UE 338/97)"><Select id="citesAnnex" name="citesAnnex" defaultValue={v(species?.citesAnnex)}><option value="">Non listée</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></Select></F>
          <F name="protectionStatus" label="Statut de protection (texte libre, sourcé)" className="md:col-span-3"><Input id="protectionStatus" name="protectionStatus" defaultValue={v(species?.protectionStatus)} /></F>
          <F name="regulatoryNotes" label="Information réglementaire affichée sur les fiches" className="md:col-span-3"><Textarea id="regulatoryNotes" name="regulatoryNotes" rows={3} defaultValue={v(species?.regulatoryNotes)} /></F>
          <F name="restrictionsNotes" label="Restrictions affichées" className="md:col-span-3"><Textarea id="restrictionsNotes" name="restrictionsNotes" rows={2} defaultValue={v(species?.restrictionsNotes)} /></F>
        </fieldset>
        <fieldset className="grid gap-4 rounded-xl border border-border p-4">
          <legend className="px-2 font-semibold">Transport</legend>
          <div className="flex flex-wrap gap-6">
            <Checkbox name="shippingMethods" value="PICKUP" defaultChecked={species ? species.shippingMethods?.includes("PICKUP") : true} label="Retrait sur place" />
            <Checkbox name="shippingMethods" value="SPECIALIZED_CARRIER" defaultChecked={species?.shippingMethods?.includes("SPECIALIZED_CARRIER")} label="Transporteur spécialisé animaux vivants" />
            <Checkbox name="deliveryAvailable" defaultChecked={species ? Boolean(species.deliveryAvailable) : true} label="Livraison actuellement disponible (décocher pendant les périodes de froid / chaleur)" />
          </div>
          <fieldset><legend className="mb-2 text-sm font-medium">Jours d&apos;expédition autorisés (aucun coché = tous)</legend>
            <div className="flex flex-wrap gap-4">{DAYS.map((d, i) => <Checkbox key={d} name="allowedShipDays" value={String(i + 1)} defaultChecked={species?.allowedShipDays?.includes(i + 1)} label={d} />)}</div>
          </fieldset>
          <F name="transportConditions" label="Conditions de transport (affichées)"><Textarea id="transportConditions" name="transportConditions" rows={2} defaultValue={v(species?.transportConditions)} /></F>
          <F name="packagingRequirements" label="Exigences d'emballage (interne)"><Textarea id="packagingRequirements" name="packagingRequirements" rows={2} defaultValue={v(species?.packagingRequirements)} /></F>
          <F name="carrierConstraints" label="Contraintes transporteur / température (interne)"><Textarea id="carrierConstraints" name="carrierConstraints" rows={2} defaultValue={v(species?.carrierConstraints)} /></F>
        </fieldset>
        <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
          <legend className="px-2 font-semibold">Maintenance (valeurs par défaut des fiches)</legend>
          <F name="careDifficulty" label="Difficulté (1-5)"><Input id="careDifficulty" name="careDifficulty" type="number" min={1} max={5} defaultValue={v(species?.careDifficulty)} /></F>
          <F name="temperatureRange" label="Température"><Input id="temperatureRange" name="temperatureRange" defaultValue={v(species?.temperatureRange)} /></F>
          <F name="humidityRange" label="Hygrométrie"><Input id="humidityRange" name="humidityRange" defaultValue={v(species?.humidityRange)} /></F>
          <F name="diet" label="Alimentation" className="md:col-span-3"><Input id="diet" name="diet" defaultValue={v(species?.diet)} /></F>
          <F name="recommendedTerrarium" label="Terrarium recommandé" className="md:col-span-3"><Input id="recommendedTerrarium" name="recommendedTerrarium" defaultValue={v(species?.recommendedTerrarium)} /></F>
        </fieldset>
        {!readOnly && <SubmitButton size="lg">Enregistrer</SubmitButton>}
      </fieldset>
    </ActionForm>
  );
}
