
-- ============================================================
-- Align norm_subtest_name SQL with JS normalizeSubtestName
-- Adds: stopword removal, plural stripping (trailing 's')
-- ============================================================

CREATE OR REPLACE FUNCTION public.norm_subtest_name(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  WITH base AS (
    SELECT lower(public.unaccent(trim(COALESCE(input, '')))) AS v
  ),
  -- Strip MABC-2 prefix
  stripped AS (
    SELECT regexp_replace(v, '^m[^a-z0-9]*abc[^a-z0-9]*2[^a-z0-9]*', '', 'g') AS v FROM base
  ),
  -- Apply synonym replacements and age-qualifier stripping
  cleaned AS (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(v,
                    E'\\([^)]*(age|ans|mois)[^)]*\\)', ' ', 'gi'),
                  E'\\bage\\s*[0-9].*$', ' ', 'gi'),
                E'\\b(une|un|one)\\b', '1', 'gi'),
              E'\\b(deux|two)\\b', '2', 'gi'),
            E'\\b(trois|three)\\b', '3', 'gi'),
          E'\\b(meilleure)\\b', 'meilleur', 'gi'),
        E'\\b(prefered|preferred|preferee|prefere)\\b', 'prefere', 'gi'),
      E'\\b(meilleur\\s+main|main\\s+meilleur|prefere\\s+main|main\\s+prefere)\\b', '1 main meilleur', 'gi'
    ) AS v FROM stripped
  ),
  -- Tokenize
  tokenized AS (
    SELECT regexp_split_to_table(v, '[^a-z0-9]+') AS token FROM cleaned
  ),
  -- Remove stopwords (aligned with JS SUBTEST_STOPWORDS)
  filtered AS (
    SELECT token FROM tokenized
    WHERE token != ''
      AND token NOT IN ('avec', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'au', 'aux', 'a', 'mabc', 'mabc2')
  ),
  -- Strip trailing 's' for basic plural handling (length > 3)
  depluralized AS (
    SELECT CASE 
      WHEN length(token) > 3 AND token ~ 's$' THEN left(token, -1)
      ELSE token
    END AS token
    FROM filtered
  )
  SELECT string_agg(token, '' ORDER BY ordinality) 
  FROM (SELECT token, row_number() OVER () AS ordinality FROM depluralized) sub;
$function$;
;
