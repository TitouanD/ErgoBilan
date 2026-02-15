import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 110_000;
const MAX_REQUESTS_PER_HOUR = 15;
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2_000;

type AITask = 'report_bio' | 'report_diagnostic' | 'extract_norms';

type BuildResult = {
  contents: unknown;
  systemInstruction?: string;
  responseMimeType: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (status: number) => status === 503 || status === 429;

const safeRefund = async (
  sb: ReturnType<typeof createClient> | null,
  genId: string | null,
  isReused: boolean,
) => {
  if (isReused || !sb || !genId) return;
  try {
    await sb.rpc('refund_credit', { p_generation_id: genId });
  } catch (_e) {
    // no-op
  }
};

const PEDIATRIC_SYSTEM = `Tu es un ergotherapeute pediatrique. Rends un texte clinique sobre, structure, professionnel.
Regles: lien preuve->impact, langage clair, limites explicites si donnees manquantes, jamais de placeholders inventes.`;

const ADULT_SYSTEM = `Tu es un ergotherapeute adulte. Focus autonomie, securite, retentissement fonctionnel.
Regles: lien preuve->impact, ton clinique sobre, limites explicites si donnees manquantes.`;

const buildBioTask = (payload: Record<string, unknown>): BuildResult => {
  const profile = String(payload.profile || 'pediatric');
  const context = String(payload.childContext || '');
  const questionnaire = String(payload.safeQuestionnaire || '');

  const userPrompt = [
    'TACHE: produire un JSON valide uniquement.',
    'Champs requis: mandat_referencement, mandat_evaluation, profil_occupationnel.',
    'Style: clinique, structure claire, argumente.',
    `Contexte: ${context}`,
    `Questionnaire: ${questionnaire}`,
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
  };
};

const buildDiagnosticTask = (payload: Record<string, unknown>): BuildResult => {
  const profile = String(payload.profile || 'pediatric');
  const profilContext = JSON.stringify(payload.profilContext || 'Non disponible');
  const safeObservations = String(payload.safeObservations || 'RAS');
  const scoresEvidence = JSON.stringify(payload.scoresEvidence || [], null, 2);
  const synthesis = (payload.synthesis || {}) as Record<string, unknown>;
  const diagnosticInput = String(synthesis.diagnosticInput || '').trim();
  const recommendationsInput = String(synthesis.recommendationsInput || '').trim();

  const diagnosticDirective = diagnosticInput.length > 3
    ? `Le praticien a pose: "${diagnosticInput}". Justifie ce positionnement avec les preuves disponibles.`
    : 'Si aucun diagnostic n est fourni, propose une synthese prudente et argumentee sans sur-conclusion.';

  const recommendationsDirective = recommendationsInput.length > 3
    ? `Le praticien propose: "${recommendationsInput}". Structure et complete ces recommandations.`
    : 'Formule des recommandations concretes et proportionnees aux preuves.';

  const userPrompt = [
    'TACHE: produire un JSON valide uniquement.',
    'Champs requis: synthese_diagnostic, recommandations, objectifs_generaux.',
    'Format attendu: markdown sobre, sections courtes, liens preuve->impact explicites.',
    diagnosticDirective,
    recommendationsDirective,
    `Profil occupationnel deja etabli: ${profilContext}`,
    `Observations: ${safeObservations}`,
    `Scores (evidence-ready): ${scoresEvidence}`,
    'Important: mentionner explicitement les limites quand des donnees sont absentes ou partielles.',
  ].join('\n\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
  };
};

const buildExtractNormsTask = (payload: Record<string, unknown>): BuildResult => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const imagePart = payload.imagePart;

  const knownNamesBlock = knownSubtestNames.length > 0
    ? `Sous-tests deja connus a reutiliser quand pertinent: ${JSON.stringify(knownSubtestNames)}`
    : 'Aucun sous-test pre-connu.';

  const prompt = [
    'ROLE: extraction de normes cliniques en ergotherapie.',
    `Contexte fichier: ${filename}`,
    knownNamesBlock,
    'Sortie JSON stricte uniquement (pas de markdown).',
    'Classer la structure: PARAMETRIC ou LOOKUP.',
    'Extraire et normaliser: age_min_months, age_max_months, raw_min, raw_max.',
    'Schema JSON:',
    '{"test_context":"string","structure_type":"PARAMETRIC|LOOKUP","tables":[{"subtest_id":"string","rows":[{"label":"string","mean":"string","sd":"string","raw_range":"string","standard":"string","percentile":"string","z_score":"string","age_min_months":number,"age_max_months":number,"raw_min":number,"raw_max":number}]}]}',
    'Consignes qualite: noms de sous-tests stables en francais, pas de code technique, garder les plages brutes en texte pour LOOKUP.',
  ].join('\n');

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
    responseMimeType: 'application/json',
  };
};

const buildTask = (task: AITask, payload: Record<string, unknown>): BuildResult => {
  if (task === 'report_bio') return buildBioTask(payload);
  if (task === 'report_diagnostic') return buildDiagnosticTask(payload);
  return buildExtractNormsTask(payload);
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let generationId: string | null = null;
  let isReusedSession = false;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const accessToken = bearerMatch[1].trim();
    const jwtParts = accessToken.split('.');
    const malformedJwt = jwtParts.length !== 3 || jwtParts.some((part) => part.length === 0);
    if (!accessToken || accessToken.startsWith('sb_publishable_') || accessToken.startsWith('sb_secret_') || malformedJwt) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: withinLimit, error: rlErr } = await supabase.rpc('check_rate_limit', { p_max_per_hour: MAX_REQUESTS_PER_HOUR });
    if (rlErr || !withinLimit) {
      return new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'Trop de requetes. Reessayez plus tard.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const task = String(body.task || '') as AITask;
    const payload = (body.payload || {}) as Record<string, unknown>;
    const providedGenId = typeof body.generation_id === 'string' ? body.generation_id : null;

    if (!['report_bio', 'report_diagnostic', 'extract_norms'].includes(task)) {
      return new Response(JSON.stringify({ error: 'INVALID_TASK' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (providedGenId) {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: validGen } = await supabase
        .from('generation_log')
        .select('id')
        .eq('id', providedGenId)
        .eq('user_id', user.id)
        .neq('status', 'refunded')
        .gte('created_at', tenMinAgo)
        .single();

      if (validGen) {
        generationId = providedGenId;
        isReusedSession = true;
      }
    }

    if (!isReusedSession) {
      const { data: genId, error: creditErr } = await supabase.rpc('consume_credit');
      if (creditErr || !genId) {
        return new Response(JSON.stringify({ error: 'CREDIT_INSUFFICIENT', message: 'Credits insuffisants.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      generationId = genId;
    }

    if (!GEMINI_API_KEY) {
      await safeRefund(supabase, generationId, isReusedSession);
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const built = buildTask(task, payload);

    const geminiBody: Record<string, unknown> = {
      contents: Array.isArray(built.contents)
        ? built.contents
        : [{ role: 'user', parts: [{ text: String(built.contents || '') }] }],
      generationConfig: { responseMimeType: built.responseMimeType },
    };

    if (built.systemInstruction) {
      geminiBody.system_instruction = { parts: [{ text: built.systemInstruction }] };
    }

    let geminiResponse: Response | null = null;
    let lastGeminiStatus = 0;

    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (geminiResponse.ok) break;

        lastGeminiStatus = geminiResponse.status;
        if (!isRetryableStatus(geminiResponse.status)) break;

        await geminiResponse.text();
        geminiResponse = null;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          await safeRefund(supabase, generationId, isReusedSession);
          return new Response(JSON.stringify({ error: 'Gemini request timed out', retryable: true }), {
            status: 504,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (attempt === GEMINI_MAX_RETRIES) {
          await safeRefund(supabase, generationId, isReusedSession);
          throw err;
        }
        lastGeminiStatus = 0;
        geminiResponse = null;
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      const retryable = isRetryableStatus(lastGeminiStatus);
      await safeRefund(supabase, generationId, isReusedSession);
      return new Response(JSON.stringify({ error: 'AI generation failed', details: lastGeminiStatus || 0, retryable }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiResponse.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    return new Response(JSON.stringify({ text, generationId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    await safeRefund(supabase, generationId, isReusedSession);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
