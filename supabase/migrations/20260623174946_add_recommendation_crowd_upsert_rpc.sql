
CREATE OR REPLACE FUNCTION upsert_recommendation(
  p_text text,
  p_tags text[]
) RETURNS void
LANGUAGE sql
SECURITY DEFINER AS $$
  INSERT INTO public.recommendation_crowd (recommendation_text, diagnostic_tags, usage_count)
  VALUES (p_text, p_tags, 1)
  ON CONFLICT (recommendation_text)
  DO UPDATE SET
    usage_count = recommendation_crowd.usage_count + 1,
    diagnostic_tags = (
      SELECT array_agg(DISTINCT t)
      FROM unnest(recommendation_crowd.diagnostic_tags || EXCLUDED.diagnostic_tags) t
    );
$$;
;
