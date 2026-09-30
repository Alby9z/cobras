import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

/** Session + utilisateur relu en base (le rôle ne provient jamais du client). */
export const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true, firstName: true, lastName: true, birthDate: true, phone: true, role: true, banned: true, twoFactorEnabled: true, marketingOptIn: true },
  });
  if (!user || user.banned) return null;
  return user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireUser(returnTo = "/compte"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?next=${encodeURIComponent(returnTo)}`);
  return user;
}

import { can, isStaff, type Permission } from "@/lib/domain/permissions";
import { AppError } from "@/lib/domain/errors";

/**
 * Double authentification obligatoire pour le personnel : activée par défaut hors développement,
 * désactivable explicitement (STAFF_REQUIRE_2FA=false), par exemple pour un environnement de test.
 */
export function staffMustEnable2fa(user: Pick<CurrentUser, "role" | "twoFactorEnabled">) {
  const flag = process.env.STAFF_REQUIRE_2FA;
  const required = flag ? flag !== "false" : (process.env.APP_ENV ?? "development") !== "development";
  return required && isStaff(user.role) && !user.twoFactorEnabled;
}

/** Pages d'administration : permission exigée, sinon 404 (aucune divulgation de l'existence de la page). */
export async function requirePermission(perm: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?next=/admin");
  if (!can(user.role, perm)) notFound();
  if (staffMustEnable2fa(user)) redirect("/compte/profil?securite=2fa-requise");
  return user;
}

/** Actions serveur / API : lève AUTHORIZATION_ERROR (403) — la permission est relue en base à chaque appel. */
export async function assertPermission(perm: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTHENTICATION_ERROR", "Session expirée, reconnectez-vous.");
  if (!can(user.role, perm)) throw new AppError("AUTHORIZATION_ERROR", "Vous n'avez pas la permission d'effectuer cette action.");
  if (staffMustEnable2fa(user)) throw new AppError("AUTHORIZATION_ERROR", "Activez la double authentification pour accéder aux fonctions d'administration.");
  return user;
}

export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTHENTICATION_ERROR", "Session expirée, reconnectez-vous.");
  return user;
}

export { isStaff };
