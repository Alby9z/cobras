"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient, inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({ onTwoFactorRedirect: () => { window.location.href = "/connexion/2fa"; } }),
    inferAdditionalFields({
      user: {
        firstName: { type: "string", required: true },
        lastName: { type: "string", required: true },
        birthDate: { type: "date", required: true },
        phone: { type: "string", required: false },
        marketingOptIn: { type: "boolean", required: false },
      },
    }),
  ],
});
