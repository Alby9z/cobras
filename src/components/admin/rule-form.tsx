"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { saveRuleAction, ruleLifecycleAction } from "@/server/actions/admin/compliance";
import { documentTypeLabel, regulatoryCategoryLabel, ruleBasisLabel, ruleTypeLabel, shippingMethodLabel } from "@/lib/labels";
import type { ComplianceRuleType } from "@/generated/prisma/enums";

export interface RuleFormValue {
  id?: string; code?: string; name?: string; jurisdiction?: string; type?: ComplianceRuleType; basis?: string; speciesId?: string | null; regulatoryCategory?: string | null;
  productTypes?: string[]; mode?: string | null; zonesText?: string; methods?: string[]; shipDays?: number[]; requiredDocuments?: string[]; minimumAge?: number | null;
  customerMessage?: string | null; legalReference?: string | null; sourceUrl?: string | null; effectiveFrom?: string; effectiveUntil?: string;
}

function F({ name, label, children, hint, className }: { name: string; label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return <div className={className}><Label htmlFor={name}>{label}</Label>{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}<FieldError name={name} /></div>;
}
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function RuleForm({ rule, species, locked }: { rule: RuleFormValue; species: { id: string; commonName: string }[]; locked: boolean }) {
  const [type, setType] = useState<ComplianceRuleType>(rule.type ?? "DOCUMENT_REQUIREMENT");
  const [basis, setBasis] = useState(rule.basis ?? "LEGAL");
  return (
    <ActionForm action={saveRuleAction} className="space-y-6">
      <fieldset disabled={locked} className="space-y-6">
        <input type="hidden" name="id" value={rule.id ?? ""} />
        <div className="grid gap-4 md:grid-cols-3">
          <F name="code" label="Code *" hint="Identifiant stable de la règle (ex. FR-PYTHON-DOCS)."><Input id="code" name="code" required defaultValue={rule.code} readOnly={Boolean(rule.id)} /></F>
          <F name="name" label="Intitulé *" className="md:col-span-2"><Input id="name" name="name" required defaultValue={rule.name} /></F>
          <F name="type" label="Type *"><Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as ComplianceRuleType)}>{Object.entries(ruleTypeLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
          <F name="basis" label="Fondement *"><Select id="basis" name="basis" value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.entries(ruleBasisLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
          <F name="jurisdiction" label="Juridiction *" hint="FR, FR-69, EU…"><Input id="jurisdiction" name="jurisdiction" required defaultValue={rule.jurisdiction ?? "FR"} /></F>
        </div>

        <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
          <legend className="px-2 font-semibold">Périmètre</legend>
          <F name="speciesId" label="Espèce"><Select id="speciesId" name="speciesId" defaultValue={rule.speciesId ?? ""}><option value="">Toutes</option>{species.map((s) => <option key={s.id} value={s.id}>{s.commonName}</option>)}</Select></F>
          <F name="regulatoryCategory" label="Ou catégorie réglementaire"><Select id="regulatoryCategory" name="regulatoryCategory" defaultValue={rule.regulatoryCategory ?? ""}><option value="">Toutes</option>{Object.entries(regulatoryCategoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
          <fieldset><legend className="mb-1.5 text-sm font-medium">Types de produits</legend>
            <div className="space-y-1">{(["ANIMAL", "ACCESSORY", "EQUIPMENT"] as const).map((t) => <Checkbox key={t} name="productTypes" value={t} defaultChecked={rule.productTypes?.includes(t)} label={t === "ANIMAL" ? "Animaux" : t === "ACCESSORY" ? "Accessoires" : "Équipements"} />)}</div>
          </fieldset>
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
          <legend className="px-2 font-semibold">Paramètres</legend>
          {type === "DOCUMENT_REQUIREMENT" && (
            <fieldset className="md:col-span-2"><legend className="mb-1.5 text-sm font-medium">Documents exigés *</legend>
              <div className="grid gap-1 sm:grid-cols-2">{Object.entries(documentTypeLabel).map(([k, l]) => <Checkbox key={k} name="requiredDocuments" value={k} defaultChecked={rule.requiredDocuments?.includes(k)} label={l} />)}</div>
            </fieldset>
          )}
          {type === "AGE_REQUIREMENT" && <F name="minimumAge" label="Âge minimum *"><Input id="minimumAge" name="minimumAge" type="number" min={0} max={120} defaultValue={rule.minimumAge ?? ""} /></F>}
          {(type === "GEO_RESTRICTION" || type === "SALE_PROHIBITION" || type === "DOCUMENT_REQUIREMENT") && (
            <>
              {type === "GEO_RESTRICTION" && <F name="mode" label="Mode *"><Select id="mode" name="mode" defaultValue={rule.mode ?? "DENY"}><option value="DENY">Interdire ces zones</option><option value="ALLOW_ONLY">Autoriser uniquement ces zones</option></Select></F>}
              <F name="zones" label={type === "GEO_RESTRICTION" ? "Zones *" : "Limiter aux zones (facultatif)"} className="md:col-span-2" hint="Une zone par ligne : FR (pays), FR/84 (région INSEE), FR//69 (département), FR///20 (préfixe postal).">
                <Textarea id="zones" name="zones" rows={4} defaultValue={rule.zonesText} className="font-mono" />
              </F>
            </>
          )}
          {type === "SHIPPING_RESTRICTION" && (
            <>
              <fieldset><legend className="mb-1.5 text-sm font-medium">Modes autorisés</legend><div className="space-y-1">{Object.entries(shippingMethodLabel).map(([k, l]) => <Checkbox key={k} name="methods" value={k} defaultChecked={rule.methods?.includes(k)} label={l} />)}</div></fieldset>
              <fieldset><legend className="mb-1.5 text-sm font-medium">Jours d&apos;expédition autorisés</legend><div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} name="shipDays" value={String(i + 1)} defaultChecked={rule.shipDays?.includes(i + 1)} label={d} />)}</div></fieldset>
            </>
          )}
          {type === "HUMAN_REVIEW" && <p className="text-sm text-muted-foreground md:col-span-2">Les commandes concernées exigent un examen humain avant toute suite.</p>}
          <F name="customerMessage" label="Message affiché au client si la règle bloque" className="md:col-span-2"><Input id="customerMessage" name="customerMessage" maxLength={300} defaultValue={rule.customerMessage ?? ""} /></F>
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
          <legend className="px-2 font-semibold">Source et validité</legend>
          <F name="legalReference" label={basis === "LEGAL" ? "Référence juridique *" : "Référence (politique interne, CGV…)"} className="md:col-span-2" hint="Texte, article, arrêté… Une règle légale sans référence ne peut pas être enregistrée."><Input id="legalReference" name="legalReference" defaultValue={rule.legalReference ?? ""} required={basis === "LEGAL"} /></F>
          <F name="sourceUrl" label="URL de la source officielle" className="md:col-span-2"><Input id="sourceUrl" name="sourceUrl" type="url" defaultValue={rule.sourceUrl ?? ""} placeholder="https://www.legifrance.gouv.fr/…" /></F>
          <F name="effectiveFrom" label="Date d'effet *"><Input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={rule.effectiveFrom} /></F>
          <F name="effectiveUntil" label="Date de fin"><Input id="effectiveUntil" name="effectiveUntil" type="date" defaultValue={rule.effectiveUntil} /></F>
        </fieldset>
        {!locked && <SubmitButton size="lg">Enregistrer le brouillon</SubmitButton>}
      </fieldset>
    </ActionForm>
  );
}

export function RuleLifecycle({ ruleId, status, canApprove, canWrite }: { ruleId: string; status: string; canApprove: boolean; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      {status === "DRAFT" && canApprove && (
        <ActionForm action={ruleLifecycleAction} className="space-y-2">
          <input type="hidden" name="ruleId" value={ruleId} /><input type="hidden" name="op" value="approve" />
          <Label htmlFor="approve-note">Note de validation *</Label>
          <Textarea id="approve-note" name="note" rows={2} required minLength={10} placeholder="Sources vérifiées le …, périmètre confirmé par …" />
          <SubmitButton>Valider et publier</SubmitButton>
          <p className="text-xs text-muted-foreground">La version active précédente (même code) est retirée automatiquement. Une règle publiée ne peut plus être modifiée.</p>
        </ActionForm>
      )}
      {status === "DRAFT" && canWrite && (
        <ActionForm action={ruleLifecycleAction}><input type="hidden" name="ruleId" value={ruleId} /><input type="hidden" name="op" value="delete" /><SubmitButton variant="ghost" size="sm">Supprimer le brouillon</SubmitButton></ActionForm>
      )}
      {status !== "DRAFT" && canWrite && (
        <ActionForm action={ruleLifecycleAction}><input type="hidden" name="ruleId" value={ruleId} /><input type="hidden" name="op" value="new_version" /><SubmitButton variant="outline">Créer une nouvelle version</SubmitButton></ActionForm>
      )}
      {status === "ACTIVE" && canApprove && (
        <ActionForm action={ruleLifecycleAction} className="space-y-2">
          <input type="hidden" name="ruleId" value={ruleId} /><input type="hidden" name="op" value="retire" />
          <Label htmlFor="retire-note">Motif du retrait *</Label>
          <Input id="retire-note" name="note" required />
          <SubmitButton variant="danger" size="sm">Retirer la règle</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
