"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { uploadDocument } from "@/server/actions/account";
import { documentTypeLabel } from "@/lib/labels";

export function DocumentUpload({ maxMb, preselect }: { maxMb: number; preselect?: string }) {
  return (
    <ActionForm action={uploadDocument} resetOnSuccess onSuccessEvent="document_upload" className="grid gap-4 sm:grid-cols-2">
      <Field label="Type de document" htmlFor="doc-type" required>
        <Select id="doc-type" name="type" required defaultValue={preselect ?? ""}>
          <option value="" disabled>Choisir…</option>
          {Object.entries(documentTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="Date d'expiration (si applicable)" htmlFor="doc-exp"><Input id="doc-exp" name="expiresAt" type="date" /></Field>
      <Field label="Fichier" htmlFor="doc-file" hint={`PDF, JPG, PNG ou WEBP — ${maxMb} Mo maximum. Chaque fichier est analysé par un antivirus.`} required className="sm:col-span-2">
        <Input id="doc-file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="h-auto py-2" />
      </Field>
      <div className="sm:col-span-2"><SubmitButton pendingText="Analyse et envoi…">Envoyer le document</SubmitButton></div>
    </ActionForm>
  );
}
