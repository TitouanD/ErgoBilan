BEGIN;
CREATE OR REPLACE FUNCTION public.refresh_official_norm_certainty(p_test_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  WITH lookup_rows AS (
    SELECT
      n.id,
      n.subtest_id,
      COALESCE(n.organization_id, '00000000-0000-0000-0000-000000000000'::uuid) AS org_key,
      n.age_min_months,
      n.age_max_months,
      COALESCE(n.gender, 'Mixed') AS gender_key,
      n.raw_min,
      n.raw_max,
      n.standard_score,
      n.percentile
    FROM public.official_norms n
    JOIN public.official_subtests s ON s.id = n.subtest_id
    WHERE upper(COALESCE(s.computation_mode, 'LOOKUP')) = 'LOOKUP'
      AND (p_test_id IS NULL OR s.test_id = p_test_id)
  ),
  overlap_pairs AS (
    SELECT
      a.id AS id1,
      b.id AS id2,
      (
        COALESCE(a.standard_score, -99999::real) = COALESCE(b.standard_score, -99999::real)
        AND COALESCE(a.percentile, -99999::real) = COALESCE(b.percentile, -99999::real)
      ) AS same_target
    FROM lookup_rows a
    JOIN lookup_rows b
      ON a.id < b.id
     AND a.subtest_id = b.subtest_id
     AND a.org_key = b.org_key
     AND a.age_min_months = b.age_min_months
     AND a.age_max_months = b.age_max_months
     AND a.gender_key = b.gender_key
     AND a.raw_min <= b.raw_max
     AND b.raw_min <= a.raw_max
  ),
  overlap_metrics AS (
    SELECT
      id,
      1 + COALESCE(SUM(CASE WHEN same_target THEN 1 ELSE 0 END), 0) AS support_count,
      COALESCE(SUM(CASE WHEN same_target THEN 0 ELSE 1 END), 0) AS conflict_count
    FROM (
      SELECT id1 AS id, same_target FROM overlap_pairs
      UNION ALL
      SELECT id2 AS id, same_target FROM overlap_pairs
    ) x
    GROUP BY id
  ),
  calc AS (
    SELECT
      n.id,
      GREATEST(1, COALESCE(n.evidence_count, 1))::integer AS evidence_count_norm,
      GREATEST(1, COALESCE(m.support_count, 1))::integer AS support_count_norm,
      GREATEST(0, COALESCE(m.conflict_count, 0))::integer AS conflict_count_norm,
      CASE
        WHEN upper(COALESCE(s.computation_mode, 'LOOKUP')) = 'PARAMETRIC' THEN
          LEAST(0.99::real, GREATEST(0.05::real,
            (
              0.82
              + LEAST(0.12, LN(1 + GREATEST(1, COALESCE(n.evidence_count, 1))) * 0.06)
              + CASE
                  WHEN n.mean IS NOT NULL AND n.sd IS NOT NULL AND n.sd > 0 THEN 0.08
                  ELSE -0.20
                END
            )::real
          ))
        ELSE
          LEAST(0.99::real, GREATEST(0.05::real,
            (
              0.68
              + LEAST(0.22, LN(1 + GREATEST(1, COALESCE(n.evidence_count, 1)) + GREATEST(1, COALESCE(m.support_count, 1))) * 0.10)
              - LEAST(0.50, LN(1 + GREATEST(0, COALESCE(m.conflict_count, 0))) * 0.20)
              - LEAST(0.25, GREATEST(0::real, COALESCE(n.raw_max, n.raw_min, 0) - COALESCE(n.raw_min, n.raw_max, 0)) * 0.015)
              + (public.norm_lookup_target_plausibility(s.score_type, n.standard_score, n.percentile) * 0.08)
            )::real
          ))
      END AS certainty_score_norm
    FROM public.official_norms n
    JOIN public.official_subtests s ON s.id = n.subtest_id
    LEFT JOIN overlap_metrics m ON m.id = n.id
    WHERE p_test_id IS NULL OR s.test_id = p_test_id
  )
  UPDATE public.official_norms n
  SET
    evidence_count = c.evidence_count_norm,
    support_count = c.support_count_norm,
    conflict_count = c.conflict_count_norm,
    certainty_score = c.certainty_score_norm,
    certainty_bucket = CASE
      WHEN c.certainty_score_norm >= 0.90 THEN 'very_high'
      WHEN c.certainty_score_norm >= 0.75 THEN 'high'
      WHEN c.certainty_score_norm >= 0.55 THEN 'medium'
      ELSE 'low'
    END,
    certainty_updated_at = now()
  FROM calc c
  WHERE n.id = c.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_lookup_norm_conflicts(p_test_id text DEFAULT NULL)
RETURNS TABLE(archived_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_archived integer := 0;
  v_deleted integer := 0;
BEGIN
  DROP TABLE IF EXISTS tmp_norm_losers;
  CREATE TEMP TABLE tmp_norm_losers (
    loser_id uuid PRIMARY KEY,
    winner_id uuid NOT NULL
  ) ON COMMIT DROP;

  WITH ranked_rows AS (
    SELECT
      n.id,
      n.subtest_id,
      COALESCE(n.organization_id, '00000000-0000-0000-0000-000000000000'::uuid) AS org_key,
      n.age_min_months,
      n.age_max_months,
      COALESCE(n.gender, 'Mixed') AS gender_key,
      n.raw_min,
      n.raw_max,
      n.standard_score,
      n.percentile,
      public.norm_lookup_target_plausibility(s.score_type, n.standard_score, n.percentile) AS plausibility,
      GREATEST(0::real, COALESCE(n.raw_max, n.raw_min, 0) - COALESCE(n.raw_min, n.raw_max, 0)) AS raw_span,
      GREATEST(1, COALESCE(n.evidence_count, 1)) AS evidence_hint,
      CASE WHEN n.standard_score IS NOT NULL AND n.percentile IS NOT NULL THEN 1 ELSE 0 END AS has_both_targets
    FROM public.official_norms n
    JOIN public.official_subtests s ON s.id = n.subtest_id
    WHERE upper(COALESCE(s.computation_mode, 'LOOKUP')) = 'LOOKUP'
      AND (p_test_id IS NULL OR s.test_id = p_test_id)
  ),
  conflicting_pairs AS (
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.plausibility AS pl_a,
      b.plausibility AS pl_b,
      a.raw_span AS span_a,
      b.raw_span AS span_b,
      a.evidence_hint AS ev_a,
      b.evidence_hint AS ev_b,
      a.has_both_targets AS both_a,
      b.has_both_targets AS both_b
    FROM ranked_rows a
    JOIN ranked_rows b
      ON a.id < b.id
     AND a.subtest_id = b.subtest_id
     AND a.org_key = b.org_key
     AND a.age_min_months = b.age_min_months
     AND a.age_max_months = b.age_max_months
     AND a.gender_key = b.gender_key
     AND a.raw_min <= b.raw_max
     AND b.raw_min <= a.raw_max
    WHERE NOT (
      COALESCE(a.standard_score, -99999::real) = COALESCE(b.standard_score, -99999::real)
      AND COALESCE(a.percentile, -99999::real) = COALESCE(b.percentile, -99999::real)
    )
  )
  INSERT INTO tmp_norm_losers (loser_id, winner_id)
  SELECT DISTINCT
    CASE
      WHEN
        pl_a > pl_b
        OR (pl_a = pl_b AND span_a < span_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a > ev_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a = ev_b AND both_a > both_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a = ev_b AND both_a = both_b AND id_a < id_b)
      THEN id_b
      ELSE id_a
    END AS loser_id,
    CASE
      WHEN
        pl_a > pl_b
        OR (pl_a = pl_b AND span_a < span_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a > ev_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a = ev_b AND both_a > both_b)
        OR (pl_a = pl_b AND span_a = span_b AND ev_a = ev_b AND both_a = both_b AND id_a < id_b)
      THEN id_a
      ELSE id_b
    END AS winner_id
  FROM conflicting_pairs
  ON CONFLICT (loser_id) DO NOTHING;

  INSERT INTO public.official_norms_conflict_archive (
    norm_id,
    subtest_id,
    organization_id,
    age_min_months,
    age_max_months,
    gender,
    raw_min,
    raw_max,
    mean,
    sd,
    standard_score,
    percentile,
    evidence_count,
    support_count,
    conflict_count,
    certainty_score,
    certainty_bucket,
    certainty_updated_at,
    archived_reason,
    replaced_by_norm_id
  )
  SELECT
    n.id,
    n.subtest_id,
    n.organization_id,
    n.age_min_months,
    n.age_max_months,
    n.gender,
    n.raw_min,
    n.raw_max,
    n.mean,
    n.sd,
    n.standard_score,
    n.percentile,
    n.evidence_count,
    n.support_count,
    n.conflict_count,
    n.certainty_score,
    n.certainty_bucket,
    n.certainty_updated_at,
    'LOOKUP conflict overlap: replaced by higher-ranked norm',
    l.winner_id
  FROM public.official_norms n
  JOIN tmp_norm_losers l ON l.loser_id = n.id;

  GET DIAGNOSTICS v_archived = ROW_COUNT;

  DELETE FROM public.official_norms n
  USING tmp_norm_losers l
  WHERE n.id = l.loser_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM public.refresh_official_norm_certainty(p_test_id);

  archived_count := v_archived;
  deleted_count := v_deleted;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.official_norms_capture_duplicate_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  SELECT n.id
  INTO v_existing_id
  FROM public.official_norms n
  WHERE n.subtest_id = NEW.subtest_id
    AND n.organization_id IS NOT DISTINCT FROM NEW.organization_id
    AND n.age_min_months IS NOT DISTINCT FROM NEW.age_min_months
    AND n.age_max_months IS NOT DISTINCT FROM NEW.age_max_months
    AND n.gender IS NOT DISTINCT FROM NEW.gender
    AND n.raw_min IS NOT DISTINCT FROM NEW.raw_min
    AND n.raw_max IS NOT DISTINCT FROM NEW.raw_max
    AND n.mean IS NOT DISTINCT FROM NEW.mean
    AND n.sd IS NOT DISTINCT FROM NEW.sd
    AND n.standard_score IS NOT DISTINCT FROM NEW.standard_score
    AND n.percentile IS NOT DISTINCT FROM NEW.percentile
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.official_norms
    SET
      evidence_count = evidence_count + 1,
      certainty_updated_at = now()
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;

  NEW.evidence_count := GREATEST(1, COALESCE(NEW.evidence_count, 1));
  NEW.support_count := GREATEST(1, COALESCE(NEW.support_count, 1));
  NEW.conflict_count := GREATEST(0, COALESCE(NEW.conflict_count, 0));
  NEW.certainty_score := LEAST(0.99, GREATEST(0.05, COALESCE(NEW.certainty_score, 0.75)));
  NEW.certainty_bucket := COALESCE(NEW.certainty_bucket, 'medium');
  NEW.certainty_updated_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_official_norms_capture_duplicate_evidence ON public.official_norms;
CREATE TRIGGER trg_official_norms_capture_duplicate_evidence
BEFORE INSERT ON public.official_norms
FOR EACH ROW
EXECUTE FUNCTION public.official_norms_capture_duplicate_evidence();

CREATE OR REPLACE VIEW public.view_official_norm_certainty AS
SELECT
  n.id AS norm_id,
  t.id AS test_id,
  t.name AS test_name,
  s.id AS subtest_id,
  s.name AS subtest_name,
  s.score_type,
  s.computation_mode,
  s.input_model,
  n.organization_id,
  n.age_min_months,
  n.age_max_months,
  COALESCE(n.gender, 'Mixed') AS gender,
  n.raw_min,
  n.raw_max,
  n.mean,
  n.sd,
  n.standard_score,
  n.percentile,
  n.evidence_count,
  n.support_count,
  n.conflict_count,
  n.certainty_score,
  n.certainty_bucket,
  n.certainty_updated_at
FROM public.official_norms n
JOIN public.official_subtests s ON s.id = n.subtest_id
JOIN public.official_tests t ON t.id = s.test_id;

CREATE OR REPLACE FUNCTION public.admin_list_norm_certainty(
  p_test_id text DEFAULT NULL,
  p_subtest_id text DEFAULT NULL,
  p_only_conflicted boolean DEFAULT false,
  p_max_rows integer DEFAULT 500
)
RETURNS TABLE (
  norm_id uuid,
  test_id text,
  test_name text,
  subtest_id text,
  subtest_name text,
  score_type text,
  computation_mode text,
  input_model text,
  organization_id uuid,
  age_min_months integer,
  age_max_months integer,
  gender text,
  raw_min real,
  raw_max real,
  mean real,
  sd real,
  standard_score real,
  percentile real,
  evidence_count integer,
  support_count integer,
  conflict_count integer,
  certainty_score real,
  certainty_bucket text,
  certainty_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.norm_id,
    v.test_id,
    v.test_name,
    v.subtest_id,
    v.subtest_name,
    v.score_type,
    v.computation_mode,
    v.input_model,
    v.organization_id,
    v.age_min_months,
    v.age_max_months,
    v.gender,
    v.raw_min,
    v.raw_max,
    v.mean,
    v.sd,
    v.standard_score,
    v.percentile,
    v.evidence_count,
    v.support_count,
    v.conflict_count,
    v.certainty_score,
    v.certainty_bucket,
    v.certainty_updated_at
  FROM public.view_official_norm_certainty v
  WHERE (p_test_id IS NULL OR v.test_id = p_test_id)
    AND (p_subtest_id IS NULL OR v.subtest_id = p_subtest_id)
    AND (NOT p_only_conflicted OR v.conflict_count > 0)
  ORDER BY v.conflict_count DESC, v.certainty_score ASC, v.test_name, v.subtest_name, v.age_min_months, v.raw_min
  LIMIT LEAST(GREATEST(COALESCE(p_max_rows, 500), 1), 5000);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_norm_certainty(text, text, boolean, integer) TO authenticated;
COMMIT;
