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

// ── SYSTEM PROMPTS ──────────

const SECURITY_INSTRUCTION = `REGLE DE SECURITE ABSOLUE : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymises (ex: {{PATIENT_PRENOM}}, {{PATIENT_NOM}}, {{ECOLE}}, {{MEDECIN}}). Ils doivent rester strictement intacts dans le texte genere. Ne genere aucun nouveau placeholder.`;

const PEDIATRIC_SYSTEM = `Tu es un ergotherapeute expert en pediatrie. Tu rediges des rapports d'evaluation initiale en ergotherapie conformes a la convention clinique francaise.

REGLES NON NEGOCIABLES :
1. **Factuel et concis** : Chaque phrase doit etre informative. Pas de remplissage, pas de reformulation inutile. Vise 50-200 mots par section (sauf diagnostique : 100-300 mots).
2. **Ne pathologise PAS** : Si les scores sont dans la norme ou norme basse (-1 ET), dis-le clairement ("dans la norme", "fonctionnel", "norme basse sans impact fonctionnel"). Ne transforme pas une norme basse en difficulte.
3. **Mentionne TOUS les tests** : Chaque test/epreuve fourni dans les scores doit etre cite dans le diagnostique. Ne selectionne pas — couvre tout.
4. **Scores bruts uniquement** : Cite les scores EXACTEMENT comme fournis (NS = X, ET = X, % = X). Ne convertis JAMAIS d'une echelle a une autre. Ne calcule pas de z-score a partir d'un NS ou inversement.
5. **Structure par domaine** : Dans le diagnostique, organise par domaine fonctionnel ("Sur le plan moteur fin...", "Sur le plan graphique...", "Sur le plan visuo-spatial...").
6. **Pas de diagnostic medical** : Tu ne poses JAMAIS de diagnostic (pas de TDA/H, dysgraphie, dyspraxie...) sauf si le praticien l'a explicitement fourni. Tu decris des observations et des constats fonctionnels.
7. **Langage accessible** : Le rapport est lu par les parents et l'ecole. Si tu utilises un terme technique, explique-le entre parentheses.
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Utilise des tirets "-" pour les listes. Aere le texte (double saut de ligne entre paragraphes).`;

const ADULT_SYSTEM = `Tu es un ergotherapeute expert en readaptation adulte et maintien a domicile. Tu rediges des rapports d'evaluation en ergotherapie conformes a la convention clinique francaise.

REGLES NON NEGOCIABLES :
1. **Factuel et concis** : 50-200 mots par section (sauf diagnostique : 100-300 mots). Pas de remplissage.
2. **Ne pathologise PAS** : Si les scores sont dans la norme, dis-le clairement.
3. **Mentionne TOUS les tests** : Chaque test fourni doit etre cite.
4. **Scores bruts uniquement** : Cite EXACTEMENT comme fournis. Ne convertis jamais d'echelle.
5. **Structure par domaine** : Organise le diagnostique par domaine fonctionnel.
6. **Pas de diagnostic medical** : Decris des constats fonctionnels, pas de diagnostics.
7. **Approche fonctionnelle** : Centre l'analyse sur les habitudes de vie (soins, travail, loisirs). Ton respectueux et collaboratif.
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Tirets "-" pour les listes.`;

// ── JSON Schemas for Gemini responseSchema constraint ──────────────────────

const BIO_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    mandat_referencement: { type: 'STRING' as const, description: 'Qui adresse et pourquoi, en 2-4 phrases factuelles. Markdown.' },
    mandat_evaluation: { type: 'STRING' as const, description: 'Difficultes concretes de l\'enfant qui motivent le bilan, observees au quotidien. Markdown.' },
    profil_occupationnel: { type: 'STRING' as const, description: 'Profil factuel : developpement, autonomie, vie quotidienne, scolarite, loisirs, comportement. Markdown.' },
  },
  required: ['mandat_referencement', 'mandat_evaluation', 'profil_occupationnel'],
};

const DIAG_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    synthese_diagnostic: { type: 'STRING' as const, description: 'Diagnostique en ergotherapie : analyse par domaine fonctionnel avec scores et observations. Markdown.' },
    recommandations: { type: 'STRING' as const, description: 'Recommandations concretes organisees par domaine. Markdown.' },
    objectifs_generaux: { type: 'STRING' as const, description: 'Objectifs du suivi en ergotherapie, ou mention que le suivi n\'est pas preconise. Markdown.' },
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
    'TACHE : Redige un JSON avec 3 champs (valeurs = strings Markdown) en respectant STRICTEMENT ce format :',
    '',
    '1. "mandat_referencement" (2-4 phrases, 30-80 mots) :',
    '   Qui adresse l\'enfant et pourquoi, de maniere factuelle.',
    '   EXEMPLES DE STYLE :',
    '   - "[PRENOM] est recu(e) en consultation d\'ergotherapie a la demande du Dr X, afin d\'evaluer Y."',
    '   - "[PRENOM] est recu(e) a la demande de Mme X, coordinatrice du parcours PCO, de bilanter la motricite globale et fine."',
    '   Si la famille a exprime des priorites/objectifs, mentionne-les en une phrase.',
    '',
    '2. "mandat_evaluation" (50-150 mots) :',
    '   Decris les DIFFICULTES CONCRETES de l\'enfant qui motivent le bilan.',
    '   PAS la methodologie, PAS les outils utilises, PAS les objectifs du bilan.',
    '   Decris ce que l\'enfant VIT au quotidien : problemes scolaires, d\'ecriture, sensoriels, attentionnels, etc.',
    '   EXEMPLES DE STYLE :',
    '   - "[PRENOM] presente des difficultes sur le plan sensoriel. Elle est particulierement sensible aux sons, qui la fatigue rapidement."',
    '   - "[PRENOM] rencontre des difficultes dans son environnement scolaire. Il presente des difficultes a ecrire de maniere lisible."',
    '',
    '3. "profil_occupationnel" (100-200 mots) :',
    '   Synthese factuelle du profil de l\'enfant : developpement moteur, langage, autonomie (repas, habillage, hygiene), sommeil, scolarite (matiere aimee/non aimee, aides en place), loisirs, comportement social et emotionnel.',
    '   Rapporte les faits sans interpreter. Pas de jugement clinique ici.',
    '',
    'CONSIGNES DE STYLE :',
    '- Ton clinique mais accessible.',
    '- Paragraphes aeres (double saut de ligne).',
    '- Tirets "-" pour les listes.',
    '- Ne repete pas les memes informations entre sections.',
    '- N\'invente rien : si une donnee est absente, ne la mentionne pas.',
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

  // Directive diagnostique conditionnelle
  let diagnosticDirective: string;
  if (diagnosticInput.length > 5) {
    diagnosticDirective = [
      `Le praticien a pose le constat suivant : "${diagnosticInput}".`,
      'Justifie ce constat par les scores et observations fournis.',
      'Ne contredis PAS ce constat. Si certaines preuves sont faibles, mentionne-le avec nuance.',
    ].join(' ');
  } else {
    diagnosticDirective = [
      'Aucun constat n\'a ete pose par le praticien.',
      'Deduis une synthese PRUDENTE a partir des scores et observations.',
      'INTERDIT : Ne pose AUCUN diagnostic medical (TDA/H, dysgraphie, dyspraxie, trouble visuo-spatial, etc.).',
      'Tu decris des CONSTATS FONCTIONNELS ("presente des fragilites en motricite fine", "l\'ecriture est fonctionnelle") et NON des diagnostics.',
      'Si les scores sont dans la norme (-1 a +1 ET), dis clairement que c\'est normal/fonctionnel.',
      'Si les scores sont en norme basse (-1 a -1.5 ET), parle de "fragilites" sans pathologiser.',
      'Si tu n\'es pas sur, privilegie la prudence et suggere un bilan complementaire.',
    ].join(' ');
  }

  // Directive recommandations conditionnelle
  let recommendationsDirective: string;
  if (recommendationsInput.length > 5) {
    recommendationsDirective = `Le praticien propose : "${recommendationsInput}". Integre ces elements et complete si pertinent.`;
  } else {
    recommendationsDirective = 'Formule des recommandations concretes et proportionnees aux resultats. Organise par domaine (ex: "Sur le plan sensoriel :", "Sur le plan graphique :"). Chaque recommandation doit etre actionnable.';
  }

  const subjectLabel = profile === 'adult' ? 'la personne' : "l'enfant";

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
    'TACHE : Redige un JSON avec 3 champs (valeurs = strings Markdown) :',
    '',
    '1. "synthese_diagnostic" (100-300 mots) :',
    `   Commence par une phrase d'introduction : "${profile === 'pediatric' ? "{{PATIENT_PRENOM}}, age(e) de X ans et Y mois, est adresse(e) en bilan d'ergotherapie pour..." : "Le/La patient(e) est adresse(e) en ergotherapie pour..."}"`,
    '   Puis : "L\'entretien realise ainsi que les resultats des evaluations mettent en evidence plusieurs elements cles :"',
    '',
    '   Ensuite, organise par DOMAINE avec des tirets "-" :',
    '   - "Sur le plan moteur fin et praxique, ..." (cite les scores MABC, NEPSY etc.)',
    '   - "Sur le plan visuo-spatial et perceptif, ..." (cite les scores DTVP, NEPSY Fleches/Cubes etc.)',
    '   - "Sur le plan graphomoteur, ..." (cite BHK, qualite, vitesse, prise du crayon)',
    '   - "Sur le plan attentionnel, ..." (cite Test des H, Test des cloches etc.)',
    '   - "Sur le plan sensoriel, ..." (si donnees disponibles)',
    '',
    '   REGLES CRITIQUES pour cette section :',
    '   - Cite CHAQUE test/epreuve present dans les scores. N\'en oublie aucun.',
    '   - Cite les scores EXACTEMENT comme fournis : "NS = 7", "ET = -1.2", "performance = +0.6 ET".',
    '   - NE CONVERTIS JAMAIS : si le score est en NS, ne calcule pas de z-score. Si c\'est en ET, ne calcule pas de NS.',
    '   - Si un score est dans la norme, dis-le positivement ("score dans la norme", "competences preservees").',
    '   - Si un score est en norme basse mais fonctionnel, dis-le ("norme basse, fonctionnel au quotidien").',
    '   - N\'utilise les domaines que s\'il y a des tests correspondants. N\'invente pas de tests.',
    '',
    '2. "recommandations" (50-200 mots) :',
    '   Recommandations concretes, organisees par domaine si plusieurs domaines sont concernes.',
    '   Adapte le ton : si tout est normal, recommande des adaptations legeres ou mentionne que l\'accompagnement n\'est pas necessaire.',
    '   Types de recommandations possibles :',
    '   - Adaptations pedagogiques (reduction d\'ecrit, polycopies, temps majore...)',
    '   - Adaptations sensorielles (pauses, casque, environnement calme...)',
    '   - Accompagnement therapeutique si justifie',
    '   - Bilans complementaires si necessaire (orthoptie, psychologie...)',
    '',
    `3. "objectifs_generaux" (50-150 mots) :`,
    `   Si un suivi en ergotherapie est recommande :`,
    `   - Commence par une phrase valorisant ${subjectLabel} ("enfant volontaire", "motivation est une ressource...").`,
    `   - Liste les objectifs concrets du suivi (ameliorer l'ecriture, apprentissage de l'ordinateur, adaptations...).`,
    `   Si le suivi n'est PAS recommande :`,
    `   - Dis-le clairement : "Un accompagnement en ergotherapie n'est pas preconise pour [PRENOM]."`,
    `   - Propose tout de meme des pistes d'adaptations si pertinent.`,
    '',
    'CONSIGNES DE STYLE :',
    '- Paragraphes aeres (double saut de ligne entre chaque domaine).',
    '- Ton professionnel mais accessible aux parents et enseignants.',
    '- Tirets "-" pour les listes.',
    '- N\'invente rien : si une donnee est absente, ne la mentionne pas.',
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
