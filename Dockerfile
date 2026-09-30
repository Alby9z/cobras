# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Dépendances ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts && npx prisma generate

# ── Build ──
FROM deps AS builder
# Variables publiques intégrées au bundle client au moment du build.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_URL
ARG NEXT_PUBLIC_SITE_NAME
ARG NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
COPY . .
RUN npx prisma generate && npx next build && node scripts/build-worker.mjs

# ── Dépendances de production seules (pour le worker) ──
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# ── Migrations (image utilitaire, exécutée avant chaque déploiement) ──
FROM deps AS migrate
COPY scripts ./scripts
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Exécution ──
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /usr/sbin/nologin app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ── Worker (BullMQ) : e-mails, PDF, antivirus, expirations, relances ──
# Le client Prisma généré est intégré au bundle ; seules les dépendances npm restent externes.
FROM base AS worker
ENV NODE_ENV=production
RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /usr/sbin/nologin app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist/worker.mjs ./worker.mjs
COPY --chown=app:app package.json ./
USER app
# Le worker écrit un battement de cœur dans Redis (clé worker:heartbeat) ; /api/ready le contrôle.
CMD ["node", "--conditions=react-server", "worker.mjs"]
