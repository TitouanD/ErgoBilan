-- Align score_type=none with numeric_4mode so Step2 can expose manual NS/ET/% fields.
-- Keep truly raw-only models untouched unless they were created from lookup/parametric flows.

UPDATE public.official_subtests
SET
  input_model = 'numeric_4mode',
  input_config = COALESCE(input_config, '{}'::jsonb) || jsonb_build_object('conversion_mode_default', 'manual')
WHERE lower(COALESCE(score_type, 'none')) = 'none'
  AND lower(COALESCE(input_model, 'numeric_4mode')) = 'raw_only'
  AND upper(COALESCE(computation_mode, 'LOOKUP')) IN ('LOOKUP', 'PARAMETRIC');
