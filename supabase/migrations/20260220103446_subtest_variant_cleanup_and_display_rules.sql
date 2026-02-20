-- Display rules hardening for ambiguous subtest variants.
-- 1) Normalize/extract helper functions.
-- 2) Targeted cleanup for known ambiguous rows still storing the tag in `name`.
-- 3) Harden contribution RPCs so ambiguous variants always carry an abbreviation/tag.

CREATE OR REPLACE FUNCTION public.normalize_subtest_abbreviation_tag(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(
    upper(
      regexp_replace(
        trim(public.unaccent(COALESCE(p_value, ''))),
        '\\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.extract_trailing_tag(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(
    trim((regexp_match(COALESCE(p_name, ''), '\\(([^()]{1,80})\\)\\s*$'))[1]),
    ''
  );
$function$;

-- Targeted cleanup only for validated multi-variant scopes:
--   - NEPSY-2 / Reconnaissance des affects (org-scoped variants)
--   - DTVP-2 / Quotient Composite (public variants)
WITH target_scopes AS (
  SELECT
    'nepsy-2'::text AS test_id,
    norm_subtest_name('Reconnaissance des affects') AS base_name_key,
    false AS is_public_scope
  UNION ALL
  SELECT
    'dtvp-2'::text AS test_id,
    norm_subtest_name('Quotient Composite') AS base_name_key,
    true AS is_public_scope
),
candidates AS (
  SELECT
    s.id,
    s.test_id,
    s.organization_id,
    trim(regexp_replace(s.name, '\\s*\\([^()]{1,80}\\)\\s*$', '')) AS base_name,
    public.extract_trailing_tag(s.name) AS trailing_tag
  FROM public.official_subtests s
  JOIN target_scopes t
    ON t.test_id = s.test_id
  WHERE s.abbreviation IS NULL
    AND public.extract_trailing_tag(s.name) IS NOT NULL
    AND norm_subtest_name(trim(regexp_replace(s.name, '\\s*\\([^()]{1,80}\\)\\s*$', ''))) = t.base_name_key
    AND (
      (t.is_public_scope AND s.organization_id IS NULL)
      OR ((NOT t.is_public_scope) AND s.organization_id IS NOT NULL)
    )
),
ambiguous_groups AS (
  SELECT
    c.test_id,
    COALESCE(c.organization_id, '00000000-0000-0000-0000-000000000000'::uuid) AS organization_scope,
    norm_subtest_name(c.base_name) AS base_name_key
  FROM candidates c
  WHERE c.base_name <> ''
  GROUP BY c.test_id, organization_scope, norm_subtest_name(c.base_name)
  HAVING COUNT(*) > 1
),
to_cleanup AS (
  SELECT
    c.id,
    c.base_name,
    public.normalize_subtest_abbreviation_tag(c.trailing_tag) AS normalized_tag
  FROM candidates c
  JOIN ambiguous_groups g
    ON g.test_id = c.test_id
   AND g.organization_scope = COALESCE(c.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
   AND g.base_name_key = norm_subtest_name(c.base_name)
  WHERE c.base_name <> ''
)
UPDATE public.official_subtests s
SET
  name = tc.base_name,
  abbreviation = tc.normalized_tag
FROM to_cleanup tc
WHERE s.id = tc.id
  AND tc.normalized_tag IS NOT NULL;

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
  v_sub_raw_name text;
  v_sub_name text;
  v_sub_base_name text;
  v_sub_abbreviation text;
  v_sub_id text;
  v_subtests jsonb;
  v_norms jsonb;
  v_existing_id text;
  v_norm_sub text;
  v_seen_subtests text[] := ARRAY[]::text[];
  v_trailing_tag text;
  v_trailing_tag_normalized text;
  v_payload_same_name_count integer;
  v_requires_abbreviation boolean;
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
    v_sub_raw_name := trim(COALESCE(v_sub->>'name', ''));
    IF v_sub_raw_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_sub_name := v_sub_raw_name;
    v_sub_abbreviation := public.normalize_subtest_abbreviation_tag(v_sub->>'abbreviation');
    v_trailing_tag := public.extract_trailing_tag(v_sub_raw_name);
    v_trailing_tag_normalized := public.normalize_subtest_abbreviation_tag(v_trailing_tag);
    v_sub_base_name := CASE
      WHEN v_trailing_tag IS NOT NULL THEN trim(regexp_replace(v_sub_raw_name, '\\s*\\([^()]{1,80}\\)\\s*$', ''))
      ELSE v_sub_raw_name
    END;
    IF v_sub_base_name = '' THEN
      v_sub_base_name := v_sub_raw_name;
    END IF;

    SELECT COUNT(*) INTO v_payload_same_name_count
    FROM jsonb_array_elements(v_subtests) s2
    WHERE norm_subtest_name(
      COALESCE(
        NULLIF(trim(regexp_replace(COALESCE(s2->>'name', ''), '\\s*\\([^()]{1,80}\\)\\s*$', '')), ''),
        trim(COALESCE(s2->>'name', ''))
      )
    ) = norm_subtest_name(v_sub_base_name);

    v_requires_abbreviation := v_payload_same_name_count > 1;

    IF v_sub_abbreviation IS NULL
       AND v_requires_abbreviation
       AND v_trailing_tag_normalized IS NOT NULL THEN
      v_sub_abbreviation := v_trailing_tag_normalized;
    END IF;

    IF v_requires_abbreviation AND v_sub_abbreviation IS NULL THEN
      RAISE EXCEPTION 'Ambiguous subtest "%" in test "%": abbreviation/tag is required', v_sub_base_name, v_test_name;
    END IF;

    IF v_requires_abbreviation THEN
      v_sub_name := v_sub_base_name;
    ELSIF v_sub_abbreviation IS NOT NULL
      AND v_trailing_tag_normalized IS NOT NULL
      AND v_trailing_tag_normalized = v_sub_abbreviation THEN
      v_sub_name := v_sub_base_name;
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
  v_sub_raw_name text;
  v_sub_name text;
  v_sub_base_name text;
  v_sub_abbreviation text;
  v_existing_sub_id text;
  v_new_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_trailing_tag text;
  v_trailing_tag_normalized text;
  v_payload_same_name_count integer;
  v_existing_same_name_count integer;
  v_existing_same_name_tagged_count integer;
  v_requires_abbreviation boolean;
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

  FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb))
  LOOP
    v_sub_raw_name := trim(COALESCE(v_sub ->> 'name', ''));
    IF v_sub_raw_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_sub_name := v_sub_raw_name;
    v_sub_abbreviation := public.normalize_subtest_abbreviation_tag(v_sub->>'abbreviation');
    v_trailing_tag := public.extract_trailing_tag(v_sub_raw_name);
    v_trailing_tag_normalized := public.normalize_subtest_abbreviation_tag(v_trailing_tag);
    v_sub_base_name := CASE
      WHEN v_trailing_tag IS NOT NULL THEN trim(regexp_replace(v_sub_raw_name, '\\s*\\([^()]{1,80}\\)\\s*$', ''))
      ELSE v_sub_raw_name
    END;
    IF v_sub_base_name = '' THEN
      v_sub_base_name := v_sub_raw_name;
    END IF;

    SELECT COUNT(*) INTO v_payload_same_name_count
    FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb)) s2
    WHERE norm_subtest_name(
      COALESCE(
        NULLIF(trim(regexp_replace(COALESCE(s2->>'name', ''), '\\s*\\([^()]{1,80}\\)\\s*$', '')), ''),
        trim(COALESCE(s2->>'name', ''))
      )
    ) = norm_subtest_name(v_sub_base_name);

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE public.normalize_subtest_abbreviation_tag(s.abbreviation) IS NOT NULL)
    INTO v_existing_same_name_count, v_existing_same_name_tagged_count
    FROM official_subtests s
    WHERE s.test_id = p_target_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_base_name);

    v_requires_abbreviation :=
      v_payload_same_name_count > 1
      OR v_existing_same_name_count > 1
      OR v_existing_same_name_tagged_count > 0;

    IF v_sub_abbreviation IS NULL
       AND v_requires_abbreviation
       AND v_trailing_tag_normalized IS NOT NULL THEN
      v_sub_abbreviation := v_trailing_tag_normalized;
    END IF;

    IF v_requires_abbreviation AND v_sub_abbreviation IS NULL THEN
      RAISE EXCEPTION 'Ambiguous subtest "%" in test "%": abbreviation/tag is required', v_sub_base_name, p_target_id;
    END IF;

    IF v_requires_abbreviation THEN
      v_sub_name := v_sub_base_name;
    ELSIF v_sub_abbreviation IS NOT NULL
      AND v_trailing_tag_normalized IS NOT NULL
      AND v_trailing_tag_normalized = v_sub_abbreviation THEN
      v_sub_name := v_sub_base_name;
    END IF;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_target_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      AND COALESCE(public.normalize_subtest_abbreviation_tag(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
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
        abbreviation = COALESCE(v_sub_abbreviation, official_subtests.abbreviation),
        unit = COALESCE(v_sub ->> 'unit', official_subtests.unit),
        score_type = COALESCE(v_sub ->> 'score_type', official_subtests.score_type),
        computation_mode = COALESCE(v_sub ->> 'computation_mode', official_subtests.computation_mode),
        input_model = COALESCE(v_sub ->> 'input_model', official_subtests.input_model),
        input_config = COALESCE(v_sub -> 'input_config', official_subtests.input_config)
      WHERE id = v_existing_sub_id;
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_sub -> 'norms', '[]'::jsonb))
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
  v_sub_raw_name text;
  v_sub_name text;
  v_sub_base_name text;
  v_sub_abbreviation text;
  v_sub_id text;
  v_existing_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_test_exists boolean;
  v_trailing_tag text;
  v_trailing_tag_normalized text;
  v_payload_same_name_count integer;
  v_existing_same_name_count integer;
  v_existing_same_name_tagged_count integer;
  v_requires_abbreviation boolean;
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

  FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb))
  LOOP
    v_sub_raw_name := trim(COALESCE(v_sub ->> 'name', ''));
    IF v_sub_raw_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_sub_name := v_sub_raw_name;
    v_sub_abbreviation := public.normalize_subtest_abbreviation_tag(v_sub->>'abbreviation');
    v_trailing_tag := public.extract_trailing_tag(v_sub_raw_name);
    v_trailing_tag_normalized := public.normalize_subtest_abbreviation_tag(v_trailing_tag);
    v_sub_base_name := CASE
      WHEN v_trailing_tag IS NOT NULL THEN trim(regexp_replace(v_sub_raw_name, '\\s*\\([^()]{1,80}\\)\\s*$', ''))
      ELSE v_sub_raw_name
    END;
    IF v_sub_base_name = '' THEN
      v_sub_base_name := v_sub_raw_name;
    END IF;

    SELECT COUNT(*) INTO v_payload_same_name_count
    FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb)) s2
    WHERE norm_subtest_name(
      COALESCE(
        NULLIF(trim(regexp_replace(COALESCE(s2->>'name', ''), '\\s*\\([^()]{1,80}\\)\\s*$', '')), ''),
        trim(COALESCE(s2->>'name', ''))
      )
    ) = norm_subtest_name(v_sub_base_name);

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE public.normalize_subtest_abbreviation_tag(s.abbreviation) IS NOT NULL)
    INTO v_existing_same_name_count, v_existing_same_name_tagged_count
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_base_name);

    v_requires_abbreviation :=
      v_payload_same_name_count > 1
      OR v_existing_same_name_count > 1
      OR v_existing_same_name_tagged_count > 0;

    IF v_sub_abbreviation IS NULL
       AND v_requires_abbreviation
       AND v_trailing_tag_normalized IS NOT NULL THEN
      v_sub_abbreviation := v_trailing_tag_normalized;
    END IF;

    IF v_requires_abbreviation AND v_sub_abbreviation IS NULL THEN
      RAISE EXCEPTION 'Ambiguous subtest "%" in test "%": abbreviation/tag is required', v_sub_base_name, p_test_id;
    END IF;

    IF v_requires_abbreviation THEN
      v_sub_name := v_sub_base_name;
    ELSIF v_sub_abbreviation IS NOT NULL
      AND v_trailing_tag_normalized IS NOT NULL
      AND v_trailing_tag_normalized = v_sub_abbreviation THEN
      v_sub_name := v_sub_base_name;
    END IF;

    v_existing_sub_id := NULL;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND s.organization_id = v_org_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      AND COALESCE(public.normalize_subtest_abbreviation_tag(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      SELECT s.id INTO v_existing_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_test_id
        AND s.organization_id IS NULL
        AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
        AND COALESCE(public.normalize_subtest_abbreviation_tag(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
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

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_sub -> 'norms', '[]'::jsonb))
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
