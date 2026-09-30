"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";

/** Formulaire générique de back-office : champs déclaratifs reliés à une Server Action. */
export type FieldDef =
  | { name: string; label: string; type?: "text" | "number" | "date" | "email" | "url" | "datetime-local"; required?: boolean; defaultValue?: string | number | null; hint?: string; span?: boolean; step?: string }
  | { name: string; label: string; type: "textarea"; required?: boolean; defaultValue?: string | null; hint?: string; span?: boolean; rows?: number }
  | { name: string; label: string; type: "select"; options: [string, string][]; defaultValue?: string | null; hint?: string; span?: boolean; required?: boolean }
  | { name: string; label: string; type: "checkbox"; defaultChecked?: boolean; span?: boolean };

export function SimpleForm({ action, fields, hidden, submit = "Enregistrer", resetOnSuccess }: {
  action: (p: import("@/lib/action-state").ActionState, fd: FormData) => Promise<import("@/lib/action-state").ActionState>;
  fields: FieldDef[]; hidden?: Record<string, string>; submit?: string; resetOnSuccess?: boolean;
}) {
  const uid = Object.values(hidden ?? {}).join("-") || "new";
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} className="grid gap-4 md:grid-cols-2">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const cls = f.span ? "md:col-span-2" : "";
        if (f.type === "checkbox") return <Checkbox key={f.name} name={f.name} defaultChecked={f.defaultChecked} label={f.label} className={`${cls} self-end`} />;
        return (
          <div key={f.name} className={cls}>
            <Label htmlFor={id}>{f.label}{"required" in f && f.required ? " *" : ""}</Label>
            {f.type === "textarea" ? <Textarea id={id} name={f.name} rows={f.rows ?? 4} required={f.required} defaultValue={f.defaultValue ?? ""} />
              : f.type === "select" ? <Select id={id} name={f.name} defaultValue={f.defaultValue ?? ""} required={f.required}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              : <Input id={id} name={f.name} type={f.type ?? "text"} step={"step" in f ? f.step : undefined} required={f.required} defaultValue={f.defaultValue ?? ""} />}
            {"hint" in f && f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
            <FieldError name={f.name} />
          </div>
        );
      })}
      <div className="md:col-span-2"><SubmitButton>{submit}</SubmitButton></div>
    </ActionForm>
  );
}
