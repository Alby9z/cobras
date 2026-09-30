"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { saveProduct, stockAdjustAction, animalStatusAction, animalEventAction } from "@/server/actions/admin/catalog";
import { animalOriginLabel, paymentStrategyLabel } from "@/lib/labels";

type Any = Record<string, unknown>;
const v = (x: unknown) => (x == null ? "" : String(x));
const eur = (c: unknown) => (c == null ? "" : (Number(c) / 100).toFixed(2));
const day = (d: unknown) => (d ? new Date(String(d)).toISOString().slice(0, 10) : "");

function F({ name, label, children, hint, className }: { name: string; label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return <div className={className}><Label htmlFor={name}>{label}</Label>{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}<FieldError name={name} /></div>;
}

export function ProductForm({ product, animal, categories, species, taxRates, relatedSlugs, canSeeInternal }: {
  product?: Any & { id?: string; version?: number; type?: string }; animal?: Any | null; categories: { id: string; name: string }[];
  species: { id: string; commonName: string; scientificName: string }[]; taxRates: { id: string; name: string; rateBps: number }[]; relatedSlugs: string; canSeeInternal: boolean;
}) {
  const [type, setType] = useState(v(product?.type) || "ANIMAL");
  const isAnimal = type === "ANIMAL";
  const a = animal ?? {};
  return (
    <ActionForm action={saveProduct} className="space-y-8">
      <input type="hidden" name="id" value={v(product?.id)} />
      <input type="hidden" name="version" value={v(product?.version)} />
      <section className="grid gap-4 md:grid-cols-3">
        <F name="type" label="Type">
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)} disabled={Boolean(product?.id)}>
            <option value="ANIMAL">Animal (individu unique)</option><option value="ACCESSORY">Accessoire</option><option value="EQUIPMENT">Équipement</option>
          </Select>
          {product?.id && <input type="hidden" name="type" value={type} />}
        </F>
        <F name="status" label="Statut"><Select id="status" name="status" defaultValue={v(product?.status) || "DRAFT"}><option value="DRAFT">Brouillon</option><option value="PUBLISHED">Publié</option><option value="ARCHIVED">Archivé</option></Select></F>
        <F name="sku" label="Référence (SKU)"><Input id="sku" name="sku" defaultValue={v(product?.sku)} /></F>
        <F name="name" label="Nom *" className="md:col-span-2"><Input id="name" name="name" required defaultValue={v(product?.name)} /></F>
        <F name="slug" label="URL (slug)" hint="Généré depuis le nom si vide."><Input id="slug" name="slug" defaultValue={v(product?.slug)} /></F>
        <F name="shortDescription" label="Accroche (300 car.)" className="md:col-span-3"><Input id="shortDescription" name="shortDescription" maxLength={300} defaultValue={v(product?.shortDescription)} /></F>
        <F name="description" label="Description * (Markdown)" className="md:col-span-3" hint="## Titre, **gras**, - listes, [lien](https://…)"><Textarea id="description" name="description" rows={8} required defaultValue={v(product?.description)} /></F>
      </section>

      <section className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Prix, TVA et paiement</h2>
        <F name="price" label="Prix TTC (€) *"><Input id="price" name="price" inputMode="decimal" required defaultValue={eur(product?.priceCents)} /></F>
        <F name="compareAt" label="Prix barré (€)"><Input id="compareAt" name="compareAt" inputMode="decimal" defaultValue={eur(product?.compareAtCents)} /></F>
        <F name="taxRateId" label="Taux de TVA *"><Select id="taxRateId" name="taxRateId" required defaultValue={v(product?.taxRateId)}><option value="">Choisir…</option>{taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rateBps / 100} %)</option>)}</Select></F>
        <F name="categoryId" label="Catégorie"><Select id="categoryId" name="categoryId" defaultValue={v(product?.categoryId)}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></F>
        <F name="paymentStrategy" label="Stratégie de paiement" className="md:col-span-2" hint="Vide = stratégie par défaut (paramètres). La plus prudente du panier l'emporte."><Select id="paymentStrategy" name="paymentStrategy" defaultValue={v(product?.paymentStrategy)}><option value="">Par défaut</option>{Object.entries(paymentStrategyLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
        <F name="depositPercent" label="Acompte (%)"><Input id="depositPercent" name="depositPercent" type="number" min={1} max={99} defaultValue={v(product?.depositPercent)} /></F>
        <div className="flex items-end"><Checkbox name="featured" defaultChecked={Boolean(product?.featured)} label="Mis en avant (accueil)" /></div>
      </section>

      {isAnimal ? (
        <section className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
          <h2 className="font-semibold md:col-span-3">Fiche individuelle de l&apos;animal</h2>
          <F name="speciesId" label="Espèce *" className="md:col-span-3"><Select id="speciesId" name="speciesId" defaultValue={v(a.speciesId)} required><option value="">Choisir…</option>{species.map((s) => <option key={s.id} value={s.id}>{s.commonName} — {s.scientificName}</option>)}</Select></F>
          <F name="subspecies" label="Sous-espèce"><Input id="subspecies" name="subspecies" defaultValue={v(a.subspecies)} /></F>
          <F name="morph" label="Phase / morph"><Input id="morph" name="morph" defaultValue={v(a.morph)} /></F>
          <F name="sex" label="Sexe"><Select id="sex" name="sex" defaultValue={v(a.sex) || "UNKNOWN"}><option value="MALE">Mâle</option><option value="FEMALE">Femelle</option><option value="UNKNOWN">Non sexé</option></Select></F>
          <F name="birthDate" label="Date de naissance"><Input id="birthDate" name="birthDate" type="date" defaultValue={day(a.birthDate)} /></F>
          <F name="sizeCm" label="Taille (cm)"><Input id="sizeCm" name="sizeCm" inputMode="decimal" defaultValue={v(a.sizeCm)} /></F>
          <F name="weightG" label="Poids (g)"><Input id="weightG" name="weightG" inputMode="decimal" defaultValue={v(a.weightG)} /></F>
          <F name="origin" label="Origine"><Select id="origin" name="origin" defaultValue={v(a.origin) || "UNKNOWN"}>{Object.entries(animalOriginLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></F>
          <F name="originDetails" label="Détail d'origine (public)" className="md:col-span-2"><Input id="originDetails" name="originDetails" defaultValue={v(a.originDetails)} /></F>
          {canSeeInternal && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground md:col-span-3">Informations internes (jamais publiées)</p>
              <F name="identificationReference" label="Identification (puce, bague…)"><Input id="identificationReference" name="identificationReference" defaultValue={v(a.identificationReference)} /></F>
              <F name="acquisitionDate" label="Date d'acquisition"><Input id="acquisitionDate" name="acquisitionDate" type="date" defaultValue={day(a.acquisitionDate)} /></F>
              <F name="location" label="Emplacement"><Input id="location" name="location" defaultValue={v(a.location)} /></F>
              <F name="healthStatus" label="État de santé" className="md:col-span-3"><Textarea id="healthStatus" name="healthStatus" rows={2} defaultValue={v(a.healthStatus)} /></F>
              <F name="internalNotes" label="Notes internes" className="md:col-span-3"><Textarea id="internalNotes" name="internalNotes" rows={2} defaultValue={v(a.internalNotes)} /></F>
            </>
          )}
          <p className="text-xs text-muted-foreground md:col-span-3">Maintenance : laissez vide pour reprendre les valeurs de l&apos;espèce.</p>
          <F name="careDifficulty" label="Difficulté (1-5)"><Input id="careDifficulty" name="careDifficulty" type="number" min={1} max={5} defaultValue={v(a.careDifficulty)} /></F>
          <F name="temperatureRange" label="Température"><Input id="temperatureRange" name="temperatureRange" defaultValue={v(a.temperatureRange)} /></F>
          <F name="humidityRange" label="Hygrométrie"><Input id="humidityRange" name="humidityRange" defaultValue={v(a.humidityRange)} /></F>
          <F name="diet" label="Alimentation" className="md:col-span-3"><Input id="diet" name="diet" defaultValue={v(a.diet)} /></F>
          <F name="recommendedTerrarium" label="Terrarium recommandé" className="md:col-span-3"><Input id="recommendedTerrarium" name="recommendedTerrarium" defaultValue={v(a.recommendedTerrarium)} /></F>
          <F name="videoUrls" label="Vidéos (URL https, une par ligne)" className="md:col-span-3"><Textarea id="videoUrls" name="videoUrls" rows={2} defaultValue={Array.isArray(a.videoUrls) ? (a.videoUrls as string[]).join("\n") : ""} /></F>
        </section>
      ) : (
        <section className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-4">
          <h2 className="font-semibold md:col-span-4">Caractéristiques</h2>
          <F name="brand" label="Marque"><Input id="brand" name="brand" defaultValue={v(product?.brand)} /></F>
          <F name="ean" label="EAN / GTIN"><Input id="ean" name="ean" inputMode="numeric" defaultValue={v(product?.ean)} /></F>
          <F name="supplier" label="Fournisseur (interne)"><Input id="supplier" name="supplier" defaultValue={v(product?.supplier)} /></F>
          <F name="purchasePrice" label="Prix d'achat HT (€, interne)"><Input id="purchasePrice" name="purchasePrice" inputMode="decimal" defaultValue={eur(product?.purchasePriceCents)} /></F>
          <F name="weightGrams" label="Poids (g)"><Input id="weightGrams" name="weightGrams" type="number" min={0} defaultValue={v(product?.weightGrams)} /></F>
          <F name="lengthMm" label="Longueur (mm)"><Input id="lengthMm" name="lengthMm" type="number" min={0} defaultValue={v(product?.lengthMm)} /></F>
          <F name="widthMm" label="Largeur (mm)"><Input id="widthMm" name="widthMm" type="number" min={0} defaultValue={v(product?.widthMm)} /></F>
          <F name="heightMm" label="Hauteur (mm)"><Input id="heightMm" name="heightMm" type="number" min={0} defaultValue={v(product?.heightMm)} /></F>
          {!product?.id && <F name="initialStock" label="Stock initial" hint="Ensuite : mouvements de stock tracés."><Input id="initialStock" name="initialStock" type="number" min={0} /></F>}
          <F name="lowStockAlert" label="Seuil d'alerte"><Input id="lowStockAlert" name="lowStockAlert" type="number" min={0} defaultValue={v(product?.lowStockAlert) || "1"} /></F>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <F name="relatedSlugs" label={isAnimal ? "Équipement recommandé (slugs, séparés par des virgules)" : "Produits associés (slugs)"} className="md:col-span-2"><Input id="relatedSlugs" name="relatedSlugs" defaultValue={relatedSlugs} /></F>
        <F name="metaTitle" label="Meta title (70 car.)"><Input id="metaTitle" name="metaTitle" maxLength={70} defaultValue={v(product?.metaTitle)} /></F>
        <F name="metaDescription" label="Meta description (170 car.)"><Input id="metaDescription" name="metaDescription" maxLength={170} defaultValue={v(product?.metaDescription)} /></F>
      </section>
      <SubmitButton size="lg">Enregistrer</SubmitButton>
    </ActionForm>
  );
}

export function StockAdjustForm({ productId }: { productId: string }) {
  return (
    <ActionForm action={stockAdjustAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="productId" value={productId} />
      <F name="kind" label="Type"><Select id="kind" name="kind"><option value="RECEIPT">Réception</option><option value="ADJUSTMENT">Ajustement (inventaire, casse…)</option><option value="RETURN">Retour client</option></Select></F>
      <F name="delta" label="Quantité (+ / −)"><Input id="delta" name="delta" type="number" required /></F>
      <F name="reason" label="Motif *"><Input id="reason" name="reason" required /></F>
      <F name="reference" label="Référence (bon, facture…)"><Input id="reference" name="reference" /></F>
      <div className="sm:col-span-2"><SubmitButton size="sm">Enregistrer le mouvement</SubmitButton></div>
    </ActionForm>
  );
}

export function AnimalStatusForm({ animalId }: { animalId: string }) {
  return (
    <ActionForm action={animalStatusAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="animalId" value={animalId} />
      <F name="to" label="Nouveau statut"><Select id="to" name="to"><option value="AVAILABLE">Disponible à la vente</option><option value="QUARANTINED">Quarantaine</option><option value="UNAVAILABLE">Indisponible</option><option value="RETURNED">Retourné</option></Select></F>
      <F name="note" label="Motif *"><Input id="note" name="note" required /></F>
      <div className="sm:col-span-2"><SubmitButton size="sm">Changer le statut</SubmitButton></div>
    </ActionForm>
  );
}

export function AnimalEventForm({ animalId }: { animalId: string }) {
  return (
    <ActionForm action={animalEventAction} resetOnSuccess className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
      <input type="hidden" name="animalId" value={animalId} />
      <F name="type" label="Type"><Select id="ev-type" name="type"><option value="MEASURE">Mesure</option><option value="HEALTH">Santé</option><option value="LOCATION">Déplacement</option><option value="NOTE">Note</option></Select></F>
      <F name="note" label="Détail"><Input id="ev-note" name="note" required /></F>
      <SubmitButton size="sm" variant="outline">Ajouter</SubmitButton>
    </ActionForm>
  );
}
