# Tests

| Niveau | Commande | Dépendances | Contenu |
|---|---|---|---|
| Unitaires (domaine) | `npm test` | aucune | 30 tests : machine à états, prix/TVA/arrondis, répartition, stratégies de paiement, moteur d'éligibilité, permissions |
| Intégration | `npm run test:integration` | PostgreSQL réel (`DATABASE_URL_TEST`) | 21 tests : scénarios transactionnels et concurrents, contraintes base, sécurité |
| Parcours navigateur | `npm run test:e2e` | application + worker démarrés, base jetable | 20 vérifications de bout en bout (admin → client → conformité) |
| Statique | `npm run typecheck`, `npm run lint` | — | TypeScript strict, ESLint |

## Intégration

Base **dédiée** obligatoire : les tests vident toutes les tables. Préparer une base vide et migrée :

```bash
ADMIN_DATABASE_URL=postgresql://postgres@localhost/postgres ./scripts/reset-local-db.sh reptile_test
DATABASE_URL_TEST=postgresql://reptile:…@localhost:5432/reptile_test npm run test:integration
```

Stripe, stockage objet, e-mail et file de travaux sont remplacés par des **doubles** (`tests/integration/fakes.ts`) :
les tests vérifient notre logique (idempotence, états, montants, verrous), **pas** le comportement réel de
ces services. Les scénarios couverts :

- deux clients achètent le même animal simultanément → une seule réservation ; l'index partiel refuse une seconde réservation vivante ;
- double soumission du checkout (même clé) → une seule commande ;
- deux transitions concurrentes → une seule gagne (verrou optimiste) ;
- parcours complet autorisation → documents → approbation → capture → facture → expédition → livraison ;
- webhook dupliqué (y compris traité en parallèle) → une seule opération métier ;
- document manquant ou expiré → approbation refusée ; dérogation réservée au bon rôle, justification et audit obligatoires ;
- destination et espèce interdites ; refus de conformité → autorisation annulée, animal libéré ;
- acompte puis solde → deux factures ;
- remboursements concurrents → jamais plus que le montant payé ;
- rôle non autorisé → 403 ; document d'un autre client → refusé ;
- journal d'audit et factures non modifiables ; expiration des réservations ; échec Stripe → annulation et libération ;
- politique 2FA du personnel.

## Parcours navigateur

`tests/e2e/parcours.mjs` (Playwright) sur une base **vide et jetable** contenant deux comptes :
`admin@example.org` (SUPER_ADMIN, mot de passe `AdminPass123456`) et `client@example.org` (CUSTOMER,
`ClientPass123456`) créés avec `scripts/create-admin.ts` (puis rôle client passé à `CUSTOMER`).
Le parcours saisit des valeurs **explicitement marquées TEST** (jamais à réutiliser) :

1. erreur de connexion générique ; vente bloquée tant que la configuration manque ;
2. TVA, paramètres, pages légales, livraison, espèce ;
3. règles : documents et âge validées ; règle légale sans référence **refusée** ; interdiction géographique validée ;
4. animal créé puis rendu disponible ; plus aucun point bloquant ;
5. client : fiche produit annonçant le justificatif, commande vers le 69 **bloquée**, commande vers Paris
   en « paiement après validation » (sans Stripe) → page de remerciement sans prélèvement ;
6. admin : dossier dans la file de conformité, audit alimenté.

Variables : `E2E_BASE_URL`, `E2E_CHROMIUM_PATH`, `E2E_SHOTS_DIR` (captures, défaut `test-results/e2e`).

## Non couvert automatiquement (à tester manuellement avant ouverture)

- Stripe réel en mode test : Checkout, 3-D Secure, capture, annulation, remboursement, webhooks
  (`stripe listen --forward-to localhost:3000/api/stripe/webhook`).
- Resend réel (délivrabilité, SPF/DKIM), stockage S3/R2 réel, ClamAV réel (fichier EICAR).
- Construction et démarrage des images Docker, sauvegarde puis restauration.
- Tests de charge, accessibilité (audit RGAA), compatibilité navigateurs mobiles.
