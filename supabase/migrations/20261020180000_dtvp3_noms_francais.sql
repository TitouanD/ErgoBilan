-- DTVP-3 : noms des sous-tests et des indices en français (#114).
--
-- Le DTVP-3 (Hammill, Pearson et Voress, Pro-Ed 2013) n'a pas d'adaptation
-- française publiée : l'éditeur, y compris la boutique en français de Pearson
-- Canada, ne donne que les noms anglais. Traduction littérale sobre, alignée
-- sur les noms déjà employés dans le catalogue pour le DTVP-2 et le DTVP-A
-- (Coordination œil-main, Copie, Figure-fond, Fermeture visuelle, Constance de
-- la forme). Les indices gardent leur abréviation anglaise entre parenthèses,
-- celle des feuilles de cotation.
--
-- Seule la colonne `name` change : identifiants, échelles et ordre inchangés,
-- les bilans existants ne bougent pas (le nom est lu dans le catalogue).
-- Données seulement, idempotente.

begin;

update official_subtests s
set name = v.name
from (
  values
    ('dtvp-3__eye-hand-coordination', 'Coordination œil-main'),
    ('dtvp-3__copying', 'Copie'),
    ('dtvp-3__figure-ground', 'Figure-fond'),
    ('dtvp-3__visual-closure', 'Fermeture visuelle'),
    ('dtvp-3__form-constancy', 'Constance de la forme'),
    ('dtvp-3__vmii', 'Indice d''intégration visuomotrice (VMII)'),
    ('dtvp-3__mrpi', 'Indice de perception visuelle à motricité réduite (MRPI)'),
    ('dtvp-3__gvpi', 'Indice de perception visuelle générale (GVPI)')
) as v(id, name)
where s.organization_id is null and s.test_id = 'dtvp-3' and s.id = v.id;

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select id, name from official_subtests where test_id = 'dtvp-3' order by display_order;
