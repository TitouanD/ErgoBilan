-- Jebsen-Taylor : la main dans le nom de chaque ligne (#90).
-- Le tableau des scores n'affiche pas les en-têtes de groupe : sans la main dans
-- le nom, les deux séries d'épreuves (20261020200000_catalogue_douteux.sql)
-- se lisaient à l'identique. Libellés seulement, identifiants inchangés.
-- Données seulement, idempotente.

begin;

update official_subtests
set name = case
      when id like '%-non-dominant' then
        case when id = 'jebsen-taylor__total-non-dominant' then 'Total, main non dominante'
             else regexp_replace(name, ', main (non )?dominante$', '') || ', main non dominante' end
      else
        case when id = 'jebsen-taylor__total-dominant' then 'Total, main dominante'
             else regexp_replace(name, ', main (non )?dominante$', '') || ', main dominante' end
    end
where organization_id is null and test_id = 'jebsen-taylor'
  and (id like '%-non-dominant' or id like '%-dominant');

commit;

-- Vérification (lecture seule) :
-- select display_order, name from official_subtests where test_id = 'jebsen-taylor' order by display_order;
-- Attendu : « Écriture, main non dominante » … « Total, main non dominante », puis les mêmes en main dominante.
