# Interfaces HTTP

L'application n'expose pas d'API publique générale : les écrans utilisent des **Server Actions** Next.js
(`src/server/actions/*`), protégées par le contrôle d'origine intégré, et quelques routes HTTP pour les
usages qui l'exigent (webhook, téléchargements, exports, sondes).

## Format d'erreur

Toute erreur des routes et actions suit :

```json
{ "code": "AUTHORIZATION_ERROR", "message": "Vous n'avez pas la permission d'effectuer cette action.", "details": {}, "request_id": "8b1c…" }
```

Jamais de trace technique ; l'identifiant `request_id` (aussi en en-tête `x-request-id`) permet de retrouver
l'erreur dans les journaux.

| Code | HTTP | Signification |
|---|---|---|
| `VALIDATION_ERROR` | 422 | donnée invalide (`details` : champs) |
| `AUTHENTICATION_ERROR` | 401 | session absente ou expirée |
| `AUTHORIZATION_ERROR` | 403 | permission manquante (ou 2FA du personnel non activée) |
| `RESOURCE_NOT_FOUND` | 404 | ressource absente ou non accessible |
| `CONFLICT` | 409 | modification concurrente, état incompatible |
| `INVALID_TRANSITION` | 409 | transition de commande interdite |
| `OUT_OF_STOCK` | 409 | article réservé par un autre client |
| `PAYMENT_ERROR` | 402 | paiement refusé / incohérent |
| `COMPLIANCE_ERROR` | 422 | achat non éligible (`details` : motifs) |
| `DOCUMENT_ERROR` | 422 | fichier refusé (type, taille, quota) |
| `RATE_LIMIT_ERROR` | 429 | trop de requêtes |
| `CONFIGURATION_ERROR` | 503 | boutique pas encore ouverte à la vente (`details.missing`) |
| `EXTERNAL_SERVICE_ERROR` | 503 | Stripe / stockage / e-mail indisponible |
| `INTERNAL_ERROR` | 500 | erreur inattendue (journalisée) |

Les Server Actions renvoient au formulaire `{ error, code, fieldErrors }` ou `{ ok }`.

## Routes

| Méthode | Chemin | Accès | Description |
|---|---|---|---|
| GET/POST | `/api/auth/*` | public | Better Auth (connexion, inscription, 2FA, réinitialisation) — limité en débit |
| POST | `/api/stripe/webhook` | signature Stripe | enregistre l'événement puis le traite de façon idempotente ; 400 si signature absente/invalide, 500 si le traitement échoue (Stripe renvoie l'événement), 200 sinon |
| GET | `/api/documents/{id}` | propriétaire ou `documents.read_sensitive` | redirection vers une URL signée (2 min) ; accès journalisé |
| GET | `/api/invoices/{id}` | propriétaire ou `invoices.read` | PDF de facture / avoir |
| GET | `/api/admin/export/{kind}` | `commandes` : `orders.read` ; `factures` : `invoices.read` ; `inventaire` : `products.read` ; `audit` : `audit.read` | CSV (UTF-8), formules neutralisées, export journalisé |
| GET / POST | `/api/desinscription?u=…&t=…` | jeton HMAC | désinscription marketing ; POST = désinscription en un clic (RFC 8058) |
| GET | `/api/health` | public | vivacité du processus (ne dépend d'aucun service) |
| GET | `/api/ready` | public | disponibilité : base et Redis (`200 ready` / `503 degraded`), sans détail interne |

## Webhook Stripe

Événements traités : `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded`. Les autres sont enregistrés comme `IGNORED`.

Cycle : `RECEIVED → PROCESSING → PROCESSED | FAILED | IGNORED`. Un événement bloqué en `PROCESSING`
depuis plus de 10 minutes (plantage) est passé en `FAILED` par le worker ; un événement `FAILED` est
retraité quand Stripe le renvoie, ou rejouable depuis
**Administration → Paiements** (consultation `payments.read`, rejeu `orders.update`).
