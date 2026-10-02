
CREATE TABLE IF NOT EXISTS public.recommendation_crowd (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_tags text[] NOT NULL DEFAULT '{}',
  recommendation_text text NOT NULL,
  usage_count int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT recommendation_crowd_text_unique UNIQUE (recommendation_text)
);

ALTER TABLE public.recommendation_crowd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated insert" ON public.recommendation_crowd
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "public select" ON public.recommendation_crowd
  FOR SELECT USING (true);

-- RPC to fetch contextual recommendations by keyword overlap
CREATE OR REPLACE FUNCTION get_contextual_recommendations(p_keywords text[], p_limit int DEFAULT 8)
RETURNS TABLE(recommendation_text text, usage_count int)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT recommendation_text, usage_count
  FROM public.recommendation_crowd
  WHERE diagnostic_tags && p_keywords
  ORDER BY usage_count DESC
  LIMIT p_limit;
$$;
;
