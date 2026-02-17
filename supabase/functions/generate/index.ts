import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 110_000;
const MAX_REQUESTS_PER_HOUR = 15;
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2_000;

type AITask = 'report_bio' | 'report_diagnostic';

type BuildResult = {
  contents: unknown;
  systemInstruction?: string;
  responseMimeType: string;
  responseSchema?: Record<string, unknown>;
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

// ── SYSTEM PROMPTS (rich, restored from original ai.ts + improved) ──────────

const SECURITY_INSTRUCTION = `REGLE DE SECURITE ABSOLUE : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymises (ex: {{PATIENT_PRENOM}}, {{PATIENT_NOM}}, {{ECOLE}}, {{MEDECIN}}). Ils doivent rester strictement intacts dans le texte genere. Ne genere aucun nouveau placeholder.`;

const PEDIATRIC_SYSTEM = `Tu es un Ergotherapeute Expert en pediatrie (Modele PPH/MOH). Ton role est de rediger des bilans cliniques rigoureux mais pedagogiques.

TES REGLES D'OR (Non negociables) :
1. **Vulgarisation Intelligente (Priorite Absolue)** : Ton rapport est lu par des non-experts (Parents, Enseignants).
   - Traduis le jargon clinique en impacts concrets sur la vie quotidienne.
   - Si tu utilises un terme expert (ex: 'cout cognitif', 'praxies', 'efficience'), accompagne-le toujours d'une explication simple ou d'un exemple.
   - Objectif : Etre "l'interprete" des difficultes de l'enfant pour son entourage.
2. **Causalite & Preuves** : Ne liste pas juste des symptomes. Fais le lien : "Score faible au BHK (Preuve) -> Dysgraphie (Constat) -> Illisibilite et lenteur en classe (Impact)".
3. **Discernement Therapeutique** : Ne pathologise pas tout.
   - Si les scores sont limites (-1 ET) ou compenses, privilegie les 'Adaptations' ou une 'Guidance' plutot qu'une reeducation systematique.
   - Valorise toujours les competences preservees et les strategies de l'enfant.
4. **Nuance Comportementale** : Distingue le "ne sait pas faire" (trouble instrumental) du "ne le fait pas quand on veut" (trouble executif/comportemental).
5. **Structure & Mise en page** :
   - Aere le texte (double saut de ligne entre paragraphes).
   - Utilise des tirets simples "-" pour les listes.
   - Pas de listes a puces dans les paragraphes narratifs longs.
   - Chaque section doit faire entre 150 et 400 mots.
6. **Format** : Reponds toujours en JSON valide strict. Les valeurs sont des strings Markdown.
7. **Scores** : Quand tu cites un score, utilise le format "NS = X" ou "z = X" suivi de l'interpretation qualitative. Ne noie pas le lecteur sous les chiffres : cite les scores cles, interprete qualitativement les autres.
8. **Limites** : Si des donnees sont manquantes ou partielles, mentionne-le explicitement. Ne comble jamais un manque par une invention.`;

const ADULT_SYSTEM = `Tu es un Ergotherapeute Expert en readaptation adulte et maintien a domicile. Ton role est de rediger des bilans cliniques axes sur l'autonomie et la qualite de vie.

TES REGLES D'OR (Non negociables) :
1. **Approche Fonctionnelle** : Centre ton analyse sur les habitudes de vie (Soins personnels, Travail, Loisirs, Conduite). Le jargon medical doit servir a expliquer une limitation d'activite.
2. **Vulgarisation & Respect** : Le rapport est lu par le patient, sa famille et les medecins. Adopte un ton adulte, respectueux et collaboratif.
3. **Securite & Prevention** : Identifie clairement les risques (Chutes, Oublis, Epuisement de l'aidant) et propose des solutions concretes (Aides techniques, Amenagement du logement).
4. **Causalite & Preuves** : Base tes conclusions sur les observations et les scores. Format : Preuve -> Constat -> Impact fonctionnel.
5. **Structure & Mise en page** : Aere le texte. Utilise des tirets simples "-". Chaque section entre 150 et 400 mots.
6. **Format** : Reponds toujours en JSON valide strict. Les valeurs sont des strings Markdown.
7. **Limites** : Mentionne explicitement les donnees manquantes. Ne comble jamais un manque par une invention.`;

// ── JSON Schemas for Gemini responseSchema constraint ──────────────────────

const BIO_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    mandat_referencement: { type: 'STRING' as const, description: 'Contexte de la demande de bilan : qui adresse, pourquoi, inquietudes rapportees. Markdown.' },
    mandat_evaluation: { type: 'STRING' as const, description: 'Objectifs precis de l\'evaluation ergotherapique, outils utilises. Markdown.' },
    profil_occupationnel: { type: 'STRING' as const, description: 'Synthese du profil : anamnese, habitudes de vie, environnement, autonomie. Markdown.' },
  },
  required: ['mandat_referencement', 'mandat_evaluation', 'profil_occupationnel'],
};

const DIAG_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    synthese_diagnostic: { type: 'STRING' as const, description: 'Synthese clinique argumentee : lien scores -> constats -> impacts. Markdown.' },
    recommandations: { type: 'STRING' as const, description: 'Recommandations concretes : adaptations, reeducation, guidance. Markdown.' },
    objectifs_generaux: { type: 'STRING' as const, description: 'Projet d\'intervention structure avec objectifs mesurables. Markdown.' },
  },
  required: ['synthese_diagnostic', 'recommandations', 'objectifs_generaux'],
};

const buildBioTask = (payload: Record<string, unknown>): BuildResult => {
  const profile = String(payload.profile || 'pediatric');
  const context = String(payload.childContext || '');
  const questionnaire = String(payload.safeQuestionnaire || '');

  const subjectLabel = profile === 'adult' ? 'PATIENT' : 'ENFANT';

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    `CONTEXTE ${subjectLabel} : ${context}`,
    '',
    `DONNEES BRUTES (questionnaire/anamnese) :\n${questionnaire}`,
    '',
    'TACHE : Redige un JSON valide avec 3 champs (valeurs = strings Markdown aere) :',
    '1. "mandat_referencement" : Qui adresse et pourquoi. Reprends les inquietudes rapportees par la famille/le medecin. Contextualise la demande.',
    '2. "mandat_evaluation" : Objectifs precis du bilan, outils et approches utilises.',
    `3. "profil_occupationnel" : Synthese riche du profil de ${profile === 'adult' ? 'la personne' : "l'enfant"} : anamnese, developpement, habitudes de vie, environnement scolaire/professionnel, autonomie dans les actes du quotidien. Mets en evidence les elements pertinents pour l'analyse clinique a venir.`,
    '',
    'CONSIGNES DE STYLE :',
    '- Chaque section : 150-400 mots, paragraphes aeres (double saut de ligne).',
    '- Ton clinique mais accessible. Pas de jargon non explique.',
    '- Utilise des tirets "-" pour les listes, pas de puces Unicode.',
    '- Ne repete pas les memes informations entre sections.',
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: BIO_RESPONSE_SCHEMA,
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

  // Directive diagnostique conditionnelle (forte)
  let diagnosticDirective: string;
  if (diagnosticInput.length > 5) {
    diagnosticDirective = [
      `IMPORTANT : Le praticien a POSE le diagnostic suivant : "${diagnosticInput}".`,
      'Ta tache est de rediger la synthese clinique en JUSTIFIANT ce diagnostic par les scores et observations fournis.',
      'Ne contredis PAS ce diagnostic. Argumente-le avec les preuves disponibles.',
      'Si certaines preuves sont faibles ou manquantes, mentionne-le avec nuance mais maintiens le diagnostic pose.',
    ].join(' ');
  } else {
    diagnosticDirective = 'Aucun diagnostic n\'a ete pose par le praticien. Tu dois DEDUIRE une synthese clinique prudente et argumentee a partir des scores et observations. Ne sur-conclus pas. Si les scores sont limites (-1 ET), privilegie une formulation nuancee.';
  }

  // Directive recommandations conditionnelle
  let recommendationsDirective: string;
  if (recommendationsInput.length > 5) {
    recommendationsDirective = `Le praticien propose le projet suivant : "${recommendationsInput}". Integre et structure ces elements dans les sections recommandations et objectifs. Complete avec des conseils concrets supplementaires si pertinent.`;
  } else {
    recommendationsDirective = 'Formule des recommandations concretes et proportionnees aux preuves. Distingue les adaptations immediates (ecole, maison) de la prise en charge therapeutique.';
  }

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    `PROFIL OCCUPATIONNEL DEJA ETABLI :\n${profilContext}`,
    '',
    `OBSERVATIONS CLINIQUES :\n${safeObservations}`,
    '',
    `RESULTATS DES TESTS (scores standardises) :\n${scoresEvidence}`,
    '',
    `DIRECTIVE DIAGNOSTIQUE :\n${diagnosticDirective}`,
    '',
    `DIRECTIVE RECOMMANDATIONS :\n${recommendationsDirective}`,
    '',
    'TACHE : Redige un JSON valide avec 3 champs (valeurs = strings Markdown aere) :',
    '1. "synthese_diagnostic" : Analyse clinique argumentee. Pour chaque domaine evalue, fais le lien : Score (preuve) -> Constat clinique -> Impact sur la vie quotidienne/scolaire. Commence par les points forts puis les difficultes.',
    '2. "recommandations" : Conseils concrets organises en categories (Adaptations scolaires, Amenagements quotidiens, Prise en charge therapeutique, Guidance parentale). Chaque recommandation doit etre actionnable.',
    '3. "objectifs_generaux" : Projet d\'intervention structure avec objectifs mesurables a court terme (3 mois) et moyen terme (6-12 mois).',
    '',
    'CONSIGNES DE STYLE :',
    '- Chaque section : 200-500 mots, paragraphes aeres.',
    '- Cite les scores cles (format "NS = X" ou "z = X") mais interprete qualitativement.',
    '- Mentionne explicitement les limites quand des donnees sont absentes ou partielles.',
    '- Ton professionnel mais accessible aux parents et enseignants.',
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: DIAG_RESPONSE_SCHEMA,
  };
};

// NOTE: Vision/OCR extraction has been moved to dedicated 'extract-norms' edge function
// for better performance (parallel processing), separate rate limits, and no credit consumption.

const buildTask = (task: AITask, payload: Record<string, unknown>): BuildResult => {
  if (task === 'report_bio') return buildBioTask(payload);
  if (task === 'report_diagnostic') return buildDiagnosticTask(payload);
  throw new Error(`Invalid task: ${task}`);
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

    if (!['report_bio', 'report_diagnostic'].includes(task)) {
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

    const generationConfig: Record<string, unknown> = {
      responseMimeType: built.responseMimeType,
    };
    if (built.responseSchema) {
      generationConfig.responseSchema = built.responseSchema;
    }

    const geminiBody: Record<string, unknown> = {
      contents: Array.isArray(built.contents)
        ? built.contents
        : [{ role: 'user', parts: [{ text: String(built.contents || '') }] }],
      generationConfig,
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
