# ADR-006 — Webhooks enregistrés, idempotents et vérifiés à la source

- Statut : acceptée (phase 2)

## Contexte
Stripe peut livrer un événement plusieurs fois, en désordre ou en parallèle. Un événement ne doit
produire qu'un effet métier, et son contenu ne suffit pas à prouver l'état réel du paiement.

## Décision
Chaque événement est inséré dans `stripe_event` (clé = id Stripe), réclamé par mise à jour conditionnelle
(`RECEIVED|FAILED → PROCESSING`), puis traité en **relisant le PaymentIntent chez Stripe** ; les effets
(paiement, facture, transition) sont eux-mêmes idempotents (uniques en base). États `PROCESSED`,
`FAILED` (rejouable), `IGNORED`. Événements bloqués remis en `FAILED` par le worker.

## Conséquences
+ doublons et courses sans effet (testé, y compris en parallèle) ; rejouable ;
− un appel Stripe supplémentaire par événement.
