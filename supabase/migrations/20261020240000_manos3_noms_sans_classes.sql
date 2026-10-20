-- MANOS-3 : classes retirées des noms des sous-tests (#127, suite de #115).
--
-- Les grilles de cotation jointes à #115 montrent que « Règle souligner » sert
-- aussi en CM1 : « Règle souligner CE1 / CE2 » était inexact. Les autres classes
-- (« Règle construire CE1 / CE2 », « Règle relier CM2 / 6ème »…) répètent
-- l'en-tête de catégorie, qui donne les classes de chaque outil depuis #115
-- (ex. « Règle souligner (CE1, CE2, CM1) »). Les noms restent distincts.
--
-- Noms seulement : identifiants, échelles et ordres inchangés, les bilans
-- existants ne bougent pas. Compatible avec le client en production.
-- Idempotente (UPDATE à valeurs fixes).

begin;

update official_subtests s
set name = v.name
from (values
  ('manos-3__regle-souligner-manipulation', 'Règle souligner — manipulation'),
  ('manos-3__regle-souligner-resultat', 'Règle souligner — résultat'),
  ('manos-3__regle-construire-manipulation', 'Règle construire — manipulation'),
  ('manos-3__regle-construire-resultat', 'Règle construire — résultat'),
  ('manos-3__regle-relier-manipulation', 'Règle relier — manipulation'),
  ('manos-3__regle-relier-resultat', 'Règle relier — résultat'),
  ('manos-3__regle-mesurer-manipulation', 'Règle mesurer — manipulation'),
  ('manos-3__regle-mesurer-resultat', 'Règle mesurer — résultat'),
  ('manos-3__rapporteur-manipulation', 'Rapporteur — manipulation'),
  ('manos-3__rapporteur-resultat', 'Rapporteur — résultat')
) as v(id, name)
where s.organization_id is null
  and s.test_id = 'manos-3'
  and s.id = v.id;

commit;

-- Vérification (lecture) : aucun nom du MANOS-3 ne contient plus CE, CM ni 6.
-- select id, name from official_subtests
-- where organization_id is null and test_id = 'manos-3' and name ~ '(CE|CM|6)';
