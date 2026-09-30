import "server-only";
import { betterAuth, APIError } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { hash, verify } from "@node-rs/argon2";
import { db } from "@/server/db";
import { sendTemplate } from "@/server/email";
import { audit } from "@/server/audit";
import { isStaff } from "@/lib/domain/permissions";
import type { Role } from "@/generated/prisma/enums";
import { ageOn } from "@/lib/utils";

// Paramètres Argon2id recommandés par l'OWASP (m=19 Mio, t=2, p=1).
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32, algorithm: 2 as const };

export const auth = betterAuth({
  appName: process.env.NEXT_PUBLIC_SITE_NAME ?? "Boutique",
  baseURL: process.env.NEXT_PUBLIC_SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  trustedOrigins: process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : [],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    password: {
      hash: (password) => hash(password, ARGON2),
      verify: ({ hash: h, password }) => verify(h, password),
    },
    sendResetPassword: async ({ user, url, token }) => {
      await sendTemplate("PASSWORD_RESET", user.email, { url }, { dedupeKey: `reset:${token}`, userId: user.id });
    },
    onPasswordReset: async ({ user }) => {
      await audit({ actor: { id: user.id, role: "CUSTOMER" }, action: "auth.password_reset", entity: "user", entityId: user.id });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url, token }) => {
      await sendTemplate("EMAIL_VERIFICATION", user.email, { url }, { dedupeKey: `verify:${token.slice(-24)}`, userId: user.id });
    },
    afterEmailVerification: async (user) => {
      const u = await db.user.findUnique({ where: { id: user.id }, select: { firstName: true, email: true } });
      if (u) await sendTemplate("ACCOUNT_CREATED", u.email, { firstName: u.firstName }, { dedupeKey: `welcome:${user.id}`, userId: user.id }).catch(() => undefined);
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
    updateAge: 60 * 60 * 24, // rotation quotidienne de l'expiration
    freshAge: 60 * 15, // actions sensibles : connexion de moins de 15 min
  },

  user: {
    additionalFields: {
      firstName: { type: "string", required: true, input: true },
      lastName: { type: "string", required: true, input: true },
      birthDate: { type: "date", required: true, input: true },
      phone: { type: "string", required: false, input: true },
      marketingOptIn: { type: "boolean", required: false, input: true, defaultValue: false },
      role: { type: "string", required: false, input: false, defaultValue: "CUSTOMER" },
      banned: { type: "boolean", required: false, input: false, defaultValue: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const u = user as typeof user & { firstName?: string; lastName?: string; birthDate?: Date | string };
          const firstName = u.firstName?.trim();
          const lastName = u.lastName?.trim();
          const birth = u.birthDate ? new Date(u.birthDate) : null;
          if (!firstName || !lastName || !birth || Number.isNaN(birth.getTime())) {
            throw new APIError("BAD_REQUEST", { message: "Nom, prénom et date de naissance sont obligatoires." });
          }
          // Âge minimum d'inscription : politique commerciale configurée (MINIMUM_ACCOUNT_AGE), jamais codée en dur.
          const minAge = Number(process.env.MINIMUM_ACCOUNT_AGE);
          if (!Number.isInteger(minAge)) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Inscription momentanément indisponible." });
          if (ageOn(birth) < minAge) {
            throw new APIError("FORBIDDEN", { message: `L'inscription est réservée aux personnes de ${minAge} ans et plus.` });
          }
          if (ageOn(birth) > 120) throw new APIError("BAD_REQUEST", { message: "Date de naissance invalide." });
          return { data: { ...user, firstName, lastName, birthDate: birth, name: `${firstName} ${lastName}` } };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await db.user.findUnique({ where: { id: session.userId }, select: { banned: true } });
          if (!u || u.banned) throw new APIError("FORBIDDEN", { message: "Email ou mot de passe incorrect." });
          return { data: session };
        },
        after: async (session) => {
          const u = await db.user.findUnique({ where: { id: session.userId }, select: { role: true } });
          if (u && isStaff(u.role as Role)) {
            await audit({ actor: { id: session.userId, role: u.role as Role }, action: "auth.staff_login", entity: "session", entityId: session.id, data: { ip: session.ipAddress } });
          }
        },
      },
    },
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/request-password-reset": { window: 60 * 10, max: 3 },
      "/send-verification-email": { window: 60 * 10, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },

  plugins: [twoFactor({ issuer: process.env.NEXT_PUBLIC_SITE_NAME ?? "Boutique" }), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
