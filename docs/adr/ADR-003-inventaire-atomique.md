# ADR-003 — Inventaire atomique et animal individualisé

- Statut : acceptée (phase 2)

## Contexte
Un animal est unique : deux clients ne doivent jamais pouvoir le payer tous les deux. Les accessoires ont
un stock quantitatif.

## Décision
- Entité `Animal` (1–1 avec le produit) avec son propre statut (disponible, réservé, attribué, en
  préparation, expédié, vendu, quarantaine…).
- Réservation par `UPDATE … WHERE stock disponible` et transition conditionnelle du statut animal, dans la
  transaction de commande ; **index unique partiel** garantissant une seule réservation vivante par animal.
- `stockOnHand` / `stockReserved` + contrainte `stockReserved <= stockOnHand`.
- Chaque variation écrit un `InventoryMovement` immuable (avant / après, motif, acteur, référence).
- Réservations à échéance, libérées par le worker (`reservations.expire`).

## Conséquences
+ pas de survente même sous concurrence (testé) ; historique de stock auditable ;
− pas de verrou pessimiste : l'un des deux clients concurrents reçoit « déjà réservé » et doit choisir
  un autre article.
