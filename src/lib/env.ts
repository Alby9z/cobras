import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET doit faire au moins 32 caractères"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  RESEND_API_KEY: z.string().startsWith("re_"),
  EMAIL_FROM: z.string().min(3),
  ADMIN_NOTIFY_EMAIL: z.string().email(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_PRIVATE: z.string().min(1),
  S3_BUCKET_PUBLIC: z.string().min(1),
  NEXT_PUBLIC_MEDIA_URL: z.string().url(),
  CLAMAV_HOST: z.string().default("clamav"),
  CLAMAV_PORT: z.coerce.number().default(3310),
  REDIS_URL: z.string().url(),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  MINIMUM_ACCOUNT_AGE: z.coerce.number().int().min(0).max(120),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(10),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Variables d'environnement serveur, validées au premier accès (jamais exposées au client). */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
