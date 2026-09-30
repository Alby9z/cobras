# Variables d'environnement

Modèle complet et commenté : [`.env.example`](../.env.example). Les variables serveur sont validées au
premier usage (`src/lib/env.ts`) ; une valeur manquante ou mal formée fait échouer l'opération avec un
message explicite dans les journaux (nom de la variable, jamais sa valeur).

## Environnements

| `APP_ENV` | Usage | Particularités |
|---|---|---|
| `development` | poste local | 2FA du personnel non imposée par défaut |
| `staging` | préproduction | clés Stripe **test**, domaine d'e-mail de test, base distincte ; 2FA imposée |
| `production` | exploitation | clés live ; 2FA imposée ; le parcours E2E refuse de s'exécuter |

Ne jamais partager une base, un bucket ou une clé entre environnements.

## Référence

| Variable | Obligatoire | Secret | Description |
|---|---|---|---|
| `DOMAIN`, `ACME_EMAIL` | prod | non | domaine servi par Caddy, e-mail Let's Encrypt |
| `NEXT_PUBLIC_SITE_URL` | oui | non | URL publique (intégrée au build) |
| `NEXT_PUBLIC_SITE_NAME` | non | non | nom affiché avant configuration |
| `NEXT_PUBLIC_MEDIA_URL` | oui | non | domaine public des images |
| `NEXT_PUBLIC_GA_ID` | non | non | Google Analytics 4 (chargé seulement après consentement) |
| `GOOGLE_SITE_VERIFICATION` | non | non | balise Search Console |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | prod | **oui** | propriétaire du schéma (migrations, sauvegardes) |
| `APP_DB_USER` / `APP_DB_PASSWORD` | prod | **oui** | rôle d'exécution limité (app + worker) |
| `DATABASE_URL` | oui | **oui** | calculée par docker-compose en production ; à définir en local |
| `REDIS_PASSWORD` | prod | **oui** | mot de passe Redis |
| `REDIS_URL` | oui | **oui** | calculée par docker-compose en production |
| `BETTER_AUTH_SECRET` | oui | **oui** | ≥ 32 caractères ; sa rotation invalide les sessions |
| `STRIPE_SECRET_KEY` | oui | **oui** | `sk_test_…` hors production |
| `STRIPE_WEBHOOK_SECRET` | oui | **oui** | `whsec_…` de l'endpoint |
| `RESEND_API_KEY` | oui | **oui** | envoi d'e-mails |
| `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL` | oui | non | expéditeur, destinataire des alertes |
| `S3_ENDPOINT`, `S3_REGION` | selon fournisseur | non | vide pour AWS S3 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | oui | **oui** | clé limitée aux buckets média et privé |
| `S3_BUCKET_PRIVATE`, `S3_BUCKET_PUBLIC` | oui | non | documents/factures ; images |
| `CLAMAV_HOST`, `CLAMAV_PORT` | non | non | défaut `clamav:3310` |
| `UPLOAD_MAX_MB` | non | non | défaut 10 |
| `APP_ENV` | non | non | `development` / `staging` / `production` |
| `MINIMUM_ACCOUNT_AGE` | oui | non | âge minimum de création de compte — **politique commerciale** |
| `STAFF_REQUIRE_2FA` | non | non | `true` / `false` ; défaut : exigée hors développement |
| `LOG_LEVEL` | non | non | `debug` / `info` / `warn` / `error` |
| `APP_VERSION` | non | non | version affichée dans la santé système |
| `RATE_LIMIT_<NOM>` | non | non | `max/fenêtre_s` pour CART, CHECKOUT, CONTACT, COUPON, DOCUMENTS, SEARCH |
| `BACKUP_*`, `HEALTHCHECK_URL` | recommandé | clés : **oui** | sauvegardes hors site et alerte |
| `DATABASE_URL_TEST` | tests | non | base jetable des tests d'intégration |
| `E2E_BASE_URL`, `E2E_CHROMIUM_PATH`, `E2E_SHOTS_DIR` | tests | non | parcours navigateur |

Générer les secrets : `openssl rand -hex 32` (hexadécimal : sans caractère à échapper dans une URL).

Les valeurs métier (identité légale, TVA, stratégie de paiement, durées de réservation, délais) ne sont
**pas** des variables d'environnement : elles se saisissent dans **Administration → Paramètres**, sont
journalisées et ne nécessitent pas de redéploiement.
