"use client";
import * as React from "react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "@/components/ui/card";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useFormStatus } from "react-dom";

const FormStateContext = React.createContext<ActionState>(null);
const FormPendingContext = React.createContext(false);
export const useFieldError = (name: string) => React.useContext(FormStateContext)?.fieldErrors?.[name];

/** Formulaire relié à une Server Action (validation serveur, messages accessibles). */
export function ActionForm({ action, children, className, resetOnSuccess, onSuccessEvent }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccessEvent?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = React.useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state?.ok && onSuccessEvent) window.dispatchEvent(new CustomEvent("analytics", { detail: { name: onSuccessEvent } }));
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state, resetOnSuccess, onSuccessEvent, router]);
  // Soumission manuelle plutôt que <form action> : React réinitialise sinon tous les champs après
  // chaque action, et l'utilisateur perdrait sa saisie à la moindre erreur de validation.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return; // pas de double soumission
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    React.startTransition(() => formAction(fd));
  };
  return (
    <FormStateContext.Provider value={state}>
      <FormPendingContext.Provider value={pending}>
      <form ref={ref} onSubmit={onSubmit} className={className} aria-busy={pending}>
        {state?.error && <Alert tone="danger" className="mb-4">{state.error}</Alert>}
        {state?.ok && <Alert tone="success" className="mb-4">{state.ok}</Alert>}
        {children}
      </form>
      </FormPendingContext.Provider>
    </FormStateContext.Provider>
  );
}

export function SubmitButton({ children, pendingText = "Envoi…", ...props }: ButtonProps & { pendingText?: string }) {
  const ctxPending = React.useContext(FormPendingContext);
  const { pending: nativePending } = useFormStatus(); // formulaires hors ActionForm
  const pending = ctxPending || nativePending;
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FieldError({ name }: { name: string }) {
  const err = useFieldError(name);
  return err ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{err}</p> : null;
}
