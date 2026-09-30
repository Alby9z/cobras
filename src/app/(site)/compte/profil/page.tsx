import { Alert, Card, PageHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton, FieldError } from "@/components/action-form";
import { Checkbox, Input, Label } from "@/components/ui/form";
import { ChangePasswordForm, TwoFactorSettings } from "@/components/auth/security";
import { requireUser } from "@/server/session";
import { updateProfile } from "@/server/actions/account";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Profil & sécurité" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ securite?: string }> }) {
  const user = await requireUser("/compte/profil");
  const { securite } = await searchParams;
  return (
    <>
      <PageHeader title="Profil & sécurité" />
      {securite === "2fa-requise" && !user.twoFactorEnabled && (
        <Alert tone="danger" className="mb-6">La double authentification est obligatoire pour accéder à l&apos;administration. Activez-la ci-dessous, puis reconnectez-vous.</Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Informations personnelles</h2>
          <ActionForm action={updateProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="firstName">Prénom</Label><Input id="firstName" name="firstName" defaultValue={user.firstName} required autoComplete="given-name" /><FieldError name="firstName" /></div>
              <div><Label htmlFor="lastName">Nom</Label><Input id="lastName" name="lastName" defaultValue={user.lastName} required autoComplete="family-name" /><FieldError name="lastName" /></div>
            </div>
            <div><Label htmlFor="phone">Téléphone</Label><Input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" /><FieldError name="phone" /></div>
            <p className="text-sm text-muted-foreground">Email : {user.email}<br />Date de naissance : {formatDate(user.birthDate)} (modifiable sur demande auprès du service client)</p>
            <Checkbox name="marketingOptIn" defaultChecked={user.marketingOptIn} label="Recevoir les nouveautés et offres par email" />
            <SubmitButton>Enregistrer</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card><h2 className="mb-4 font-semibold">Mot de passe</h2><ChangePasswordForm /></Card>
          <Card><h2 className="mb-4 font-semibold">Double authentification</h2><TwoFactorSettings enabled={Boolean(user.twoFactorEnabled)} /></Card>
        </div>
      </div>
    </>
  );
}
