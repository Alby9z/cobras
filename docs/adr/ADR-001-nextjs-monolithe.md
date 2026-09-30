# ADR-001 — Next.js full-stack plutôt que FastAPI + frontend séparé

- Statut : acceptée (phase 1, confirmée en phase 2)
- Décideur : porteur du projet

## Contexte
Le cahier des charges évoquait FastAPI + Prisma. Une première version fonctionnelle existait en Next.js.
Deux piles (Python + TypeScript) doublent l'outillage, les dépendances et la surface d'attaque pour une
petite équipe.

## Décision
Un seul dépôt TypeScript : Next.js 15 (App Router, Server Actions) pour l'interface et l'API, Prisma pour
l'accès aux données, un **worker Node séparé** pour les traitements asynchrones. Les règles métier sont
isolées dans `src/lib/domain` (pures, sans framework) pour rester portables.

## Conséquences
+ un langage, des types partagés de la base à l'écran, déploiement simple ;
+ la logique métier ne dépend pas de Next.js (testable seule) ;
− pas d'API REST publique générique (non requise à ce stade ; ajoutable via des routes `app/api`) ;
− le worker doit être construit séparément (esbuild, condition `react-server`).
