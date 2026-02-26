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

    v_new := regexp_replace(
      v_new,
      E'COALESCE\\(v_sub\\s*->>\\s*''score_type'',\\s*''standard''\\)',
      'COALESCE(NULLIF(v_sub ->> ''score_type'', ''''), ''none'')',
      'g'
    );
    v_new := regexp_replace(
      v_new,
      E'COALESCE\\(v_sub\\s*->>\\s*''computation_mode'',\\s*''LOOKUP''\\)',
      'upper(COALESCE(NULLIF(v_sub ->> ''computation_mode'', ''''), ''LOOKUP''))',
      'g'
    );
    v_new := regexp_replace(
      v_new,
      E'COALESCE\\(v_sub\\s*->>\\s*''input_model'',\\s*''numeric_4mode''\\)',
      'lower(COALESCE(NULLIF(v_sub ->> ''input_model'', ''''), ''numeric_4mode''))',
      'g'
    );

    v_new := regexp_replace(
      v_new,
      E'score_type\\s*=\\s*COALESCE\\(v_sub\\s*->>\\s*''score_type'',\\s*official_subtests\\.score_type\\),',
      'score_type = COALESCE(NULLIF(v_sub ->> ''score_type'', ''''), official_subtests.score_type),',
      'g'
    );
    v_new := regexp_replace(
      v_new,
      E'computation_mode\\s*=\\s*COALESCE\\(v_sub\\s*->>\\s*''computation_mode'',\\s*official_subtests\\.computation_mode\\),',
      'computation_mode = upper(COALESCE(NULLIF(v_sub ->> ''computation_mode'', ''''), official_subtests.computation_mode)),',
      'g'
    );
    v_new := regexp_replace(
      v_new,
      E'input_model\\s*=\\s*COALESCE\\(v_sub\\s*->>\\s*''input_model'',\\s*official_subtests\\.input_model\\),',
      'input_model = lower(COALESCE(NULLIF(v_sub ->> ''input_model'', ''''), official_subtests.input_model)),',
      'g'
    );

    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END;
$$;
