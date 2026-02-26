BEGIN;

-- Normalize legacy tokens before enforcing defaults/constraints.
UPDATE public.official_subtests
SET score_type = lower(btrim(score_type))
WHERE score_type IS NOT NULL
  AND score_type <> lower(btrim(score_type));

UPDATE public.official_subtests
SET computation_mode = upper(btrim(computation_mode))
WHERE computation_mode IS NOT NULL
  AND computation_mode <> upper(btrim(computation_mode));

UPDATE public.official_subtests
SET input_model = lower(btrim(input_model))
WHERE input_model IS NOT NULL
  AND input_model <> lower(btrim(input_model));

UPDATE public.official_subtests
SET score_type = 'none'
WHERE score_type IS NULL OR btrim(score_type) = '';

UPDATE public.official_subtests
SET computation_mode = 'LOOKUP'
WHERE computation_mode IS NULL OR btrim(computation_mode) = '';

UPDATE public.official_subtests
SET input_model = 'numeric_4mode'
WHERE input_model IS NULL OR btrim(input_model) = '';

ALTER TABLE public.official_subtests
  ALTER COLUMN score_type SET DEFAULT 'none',
  ALTER COLUMN computation_mode SET DEFAULT 'LOOKUP',
  ALTER COLUMN input_model SET DEFAULT 'numeric_4mode';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_subtests_score_type_domain_chk'
  ) THEN
    ALTER TABLE public.official_subtests
      ADD CONSTRAINT official_subtests_score_type_domain_chk
      CHECK (score_type IN ('standard', 'scaled', 't-score', 'percentile', 'sten', 'stanine', 'none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_subtests_computation_mode_domain_chk'
  ) THEN
    ALTER TABLE public.official_subtests
      ADD CONSTRAINT official_subtests_computation_mode_domain_chk
      CHECK (computation_mode IN ('LOOKUP', 'PARAMETRIC', 'NONE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_subtests_input_model_domain_chk'
  ) THEN
    ALTER TABLE public.official_subtests
      ADD CONSTRAINT official_subtests_input_model_domain_chk
      CHECK (input_model IN ('numeric_4mode', 'qualitative_category', 'raw_only'));
  END IF;
END;
$$;

COMMIT;
