-- =============================================================================
-- Migration: Fill remaining missing abbreviations
-- Date: 2026-03-24
-- Scope:
--   1) Completer toutes les abreviations manquantes restantes
--   2) Utiliser une regle deterministe basee sur l'identifiant technique
-- =============================================================================

begin;
update public.official_subtests s
set abbreviation = left(
  upper(
    regexp_replace(
      coalesce(nullif(split_part(s.id, '__', 2), ''), s.id),
      '[^a-zA-Z0-9]+',
      '',
      'g'
    )
  ),
  8
)
where (s.abbreviation is null or btrim(s.abbreviation) = '')
  and length(
    regexp_replace(
      coalesce(nullif(split_part(s.id, '__', 2), ''), s.id),
      '[^a-zA-Z0-9]+',
      '',
      'g'
    )
  ) > 0;
commit;
