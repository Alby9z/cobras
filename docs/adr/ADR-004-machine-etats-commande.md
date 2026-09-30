# ADR-004 — Machine à états explicite des commandes

- Statut : acceptée (phase 2)

## Contexte
Les commandes traversent paiement, examen de conformité, documents, préparation, expédition,
remboursement. Des mises à jour de statut libres produisent des états incohérents (expédier sans
paiement, par exemple).

## Décision
Table de transitions déclarative (`order-state.ts`) : pour chaque état, les états suivants, l'acteur
autorisé (SYSTEM / CUSTOMER / STAFF) et la permission requise ; invariants vérifiés à la transition
(paiement complet et conformité approuvée avant préparation, suivi avant expédition, jours d'expédition,
montants avant `REFUNDED`). Toute transition passe par `transition()` : verrou optimiste (`version`),
`OrderEvent`, audit.

## Conséquences
+ états impossibles rendus impossibles ; historique complet ; décisions concurrentes détectées ;
− ajouter un état exige de mettre à jour la table, les libellés et les tests.
