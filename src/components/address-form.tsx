"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { saveAddress } from "@/server/actions/account";
import { COUNTRIES } from "@/lib/geo-fr";

type Addr = { id: string; label: string | null; firstName: string; lastName: string; company: string | null; line1: string; line2: string | null; postalCode: string; city: string; country: string; phone: string; isDefault: boolean };

export function AddressForm({ address, defaults }: { address?: Addr; defaults?: { firstName: string; lastName: string; phone?: string | null } }) {
  const a = address;
  const p = a?.id ?? "new";
  const f = (n: string) => `${p}-${n}`;
  return (
    <ActionForm action={saveAddress} resetOnSuccess={!a} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={a?.id ?? ""} />
      <div><Label htmlFor={f("firstName")}>Prénom *</Label><Input id={f("firstName")} name="firstName" autoComplete="given-name" required defaultValue={a?.firstName ?? defaults?.firstName} /><FieldError name="firstName" /></div>
      <div><Label htmlFor={f("lastName")}>Nom *</Label><Input id={f("lastName")} name="lastName" autoComplete="family-name" required defaultValue={a?.lastName ?? defaults?.lastName} /><FieldError name="lastName" /></div>
      <div className="sm:col-span-2"><Label htmlFor={f("line1")}>Adresse *</Label><Input id={f("line1")} name="line1" autoComplete="address-line1" required defaultValue={a?.line1} /><FieldError name="line1" /></div>
      <div className="sm:col-span-2"><Label htmlFor={f("line2")}>Complément</Label><Input id={f("line2")} name="line2" autoComplete="address-line2" defaultValue={a?.line2 ?? ""} /></div>
      <div><Label htmlFor={f("postalCode")}>Code postal *</Label><Input id={f("postalCode")} name="postalCode" autoComplete="postal-code" required defaultValue={a?.postalCode} /><FieldError name="postalCode" /></div>
      <div><Label htmlFor={f("city")}>Ville *</Label><Input id={f("city")} name="city" autoComplete="address-level2" required defaultValue={a?.city} /><FieldError name="city" /></div>
      <div><Label htmlFor={f("country")}>Pays *</Label>
        <Select id={f("country")} name="country" autoComplete="country" defaultValue={a?.country ?? "FR"}>{Object.entries(COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select><FieldError name="country" /></div>
      <div><Label htmlFor={f("phone")}>Téléphone *</Label><Input id={f("phone")} name="phone" type="tel" autoComplete="tel" required defaultValue={a?.phone ?? defaults?.phone ?? ""} /><FieldError name="phone" /></div>
      <div><Label htmlFor={f("company")}>Société</Label><Input id={f("company")} name="company" autoComplete="organization" defaultValue={a?.company ?? ""} /></div>
      <div><Label htmlFor={f("label")}>Nom de l&apos;adresse</Label><Input id={f("label")} name="label" placeholder="Domicile, travail…" defaultValue={a?.label ?? ""} /></div>
      <Checkbox name="isDefault" defaultChecked={a?.isDefault} label="Adresse par défaut" className="sm:col-span-2" />
      <div className="sm:col-span-2"><SubmitButton>Enregistrer l&apos;adresse</SubmitButton></div>
    </ActionForm>
  );
}
