// Environnement de test : jamais de clés de production.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://reptile:devpass@localhost:5432/reptile_test";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_ENV: "development",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_MEDIA_URL: "http://localhost:9000/media",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000000",
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
  RESEND_API_KEY: "re_fake",
  EMAIL_FROM: "Test <test@example.org>",
  ADMIN_NOTIFY_EMAIL: "admin@example.org",
  S3_ACCESS_KEY_ID: "x", S3_SECRET_ACCESS_KEY: "x", S3_BUCKET_PRIVATE: "p", S3_BUCKET_PUBLIC: "m",
  REDIS_URL: "redis://localhost:6379/15",
  MINIMUM_ACCOUNT_AGE: "18",
  LOG_LEVEL: "error",
});
