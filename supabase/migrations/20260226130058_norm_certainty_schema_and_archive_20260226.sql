BEGIN;

ALTER TABLE public.official_norms
  ADD COLUMN IF NOT EXISTS evidence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS support_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conflict_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS certainty_score real NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS certainty_bucket text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS certainty_updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.official_norms
SET
  evidence_count = GREATEST(1, COALESCE(evidence_count, 1)),
  support_count = GREATEST(1, COALESCE(support_count, 1)),
  conflict_count = GREATEST(0, COALESCE(conflict_count, 0)),
  certainty_score = LEAST(0.99, GREATEST(0.05, COALESCE(certainty_score, 0.75))),
  certainty_bucket = CASE
    WHEN COALESCE(certainty_score, 0.75) >= 0.90 THEN 'very_high'
    WHEN COALESCE(certainty_score, 0.75) >= 0.75 THEN 'high'
    WHEN COALESCE(certainty_score, 0.75) >= 0.55 THEN 'medium'
    ELSE 'low'
  END,
  certainty_updated_at = COALESCE(certainty_updated_at, now());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_evidence_count_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_evidence_count_chk CHECK (evidence_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_support_count_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_support_count_chk CHECK (support_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_conflict_count_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_conflict_count_chk CHECK (conflict_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_certainty_score_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_certainty_score_chk CHECK (certainty_score >= 0 AND certainty_score <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_certainty_bucket_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_certainty_bucket_chk CHECK (certainty_bucket IN ('low', 'medium', 'high', 'very_high'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.official_norms_conflict_archive (
  archive_id bigserial PRIMARY KEY,
  norm_id uuid NOT NULL,
  subtest_id text NOT NULL,
  organization_id uuid NULL,
  age_min_months integer NULL,
  age_max_months integer NULL,
  gender text NULL,
  raw_min real NULL,
  raw_max real NULL,
  mean real NULL,
  sd real NULL,
  standard_score real NULL,
  percentile real NULL,
  evidence_count integer NOT NULL DEFAULT 1,
  support_count integer NOT NULL DEFAULT 1,
  conflict_count integer NOT NULL DEFAULT 0,
  certainty_score real NOT NULL DEFAULT 0.75,
  certainty_bucket text NOT NULL DEFAULT 'medium',
  certainty_updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_reason text NOT NULL,
  replaced_by_norm_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_norm_archive_norm_id ON public.official_norms_conflict_archive(norm_id);
CREATE INDEX IF NOT EXISTS idx_norm_archive_subtest_id ON public.official_norms_conflict_archive(subtest_id);
CREATE INDEX IF NOT EXISTS idx_norm_archive_archived_at ON public.official_norms_conflict_archive(archived_at DESC);

CREATE OR REPLACE FUNCTION public.norm_lookup_target_plausibility(
  p_score_type text,
  p_standard_score real,
  p_percentile real
) RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE lower(COALESCE(p_score_type, ''))
    WHEN 'scaled' THEN
      IF p_standard_score IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_standard_score >= 1 AND p_standard_score <= 19 THEN 1 ELSE 0 END;
    WHEN 'stanine' THEN
      IF p_standard_score IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_standard_score >= 1 AND p_standard_score <= 9 THEN 1 ELSE 0 END;
    WHEN 'sten' THEN
      IF p_standard_score IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_standard_score >= 1 AND p_standard_score <= 10 THEN 1 ELSE 0 END;
    WHEN 't-score' THEN
      IF p_standard_score IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_standard_score >= 20 AND p_standard_score <= 80 THEN 1 ELSE 0 END;
    WHEN 'standard' THEN
      IF p_standard_score IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_standard_score >= 40 AND p_standard_score <= 160 THEN 1 ELSE 0 END;
    WHEN 'percentile' THEN
      IF p_percentile IS NULL THEN RETURN 0; END IF;
      RETURN CASE WHEN p_percentile >= 0 AND p_percentile <= 100 THEN 1 ELSE 0 END;
    WHEN 'none' THEN
      RETURN CASE
        WHEN p_standard_score IS NOT NULL OR (p_percentile IS NOT NULL AND p_percentile >= 0 AND p_percentile <= 100) THEN 1
        ELSE 0
      END;
    ELSE
      RETURN 1;
  END CASE;
END;
$$;

COMMIT;
