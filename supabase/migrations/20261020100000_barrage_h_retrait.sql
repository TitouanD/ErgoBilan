-- Barrage des H : retrait des sous-tests « Oublis », « Fausses alarmes » et
-- « Stratégie d'exploration » (#101), ajoutés par 20261002120000_catalogue_ajouts.sql
-- (#90). La praticienne indique qu'ils ne font pas partie de l'évaluation
-- officielle ; accord de Titouan (2026-10-13).
--
-- Données seulement, idempotente. Aucune clé étrangère ne pointe vers
-- official_subtests. Un bilan local qui les a saisis garde sa valeur : le client
-- l'affiche par une définition de repli (resolveTestDef, utils/catalogIndex.ts),
-- sous un nom tiré de l'identifiant (« Oublis », « Fausses alarmes »,
-- « Strategie »), la stratégie restant une catégorie qualitative.

begin;

delete from official_subtests
where organization_id is null
  and test_id = 'barrage-h'
  and id in ('barrage-h__oublis', 'barrage-h__fausses-alarmes', 'barrage-h__strategie');

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select id, display_order from official_subtests where test_id = 'barrage-h' order by display_order;
-- Attendu : barrage-h__cibles 1, barrage-h__temps 2.
