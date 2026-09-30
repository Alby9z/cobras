"use client";
import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Input, Label, Textarea, Checkbox } from "@/components/ui/form";
import { submitContact } from "@/server/actions/contact";

export function ContactForm({ kind = "CONTACT", compact = false, subjectLabel }: { kind?: "CONTACT" | "QUOTE" | "AUDIT"; compact?: boolean; subjectLabel?: string }) {
  const id = (n: string) => `${kind.toLowerCase()}-${n}`;
  const event = kind === "CONTACT" ? "generate_lead" : kind === "QUOTE" ? "quote_request" : "audit_request";
  return (
    <ActionForm action={submitContact} resetOnSuccess onSuccessEvent={event} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="hidden" aria-hidden><label>Ne pas remplir <input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div className={compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
        <div><Label htmlFor={id("name")}>Nom *</Label><Input id={id("name")} name="name" autoComplete="name" required maxLength={120} /><FieldError name="name" /></div>
        <div><Label htmlFor={id("email")}>Email *</Label><Input id={id("email")} name="email" type="email" autoComplete="email" required /><FieldError name="email" /></div>
      </div>
      {!compact && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor={id("phone")}>Téléphone</Label><Input id={id("phone")} name="phone" type="tel" autoComplete="tel" /><FieldError name="phone" /></div>
          <div><Label htmlFor={id("subject")}>{subjectLabel ?? "Objet"}</Label><Input id={id("subject")} name="subject" maxLength={200} /></div>
        </div>
      )}
      <div><Label htmlFor={id("message")}>Message *</Label><Textarea id={id("message")} name="message" required minLength={10} maxLength={5000} rows={compact ? 4 : 6} /><FieldError name="message" /></div>
      <Checkbox name="consent" required label={<>J&apos;accepte que mes données soient utilisées pour traiter ma demande (voir la <Link href="/confidentialite" className="underline">politique de confidentialité</Link>).</>} />
      <FieldError name="consent" />
      <SubmitButton size="lg" className="w-full sm:w-auto">Envoyer</SubmitButton>
    </ActionForm>
  );
}
