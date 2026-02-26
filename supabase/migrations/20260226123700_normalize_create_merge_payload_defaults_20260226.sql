DO $$
DECLARE
  v_sig regprocedure;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_private_test(jsonb)'::regprocedure,
    'public.merge_private_test(text,jsonb)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(v_sig) INTO v_def;
    v_new := v_def;

    v_new := replace(
      v_new,
      'COALESCE(v_sub ->> ''score_type'', ''standard'')',
      'COALESCE(NULLIF(v_sub ->> ''score_type'', ''''), ''none'')'
    );
    v_new := replace(
      v_new,
      'COALESCE(v_sub ->> ''computation_mode'', ''LOOKUP'')',
      'upper(COALESCE(NULLIF(v_sub ->> ''computation_mode'', ''''), ''LOOKUP''))'
    );
    v_new := replace(
      v_new,
      'COALESCE(v_sub ->> ''input_model'', ''numeric_4mode'')',
      'lower(COALESCE(NULLIF(v_sub ->> ''input_model'', ''''), ''numeric_4mode''))'
    );

    v_new := replace(
      v_new,
      'score_type = COALESCE(v_sub ->> ''score_type'', official_subtests.score_type),',
      'score_type = COALESCE(NULLIF(v_sub ->> ''score_type'', ''''), official_subtests.score_type),'
    );
    v_new := replace(
      v_new,
      'computation_mode = COALESCE(v_sub ->> ''computation_mode'', official_subtests.computation_mode),',
      'computation_mode = upper(COALESCE(NULLIF(v_sub ->> ''computation_mode'', ''''), official_subtests.computation_mode)),'
    );
    v_new := replace(
      v_new,
      'input_model = COALESCE(v_sub ->> ''input_model'', official_subtests.input_model),',
      'input_model = lower(COALESCE(NULLIF(v_sub ->> ''input_model'', ''''), official_subtests.input_model)),'
    );

    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END;
$$;
