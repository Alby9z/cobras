"use client";
import { useState } from "react";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";

export function ChangePasswordForm() {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setMsg({ error: "10 caractères minimum, avec au moins une lettre et un chiffre." });
      const { error } = await authClient.changePassword({ currentPassword: cur, newPassword: pw, revokeOtherSessions: true });
      setMsg(error ? { error: "Mot de passe actuel incorrect." } : { ok: "Mot de passe modifié. Vos autres sessions ont été déconnectées." });
      if (!error) { setCur(""); setPw(""); }
    }}>
      {msg.error && <Alert tone="danger">{msg.error}</Alert>}
      {msg.ok && <Alert tone="success">{msg.ok}</Alert>}
      <Field label="Mot de passe actuel" htmlFor="cur" required><Input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
      <Field label="Nouveau mot de passe" htmlFor="npw" required><Input id="npw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Button type="submit">Modifier le mot de passe</Button>
    </form>
  );
}

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [secretUri, setSecretUri] = useState<string | null>(null);
  const [backup, setBackup] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  if (enabled) {
    return (
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return setMsg({ error: "Mot de passe incorrect." });
        router.refresh();
      }}>
        <Alert tone="success">La double authentification est activée.</Alert>
        {msg.error && <Alert tone="danger">{msg.error}</Alert>}
        <Field label="Mot de passe (pour désactiver)" htmlFor="pw2fa"><Input id="pw2fa" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" variant="outline">Désactiver</Button>
      </form>
    );
  }

  if (qr) {
    return (
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
        if (error) return setMsg({ error: "Code invalide. Vérifiez l'heure de votre téléphone." });
        router.refresh();
      }}>
        <p className="text-sm">Scannez ce QR code avec votre application d&apos;authentification (Google Authenticator, Microsoft Authenticator, 1Password…), puis saisissez le code affiché.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code de configuration de la double authentification" width={200} height={200} className="rounded-lg bg-white p-2" />
        <details className="text-xs text-muted-foreground"><summary>Saisie manuelle</summary><code className="break-all">{secretUri}</code></details>
        <Alert>
          <p className="font-semibold">Codes de secours — à conserver en lieu sûr</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">{backup.map((c) => <li key={c}>{c}</li>)}</ul>
        </Alert>
        {msg.error && <Alert tone="danger">{msg.error}</Alert>}
        <Field label="Code à 6 chiffres" htmlFor="totp"><Input id="totp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Button type="submit">Activer</Button>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || data.method !== "totp") return setMsg({ error: "Mot de passe incorrect." });
      setSecretUri(data.totpURI);
      setBackup(data.backupCodes);
      setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }));
      setMsg({});
    }}>
      <p className="text-sm text-muted-foreground">Protégez votre compte avec un code temporaire généré par une application sur votre téléphone.</p>
      {msg.error && <Alert tone="danger">{msg.error}</Alert>}
      <Field label="Mot de passe" htmlFor="pw-enable" required><Input id="pw-enable" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      <Button type="submit">Configurer la double authentification</Button>
    </form>
  );
}
