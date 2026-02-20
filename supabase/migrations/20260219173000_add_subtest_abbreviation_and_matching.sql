-- Add explicit abbreviation support for subtests.
-- This prevents storing names like "Attention Auditive (AAO)" and later
-- appending abbreviation a second time during extraction disambiguation.

ALTER TABLE public.official_subtests
  ADD COLUMN IF NOT EXISTS abbreviation text;

COMMENT ON COLUMN public.official_subtests.abbreviation IS
  'Canonical column abbreviation/code for the subtest (e.g. AAO, MFS, RP).';

-- Normalize any existing abbreviation values.
UPDATE public.official_subtests
SET abbreviation = NULLIF(upper(regexp_replace(trim(abbreviation), '\s+', ' ', 'g')), '')
WHERE abbreviation IS NOT NULL;

-- Backfill abbreviation from a trailing uppercase code in name, e.g.
-- "Attention Auditive (AAO)" -> abbreviation="AAO".
UPDATE public.official_subtests
SET abbreviation = upper(regexp_replace(trim((regexp_match(name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]), '\s+', ' ', 'g'))
WHERE (abbreviation IS NULL OR abbreviation = '')
  AND name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$';

-- Expand unique key to include abbreviation before stripping suffixes from name.
DROP INDEX IF EXISTS public.idx_official_subtests_test_norm_subname;

CREATE UNIQUE INDEX IF NOT EXISTS idx_official_subtests_test_norm_subname
  ON public.official_subtests
  USING btree (
    test_id,
    norm_subtest_name(name),
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(upper(abbreviation), '')
  );

-- Once abbreviation is backfilled, strip that trailing code from name.
UPDATE public.official_subtests
SET name = trim(regexp_replace(name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', ''))
WHERE abbreviation IS NOT NULL
  AND name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'
  AND trim(regexp_replace(name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', '')) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_subtests_abbreviation_format_chk'
      AND conrelid = 'public.official_subtests'::regclass
  ) THEN
    ALTER TABLE public.official_subtests
      ADD CONSTRAINT official_subtests_abbreviation_format_chk
      CHECK (
        abbreviation IS NULL
        OR abbreviation ~ '^[A-Z0-9][A-Z0-9&/ -]{0,19}$'
      );
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.view_unified_subtests AS
SELECT
  s.id,
  s.test_id,
  s.name,
  s.unit,
  s.score_type,
  s.computation_mode,
  s.input_model,
  s.input_config,
  s.abbreviation
FROM public.official_subtests s
JOIN public.official_tests t ON t.id = s.test_id
WHERE (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id))
  AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id));

ALTER VIEW public.view_unified_subtests SET (security_invoker = false);

GRANT SELECT ON TABLE public.view_unified_subtests TO anon;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;

CREATE OR REPLACE FUNCTION public.create_private_test(p_payload jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_test jsonb;
  v_test_id text;
  v_test_name text;
  v_category_id text;
  v_version text;
  v_author text;
  v_sub jsonb;
  v_sub_name text;
  v_sub_abbreviation text;
  v_sub_id text;
  v_subtests jsonb;
  v_norms jsonb;
  v_existing_id text;
  v_norm_sub text;
  v_seen_subtests text[] := ARRAY[]::text[];
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  v_test := COALESCE(p_payload->'test', '{}'::jsonb);
  v_test_name := COALESCE(v_test->>'name', '');
  IF v_test_name = '' THEN
    RAISE EXCEPTION 'Test name missing';
  END IF;

  SELECT id INTO v_existing_id
  FROM official_tests
  WHERE organization_id = v_org_id
    AND norm_name(name) = norm_name(v_test_name)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    PERFORM merge_private_test(v_existing_id, p_payload);
    RETURN v_existing_id;
  END IF;

  v_category_id := COALESCE(v_test->>'category_id', '');
  v_version := COALESCE(v_test->>'version', '1.0');
  v_author := COALESCE(
    v_test->>'author',
    COALESCE(current_setting('request.jwt.claims', true)::json->>'email', '')
  );

  v_test_id := concat('priv_', split_part(v_org_id::text, '-', 1), '_', substr(gen_random_uuid()::text, 1, 8));

  INSERT INTO official_tests (id, name, category_id, version, author, organization_id)
  VALUES (v_test_id, v_test_name, v_category_id, v_version, v_author, v_org_id);

  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    v_sub_name := COALESCE(v_sub->>'name', '');
    IF v_sub_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\s+', ' ', 'g')),
      ''
    );

    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(trim((regexp_match(v_sub_name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]), '\s+', ' ', 'g'));
      v_sub_name := trim(regexp_replace(v_sub_name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', ''));
    END IF;

    v_norm_sub := norm_name(v_sub_name) || '|' || COALESCE(v_sub_abbreviation, '');
    IF v_norm_sub = ANY(v_seen_subtests) THEN
      CONTINUE;
    END IF;
    v_seen_subtests := array_append(v_seen_subtests, v_norm_sub);

    v_sub_id := concat(
      v_test_id,
      '_',
      substring(regexp_replace(lower(v_sub_name), '[^a-z0-9]+', '_', 'g') for 42),
      CASE
        WHEN v_sub_abbreviation IS NOT NULL
          THEN '_' || substring(regexp_replace(lower(v_sub_abbreviation), '[^a-z0-9]+', '_', 'g') for 7)
        ELSE ''
      END
    );

    INSERT INTO official_subtests (
      id,
      test_id,
      name,
      abbreviation,
      unit,
      score_type,
      computation_mode,
      input_model,
      input_config,
      organization_id
    )
    VALUES (
      v_sub_id,
      v_test_id,
      v_sub_name,
      v_sub_abbreviation,
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
      COALESCE(v_sub->>'input_model', 'numeric_4mode'),
      COALESCE(v_sub->'input_config', '{}'::jsonb),
      v_org_id
    );

    v_norms := v_sub->'norms';
    IF v_norms IS NOT NULL AND jsonb_array_length(v_norms) > 0 THEN
      WITH new_norms AS (
        SELECT DISTINCT
          NULLIF(n->>'age_min_months', '')::integer AS age_min_months,
          NULLIF(n->>'age_max_months', '')::integer AS age_max_months,
          COALESCE(n->>'gender', 'Mixed') AS gender,
          NULLIF(n->>'raw_min', '')::real AS raw_min,
          NULLIF(n->>'raw_max', '')::real AS raw_max,
          NULLIF(n->>'mean', '')::real AS mean,
          NULLIF(n->>'sd', '')::real AS sd,
          NULLIF(n->>'standard_score', '')::real AS standard_score,
          NULLIF(n->>'percentile', '')::real AS percentile
        FROM jsonb_array_elements(v_norms) AS n
      )
      INSERT INTO official_norms (
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
        percentile
      )
      SELECT
        v_sub_id,
        v_org_id,
        nn.age_min_months,
        nn.age_max_months,
        nn.gender,
        nn.raw_min,
        nn.raw_max,
        nn.mean,
        nn.sd,
        nn.standard_score,
        nn.percentile
      FROM new_norms nn;
    END IF;
  END LOOP;

  RETURN v_test_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.merge_private_test(p_target_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_name text;
  v_sub_abbreviation text;
  v_existing_sub_id text;
  v_new_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM official_tests
    WHERE id = p_target_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Target test not owned by your organization' USING ERRCODE = '42501';
  END IF;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := COALESCE(v_sub ->> 'name', '');
    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\s+', ' ', 'g')),
      ''
    );

    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(trim((regexp_match(v_sub_name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]), '\s+', ' ', 'g'));
      v_sub_name := trim(regexp_replace(v_sub_name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', ''));
    END IF;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_target_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      AND COALESCE(upper(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      v_new_sub_id := p_target_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 42)
        || CASE
             WHEN v_sub_abbreviation IS NOT NULL
               THEN '_' || left(regexp_replace(lower(v_sub_abbreviation), '[^a-z0-9]+', '_', 'g'), 7)
             ELSE ''
           END;

      INSERT INTO official_subtests (
        id,
        test_id,
        name,
        abbreviation,
        unit,
        score_type,
        computation_mode,
        input_model,
        input_config,
        organization_id
      )
      VALUES (
        v_new_sub_id,
        p_target_id,
        v_sub_name,
        v_sub_abbreviation,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'LOOKUP'),
        COALESCE(v_sub ->> 'input_model', 'numeric_4mode'),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_new_sub_id;
    ELSE
      UPDATE official_subtests
      SET
        abbreviation = COALESCE(v_sub_abbreviation, abbreviation),
        unit = COALESCE(v_sub ->> 'unit', unit),
        score_type = COALESCE(v_sub ->> 'score_type', score_type),
        computation_mode = COALESCE(v_sub ->> 'computation_mode', computation_mode),
        input_model = COALESCE(v_sub ->> 'input_model', input_model),
        input_config = COALESCE(v_sub -> 'input_config', input_config)
      WHERE id = v_existing_sub_id;
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(v_sub -> 'norms')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
          AND n.age_min_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_min_months')::int
          AND n.age_max_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_max_months')::int
          AND n.gender IS NOT DISTINCT FROM (v_norm_row ->> 'gender')
          AND n.raw_min IS NOT DISTINCT FROM (v_norm_row ->> 'raw_min')::real
          AND n.raw_max IS NOT DISTINCT FROM (v_norm_row ->> 'raw_max')::real
          AND n.mean IS NOT DISTINCT FROM (v_norm_row ->> 'mean')::real
          AND n.sd IS NOT DISTINCT FROM (v_norm_row ->> 'sd')::real
          AND n.standard_score IS NOT DISTINCT FROM (v_norm_row ->> 'standard_score')::real
          AND n.percentile IS NOT DISTINCT FROM (v_norm_row ->> 'percentile')::real
      ) THEN
        INSERT INTO official_norms (subtest_id, organization_id, age_min_months, age_max_months, gender, raw_min, raw_max, mean, sd, standard_score, percentile)
        VALUES (
          v_existing_sub_id,
          v_org_id,
          (v_norm_row ->> 'age_min_months')::int,
          (v_norm_row ->> 'age_max_months')::int,
          COALESCE(v_norm_row ->> 'gender', 'Mixed'),
          (v_norm_row ->> 'raw_min')::real,
          (v_norm_row ->> 'raw_max')::real,
          (v_norm_row ->> 'mean')::real,
          (v_norm_row ->> 'sd')::real,
          (v_norm_row ->> 'standard_score')::real,
          (v_norm_row ->> 'percentile')::real
        );
        v_new_norms := v_new_norms + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('new_subtests', v_new_subtests, 'new_norms', v_new_norms);
END;
$function$;

CREATE OR REPLACE FUNCTION public.attach_subtests_to_test(p_test_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_name text;
  v_sub_abbreviation text;
  v_sub_id text;
  v_existing_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_test_exists boolean;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM official_tests t
    WHERE t.id = p_test_id
      AND (t.organization_id IS NULL OR t.organization_id = v_org_id)
  ) INTO v_test_exists;

  IF NOT v_test_exists THEN
    RAISE EXCEPTION 'Test not found or not accessible' USING ERRCODE = '42704';
  END IF;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := COALESCE(v_sub ->> 'name', '');
    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\s+', ' ', 'g')),
      ''
    );

    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(trim((regexp_match(v_sub_name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]), '\s+', ' ', 'g'));
      v_sub_name := trim(regexp_replace(v_sub_name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', ''));
    END IF;

    v_existing_sub_id := NULL;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND s.organization_id = v_org_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      AND COALESCE(upper(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      SELECT s.id INTO v_existing_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_test_id
        AND s.organization_id IS NULL
        AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
        AND COALESCE(upper(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
      LIMIT 1;
    END IF;

    IF v_existing_sub_id IS NULL THEN
      v_sub_id := p_test_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 42)
        || CASE
             WHEN v_sub_abbreviation IS NOT NULL
               THEN '_' || left(regexp_replace(lower(v_sub_abbreviation), '[^a-z0-9]+', '_', 'g'), 7)
             ELSE ''
           END
        || '_' || left(v_org_id::text, 8);
      INSERT INTO official_subtests (
        id,
        test_id,
        name,
        abbreviation,
        unit,
        score_type,
        computation_mode,
        input_model,
        input_config,
        organization_id
      )
      VALUES (
        v_sub_id,
        p_test_id,
        v_sub_name,
        v_sub_abbreviation,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'LOOKUP'),
        COALESCE(v_sub ->> 'input_model', 'numeric_4mode'),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_sub_id;
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(v_sub -> 'norms')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
          AND n.organization_id IS NOT DISTINCT FROM v_org_id
          AND n.age_min_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_min_months')::int
          AND n.age_max_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_max_months')::int
          AND n.gender IS NOT DISTINCT FROM (v_norm_row ->> 'gender')
          AND n.raw_min IS NOT DISTINCT FROM (v_norm_row ->> 'raw_min')::real
          AND n.raw_max IS NOT DISTINCT FROM (v_norm_row ->> 'raw_max')::real
          AND n.mean IS NOT DISTINCT FROM (v_norm_row ->> 'mean')::real
          AND n.sd IS NOT DISTINCT FROM (v_norm_row ->> 'sd')::real
          AND n.standard_score IS NOT DISTINCT FROM (v_norm_row ->> 'standard_score')::real
          AND n.percentile IS NOT DISTINCT FROM (v_norm_row ->> 'percentile')::real
      ) THEN
        INSERT INTO official_norms (
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
          percentile
        )
        VALUES (
          v_existing_sub_id,
          v_org_id,
          (v_norm_row ->> 'age_min_months')::int,
          (v_norm_row ->> 'age_max_months')::int,
          COALESCE(v_norm_row ->> 'gender', 'Mixed'),
          (v_norm_row ->> 'raw_min')::real,
          (v_norm_row ->> 'raw_max')::real,
          (v_norm_row ->> 'mean')::real,
          (v_norm_row ->> 'sd')::real,
          (v_norm_row ->> 'standard_score')::real,
          (v_norm_row ->> 'percentile')::real
        );
        v_new_norms := v_new_norms + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'new_subtests', v_new_subtests,
    'new_norms', v_new_norms,
    'test_id', p_test_id
  );
END;
$function$;

