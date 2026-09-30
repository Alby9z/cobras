"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { track } from "@/lib/analytics";

const GENERIC_LOGIN_ERROR = "Email ou mot de passe incorrect.";
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/compte");

// ───────── Connexion ─────────
const loginSchema = z.object({ email: z.string().email("Adresse email invalide."), password: z.string().min(1, "Mot de passe requis.") });

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    setUnverified(null);
    const { data, error } = await authClient.signIn.email({ email: v.email, password: v.password });
    if (error) {
      if (error.status === 403 && /verif/i.test(error.message ?? "")) setUnverified(v.email);
      else if (error.status === 429) setError("Trop de tentatives. Patientez une minute avant de réessayer.");
      else setError(GENERIC_LOGIN_ERROR); // message unique : ne révèle pas l'existence du compte
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return router.push(`/connexion/2fa?next=${encodeURIComponent(next)}`);
    track("login", { method: "email" });
    router.push(next);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {unverified && <Alert tone="warning">Votre adresse email n&apos;est pas encore vérifiée. <ResendVerification email={unverified} inline /></Alert>}
      <Field label="Email" htmlFor="email" error={formState.errors.email?.message} required>
        <Input id="email" type="email" autoComplete="email" {...register("email")} aria-invalid={!!formState.errors.email} />
      </Field>
      <Field label="Mot de passe" htmlFor="password" error={formState.errors.password?.message} required>
        <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!formState.errors.password} />
      </Field>
      <div className="flex justify-end text-sm"><Link href="/mot-de-passe-oublie" className="text-primary hover:underline">Mot de passe oublié ?</Link></div>
      <Button type="submit" size="lg" className="w-full" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Connexion…" : "Se connecter"}</Button>
    </form>
  );
}

// ───────── Double authentification ─────────
export function TwoFactorForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = backup
          ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
          : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: trust });
        setPending(false);
        if (res.error) return setError("Code invalide ou expiré.");
        router.push(next);
        router.refresh();
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={backup ? "Code de secours" : "Code à 6 chiffres de votre application"} htmlFor="code" required>
        <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required />
      </Field>
      <Checkbox label="Faire confiance à cet appareil pendant 30 jours" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>Valider</Button>
      <button type="button" className="text-sm text-primary hover:underline" onClick={() => setBackup(!backup)}>{backup ? "Utiliser l'application d'authentification" : "Utiliser un code de secours"}</button>
    </form>
  );
}

// ───────── Inscription ─────────
function isAdult(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 18 && age <= 120;
}

const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, "Prénom requis.").max(80),
    lastName: z.string().trim().min(1, "Nom requis.").max(80),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de naissance requise.").refine(isAdult, "L'inscription est réservée aux personnes majeures."),
    email: z.string().trim().email("Adresse email invalide."),
    password: z.string().min(10, "10 caractères minimum.").max(128).regex(/[A-Za-z]/, "Au moins une lettre.").regex(/\d/, "Au moins un chiffre."),
    confirm: z.string(),
    terms: z.literal(true, { message: "Vous devez accepter les conditions." }),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

export function RegisterForm() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error } = await authClient.signUp.email({
      email: v.email,
      password: v.password,
      name: `${v.firstName} ${v.lastName}`,
      firstName: v.firstName,
      lastName: v.lastName,
      birthDate: new Date(`${v.birthDate}T00:00:00Z`),
      marketingOptIn: v.marketingOptIn ?? false,
      callbackURL: "/compte",
    });
    if (error) {
      setError(error.status === 429 ? "Trop de tentatives. Réessayez plus tard." : error.message && /majeur|obligatoire|invalide/i.test(error.message) ? error.message : "L'inscription n'a pas pu aboutir. Vérifiez les informations saisies.");
      return;
    }
    track("sign_up", { method: "email" });
    setDone(v.email);
  });

  if (done) {
    return (
      <Alert tone="success">
        <p className="font-semibold">Vérifiez votre boîte de réception</p>
        <p className="mt-1">Si cette adresse n&apos;est pas déjà utilisée, un email de confirmation a été envoyé à <strong>{done}</strong>. Cliquez sur le lien qu&apos;il contient pour activer votre compte.</p>
      </Alert>
    );
  }

  const e = formState.errors;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" htmlFor="firstName" error={e.firstName?.message} required><Input id="firstName" autoComplete="given-name" {...register("firstName")} /></Field>
        <Field label="Nom" htmlFor="lastName" error={e.lastName?.message} required><Input id="lastName" autoComplete="family-name" {...register("lastName")} /></Field>
      </div>
      <Field label="Date de naissance" htmlFor="birthDate" error={e.birthDate?.message} hint="La vente d'animaux est réservée aux personnes majeures." required>
        <Input id="birthDate" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} {...register("birthDate")} />
      </Field>
      <Field label="Email" htmlFor="email" error={e.email?.message} required><Input id="email" type="email" autoComplete="email" {...register("email")} /></Field>
      <Field label="Mot de passe" htmlFor="password" error={e.password?.message} hint="10 caractères minimum, avec au moins une lettre et un chiffre." required>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <Field label="Confirmer le mot de passe" htmlFor="confirm" error={e.confirm?.message} required><Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} /></Field>
      <Checkbox {...register("terms")} label={<>J&apos;accepte les <a href="/cgu" className="underline" target="_blank">conditions d&apos;utilisation</a> et la <a href="/confidentialite" className="underline" target="_blank">politique de confidentialité</a>.</>} />
      {e.terms && <p role="alert" className="text-xs font-medium text-danger">{e.terms.message}</p>}
      <Checkbox {...register("marketingOptIn")} label="Je souhaite recevoir les nouveautés et offres par email (désinscription à tout moment)." />
      <Button type="submit" size="lg" className="w-full" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Création…" : "Créer mon compte"}</Button>
    </form>
  );
}

// ───────── Mot de passe oublié / réinitialisation ─────────
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  if (sent) return <Alert tone="success">Si un compte existe pour cette adresse, un email de réinitialisation vient d&apos;être envoyé. Le lien est valable 1 heure.</Alert>;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setPending(true);
      await authClient.requestPasswordReset({ email, redirectTo: "/reinitialiser-mot-de-passe" });
      setPending(false);
      setSent(true); // réponse identique que le compte existe ou non
    }}>
      <Field label="Email" htmlFor="email" required><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>Envoyer le lien</Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!token) return <Alert tone="danger">Lien invalide ou expiré. <Link href="/mot-de-passe-oublie" className="underline">Demander un nouveau lien</Link>.</Alert>;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setError("10 caractères minimum, avec au moins une lettre et un chiffre.");
      if (pw !== confirm) return setError("Les mots de passe ne correspondent pas.");
      setPending(true);
      const { error } = await authClient.resetPassword({ newPassword: pw, token });
      setPending(false);
      if (error) return setError("Lien invalide ou expiré. Demandez un nouveau lien.");
      router.push("/connexion?reset=1");
    }}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Nouveau mot de passe" htmlFor="pw" required><Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirmer" htmlFor="confirm" required><Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>Enregistrer</Button>
    </form>
  );
}

export function ResendVerification({ email, inline = false }: { email: string; inline?: boolean }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const send = async () => {
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/compte" });
    setState(error ? "error" : "sent");
  };
  if (state === "sent") return <span className="font-medium">Email de vérification renvoyé.</span>;
  if (state === "error") return <span>Envoi impossible pour le moment, réessayez plus tard.</span>;
  return inline ? <button type="button" onClick={send} className="underline">Renvoyer l&apos;email</button> : <Button type="button" variant="outline" onClick={send}>Renvoyer l&apos;email de vérification</Button>;
}
