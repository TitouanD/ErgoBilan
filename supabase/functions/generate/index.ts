import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = parsePositiveInt(Deno.env.get("GEMINI_TIMEOUT_MS"), 110_000);
const MAX_REQUESTS_PER_HOUR = parsePositiveInt(Deno.env.get("AI_MAX_REQUESTS_PER_HOUR"), 15);
const GEMINI_MAX_RETRIES = parsePositiveInt(Deno.env.get("GEMINI_MAX_RETRIES"), 2);
const GEMINI_RETRY_BASE_MS = parsePositiveInt(Deno.env.get("GEMINI_RETRY_BASE_MS"), 2_000);
const GENERATION_REUSE_WINDOW_MINUTES = parsePositiveInt(Deno.env.get("GENERATION_REUSE_WINDOW_MINUTES"), 20);
const GENERATION_LOCK_TTL_SECONDS = parsePositiveInt(Deno.env.get("GENERATION_LOCK_TTL_SECONDS"), 300);
const MAX_PAYLOAD_BYTES = parsePositiveInt(Deno.env.get("GENERATE_MAX_PAYLOAD_BYTES"), 220_000);

const APP_ENV = (Deno.env.get("APP_ENV") || Deno.env.get("ENV") || "").toLowerCase();
const IS_PRODUCTION = APP_ENV === "production" || APP_ENV === "prod" || !!Deno.env.get("DENO_DEPLOYMENT_ID");
const ALLOW_LOOPBACK_ORIGINS =
  (Deno.env.get("AI_ALLOW_LOOPBACK_ORIGINS") || "true").trim().toLowerCase() !== "false";
const AI_DEV_MODE =
  (Deno.env.get("AI_DEV_MODE") || "false").trim().toLowerCase() === "true";
const ALLOWED_ORIGINS = (Deno.env.get("AI_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

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

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};

const isAllowedOrigin = (req: Request): boolean => {
  const origin = (req.headers.get('origin') || '').trim();
  const loopbackOrigin = ALLOW_LOOPBACK_ORIGINS && !!origin && isLoopbackOrigin(origin);
  if (loopbackOrigin) return true;
  if (ALLOWED_ORIGINS.length > 0) return !!origin && ALLOWED_ORIGINS.includes(origin);
  return !IS_PRODUCTION || AI_DEV_MODE;
};

const looksLikeUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const safeFinalize = async (
  sb: ReturnType<typeof createClient> | null,
  genId: string | null,
  userId: string | null,
  success: boolean,
  errorCode: string | null = null,
) => {
  if (!sb || !genId || !userId) return;
  try {
    await sb.rpc('finalize_generation_internal', {
      p_generation_id: genId,
      p_user_id: userId,
      p_success: success,
      p_error_code: errorCode,
    });
  } catch (_e) {
    // no-op
  }
};

const claimGenerationSession = async (
  sb: ReturnType<typeof createClient>,
  genId: string,
  userId: string,
): Promise<boolean> => {
  try {
    const { data, error } = await sb.rpc('claim_generation_session', {
      p_generation_id: genId,
      p_user_id: userId,
      p_lock_ttl_seconds: GENERATION_LOCK_TTL_SECONDS,
    });
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('claim_generation_session') && (msg.includes('does not exist') || msg.includes('not found'))) {
        // Backward compatibility: migration not yet applied.
        return true;
      }
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
};

const isMissingRpcError = (error: { message?: string } | null | undefined, rpcName: string): boolean => {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const name = rpcName.toLowerCase();
  return msg.includes(name) && (msg.includes('does not exist') || msg.includes('not found'));
};

const checkRateLimit = async (
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> => {
  try {
    const { data, error } = await adminClient.rpc('check_rate_limit_for_user', {
      p_user_id: userId,
      p_max_per_hour: MAX_REQUESTS_PER_HOUR,
    });
    if (error) {
      if (!isMissingRpcError(error, 'check_rate_limit_for_user')) return false;
      const { data: legacyData, error: legacyError } = await userClient.rpc('check_rate_limit', {
        p_max_per_hour: MAX_REQUESTS_PER_HOUR,
      });
      return !legacyError && legacyData === true;
    }
    return data === true;
  } catch {
    return false;
  }
};

const consumeCredit = async (
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> => {
  try {
    const { data, error } = await adminClient.rpc('consume_credit_for_user', {
      p_user_id: userId,
    });
    if (error) {
      if (!isMissingRpcError(error, 'consume_credit_for_user')) return null;
      const { data: legacyData, error: legacyError } = await userClient.rpc('consume_credit');
      if (legacyError || !legacyData) return null;
      return String(legacyData);
    }
    if (!data) return null;
    return String(data);
  } catch {
    return null;
  }
};

// ── SYSTEM PROMPTS ──────────

const SECURITY_INSTRUCTION = `REGLE DE SECURITE ABSOLUE : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymises (ex: {{PATIENT_PRENOM}}, {{PATIENT_NOM}}, {{ECOLE}}, {{MEDECIN}}). Ils doivent rester strictement intacts dans le texte genere. Ne genere aucun nouveau placeholder.`;

const PEDIATRIC_SYSTEM = `Tu es un ergotherapeute expert en pediatrie. Tu rediges des rapports d'evaluation initiale en ergotherapie conformes a la convention clinique francaise.

REGLES NON NEGOCIABLES :
1. **Narratif clinique** : Ecris en paragraphes fluides et structures, comme le ferait un professionnel experimente. Chaque phrase est informative. Pas de remplissage. Adapte la longueur a la richesse du contenu clinique.
2. **Ne pathologise PAS** : Si les resultats sont dans la norme ou norme basse, dis-le clairement ("fonctionnel", "preserve", "competences adequates"). Ne transforme pas une norme basse en difficulte.
3. **AUCUN score dans le texte** : Les scores chiffres (NS, ET, z-score, percentile) ne doivent JAMAIS apparaitre dans le rapport. Utilise-les comme connaissance de fond pour formuler ton jugement clinique en termes QUALITATIFS : "fonctionnel", "preserve", "fragile", "deficitaire", "nettement superieur aux attentes", "dans les normes attendues". Les scores figurent dans les annexes du rapport.
4. **AUCUN nom de test** : Ne cite JAMAIS le nom des outils d'evaluation (pas de MABC-2, DTVP, NEPSY, BHK, EVIC, Espargot, etc.). Decris le DOMAINE FONCTIONNEL evalue et les constats cliniques, pas l'instrument utilise.
5. **Structure par domaine** : Dans le diagnostique, organise par domaine fonctionnel. Chaque domaine peut contenir PLUSIEURS PARAGRAPHES si le contenu clinique le justifie (notamment le graphisme). Varie les introductions ("Sur le plan...", "Concernant...", "En ce qui concerne...").
6. **Pas de diagnostic medical** : Tu ne poses JAMAIS de diagnostic (pas de TDA/H, dysgraphie, dyspraxie...) sauf si le praticien l'a explicitement fourni. Tu decris des observations et des constats fonctionnels. N'utilise JAMAIS le mot "troubles" (trop diagnostique) : prefere "difficultes", "fragilites", "points de vigilance".
7. **Langage accessible et clinique** : Le rapport est lu par les parents et l'ecole. Si tu utilises un terme technique, explique-le entre parentheses UNE SEULE FOIS. Ne repete jamais la meme explication.
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Utilise des tirets "-" pour les listes a puces. Aere le texte (double saut de ligne entre paragraphes).
9. **Manifestations fonctionnelles** : Apres chaque constat, decris ses MANIFESTATIONS OBSERVABLES dans la vie quotidienne ou scolaire ("ce qui se manifeste par des sauts de ligne lors de la copie", "engendrant une fatigue lors des productions ecrites"). INTERDIT : theoriser sur les causes neurologiques ou developpementales. AUTORISE : decrire l'impact fonctionnel observe ou rapporte.
10. **Pas de methodologie** : Ne mentionne JAMAIS de modele theorique (PPH, CIF, MCRO...) ni de protocole d'evaluation dans le rapport. Le rapport est centre sur l'enfant.
11. **Orthographe francaise** : Ecris en francais correct avec accents obligatoires. Ne rends jamais un texte sans accents.
12. **Reformulation des observations brutes** : Les observations par epreuve peuvent contenir des notes telegraphiques. Integre-les en les reformulant en phrases cliniques completes. Ne reproduis jamais le style brut.
13. **Ton professionnel** : Utilise "je" pour les propositions de suivi et recommandations ("je propose", "je preconise"). Le reste du rapport est en troisieme personne factuelle.

EXEMPLES DE BON STYLE :
- "{{PATIENT_PRENOM}} dispose d'une motricite fine fonctionnelle des deux mains. La coordination bi-manuelle est egalement preservee."
- "La coordination visuo-motrice s'avere difficile, notamment en raison d'un manque d'efficacite dans le balayage visuel."
- "Bien que l'ecrit reste fluide et fonctionnel, il exige un effort physique et cognitif couteux, limitant l'endurance sur le long terme."
- "Un accompagnement en ergotherapie n'est pas preconise pour {{PATIENT_PRENOM}}."
`;

const ADULT_SYSTEM = `Tu es un ergotherapeute expert en readaptation adulte et maintien a domicile. Tu rediges des rapports d'evaluation en ergotherapie conformes a la convention clinique francaise.

REGLES NON NEGOCIABLES :
1. **Narratif clinique** : Ecris en paragraphes fluides. Adapte la longueur au contenu. Pas de remplissage.
2. **Ne pathologise PAS** : Si les resultats sont dans la norme, dis-le clairement.
3. **AUCUN score dans le texte** : Les scores chiffres ne doivent JAMAIS apparaitre. Utilise-les comme connaissance de fond pour formuler le jugement clinique en termes qualitatifs. Les scores figurent dans les annexes.
4. **AUCUN nom de test** : Ne cite JAMAIS le nom des outils d'evaluation. Decris le domaine evalue et les constats.
5. **Structure par domaine** : Organise le diagnostique par domaine fonctionnel. Chaque domaine peut contenir plusieurs paragraphes.
6. **Pas de diagnostic medical** : Decris des constats fonctionnels, pas de diagnostics. N'utilise JAMAIS le mot "troubles" (trop diagnostique) : prefere "difficultes", "fragilites", "points de vigilance".
7. **Approche fonctionnelle** : Centre l'analyse sur les habitudes de vie (soins, travail, loisirs). Ton respectueux et collaboratif.
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Tirets "-" pour les listes.
9. **Manifestations fonctionnelles** : Decris l'impact fonctionnel observe apres chaque constat. Pas de theories causales.
10. **Pas de methodologie** : Ne mentionne JAMAIS de modele theorique dans le rapport.
11. **Orthographe francaise** : Accents obligatoires.
12. **Reformulation des observations brutes** : Reformule les notes telegraphiques en phrases cliniques completes.
13. **Ton professionnel** : Utilise "je" pour les propositions de suivi et recommandations.`;

// ── JSON Schemas for Gemini responseSchema constraint ──────────────────────

const BIO_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    mandat_referencement: { type: 'STRING' as const, description: 'Qui adresse et pourquoi, 2-4 phrases factuelles (30-80 mots). Nomme le medecin via {{MEDECIN}}. Markdown.' },
    mandat_evaluation: { type: 'STRING' as const, description: 'Difficultes concretes avec liens cause-consequence, en plusieurs paragraphes courts. Inclut la voix du patient si disponible (80-180 mots). Markdown.' },
    profil_occupationnel: { type: 'STRING' as const, description: 'Profil par themes : scolarite actuelle, suivi therapeutique, autonomie, loisirs, comportement en classe, profil emotionnel. Un paragraphe par theme (150-300 mots). Markdown.' },
  },
  required: ['mandat_referencement', 'mandat_evaluation', 'profil_occupationnel'],
};

const DIAG_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    synthese_diagnostic: { type: 'STRING' as const, description: 'Diagnostique clinique narratif par domaine fonctionnel. AUCUN score ni nom de test. Descriptions qualitatives avec manifestations fonctionnelles. Paragraphe de conclusion obligatoire (200-500 mots). Markdown.' },
    projet_accompagnement: { type: 'STRING' as const, description: 'Projet d\'accompagnement : phrase valorisante, modalite de suivi, 1-3 axes de travail en tirets, phrase de reevaluation (40-120 mots). Markdown.' },
    recommandations: { type: 'STRING' as const, description: 'En-tete contextualise puis 3-4 tirets concrets et actionnables (50-120 mots). Markdown.' },
    objectifs_generaux: { type: 'STRING' as const, description: 'Phrase valorisante, modalite de suivi, 1-3 objectifs en tirets, phrase de reevaluation (40-120 mots). Markdown.' },
    reformulated_observations: {
      type: 'ARRAY' as const,
      description: 'Pour chaque epreuve ayant une observation non vide, retourne une reformulation clinique complete.',
      items: {
        type: 'OBJECT' as const,
        properties: {
          subtestId: { type: 'STRING' as const, description: 'Valeur exacte du champ subtestId fourni dans les resultats.' },
          text: { type: 'STRING' as const, description: 'Observation reformulee en une phrase clinique complete et formelle (15-50 mots).' },
        },
        required: ['subtestId', 'text'],
      },
    },
  },
  required: ['synthese_diagnostic', 'projet_accompagnement', 'recommandations', 'objectifs_generaux', 'reformulated_observations'],
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
    '   Qui adresse le patient et pourquoi, de maniere factuelle.',
    '   OBLIGATOIRE : Si {{MEDECIN}} est present dans les donnees, nomme-le EXPLICITEMENT dans la phrase d\'ouverture.',
    '   ATTENTION : {{MEDECIN}} peut DEJA contenir le titre "Dr". Ne rajoute JAMAIS "Dr" devant ce placeholder. Ecris directement "a la demande de {{MEDECIN}}" ou "sur referencement de {{MEDECIN}}".',
    '   Si la specialite du medecin est disponible dans les donnees (ex: generaliste, pediatre, neurologue), mentionne-la apres le nom : "{{MEDECIN}}, medecin generaliste".',
    '   Si {{MEDECIN}} est absent des donnees, ne pas inventer de nom.',
    '   EXEMPLES DE STYLE :',
    '   - "{{PATIENT_PRENOM}} est recu(e) en consultation d\'ergotherapie a la demande de {{MEDECIN}}, medecin generaliste, afin d\'evaluer Y."',
    '   - "{{PATIENT_PRENOM}} est recu(e) sur referencement de {{MEDECIN}}, pediatre, pour bilanter la motricite globale et fine."',
    '   Si la famille a exprime des priorites/objectifs, mentionne-les en une phrase.',
    '',
    '2. "mandat_evaluation" (80-180 mots) :',
    '   Decris les DIFFICULTES CONCRETES qui motivent le bilan, en PLUSIEURS PARAGRAPHES COURTS (un paragraphe par theme).',
    '   STRUCTURE OBLIGATOIRE :',
    '   - Commence par une phrase de RESUME introduisant le theme principal des difficultes : "{{PATIENT_PRENOM}} rapporte des difficultes scolaires liees a..."',
    '   - Developpe ensuite chaque difficulte avec des LIENS CAUSE-CONSEQUENCE : "Elle se depeche pour ecrire, mais cela nuit a la lisibilite et augmente les douleurs."',
    '   - Chaque difficulte doit etre ATTRIBUEE a sa source : "Les parents rapportent que...", "{{PATIENT_PRENOM}} dit avoir...", "L\'enseignant signale que...", "Le conseil de classe demande..."',
    '   - Si {{PATIENT_PRENOM}} a exprime ses PROPRES SOUHAITS ou objectifs (distincts de ceux des parents/ecole), les inclure en DERNIER PARAGRAPHE : "{{PATIENT_PRENOM}} souhaiterait egalement..."',
    '   NE PAS interpreter ni theoriser (pas de "ecriture phonetique pour compenser ses doutes orthographiques").',
    '   INTERDIT : protocole, outils, modeles theoriques, objectifs du bilan.',
    '   NE REPETE PAS les informations deja dans le mandat de referencement.',
    '',
    '3. "profil_occupationnel" (150-300 mots) :',
    '   Synthese du profil en PARAGRAPHES THEMATIQUES, un par theme. Ordre OBLIGATOIRE :',
    '   a) SCOLARITE ACTUELLE : etablissement, niveau/filiere precise, amenagements en place avec leur CONTENU (pas juste "PAP" mais "PAP mentionnant un travail allege et du temps supplementaire").',
    '   b) SUIVI THERAPEUTIQUE : prises en charge passees et en cours, avec dates si disponibles et motifs.',
    '   c) AUTONOMIE / VIE QUOTIDIENNE : autonomie dans les actes de la vie courante, difficultes spatiales ou autres mentionnees.',
    '   d) LOISIRS : activites extrascolaires, centres d\'interet, hobbies.',
    '   e) COMPORTEMENT EN CLASSE : attention, investissement, participation (si mentionne dans les donnees).',
    '   f) PROFIL SOCIAL ET EMOTIONNEL : relations avec les pairs, sensibilite, confiance en soi.',
    '   REGLES :',
    '   - Commence TOUJOURS par la situation scolaire actuelle, PAS par l\'historique developpemental.',
    '   - L\'historique developpemental precoce (age de marche, elocution...) ne doit etre mentionne QUE s\'il est directement pertinent pour la problematique actuelle.',
    '   - Omets les informations medicales sans rapport avec le referencement (somnambulisme, reflux...).',
    '   - Utilise des formulations ATTRIBUEES : "Selon les parents...", "{{PATIENT_PRENOM}} mentionne...".',
    '   - Cite les details SPECIFIQUES : dates, noms d\'amenagements, activites precises.',
    '   - N\'invente AUCUN detail absent. Si une rubrique est vide, ne la mentionne pas.',
    '',
    'CONSIGNES DE STYLE :',
    '- Ton clinique mais accessible.',
    '- Paragraphes aeres (double saut de ligne).',
    '- Tirets "-" pour les listes.',
    '- Orthographe francaise correcte avec accents obligatoires.',
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
  const childContext = String(payload.childContext || '');
  const profilContext = JSON.stringify(payload.profilContext || 'Non disponible');
  const safeObservations = String(payload.safeObservations || 'RAS');
  const scoresEvidence = JSON.stringify(payload.scoresEvidence || [], null, 2);
  const synthesis = (payload.synthesis || {}) as Record<string, unknown>;
  const diagnosticInput = String(synthesis.diagnosticInput || '').trim();
  const projectInput = String(synthesis.projectInput || '').trim();
  const recommendationsInput = String(synthesis.recommendationsInput || '').trim();

  // Directive diagnostique conditionnelle
  let diagnosticDirective: string;
  if (diagnosticInput.length > 5) {
    diagnosticDirective = [
      `Le praticien a pose le constat suivant : "${diagnosticInput}".`,
      'Justifie ce constat par les observations fonctionnelles fournies.',
      'Ne contredis PAS ce constat. Si certaines preuves sont faibles, mentionne-le avec nuance.',
      'Reste FACTUEL. Ne dramatise pas le diagnostic. Utilise le vocabulaire clinique ergo :',
      '"presente des difficultes de coordination bimanuelle" et NON "le diagnostic de X s\'illustre de maniere flagrante".',
      'Si le constat mentionne plusieurs diagnostics, traite chacun dans le domaine fonctionnel correspondant.',
    ].join(' ');
  } else {
    diagnosticDirective = [
      'Aucun constat n\'a ete pose par le praticien.',
      'Deduis une synthese PRUDENTE a partir des observations et resultats.',
      'INTERDIT : Ne pose AUCUN diagnostic medical (TDA/H, dysgraphie, dyspraxie, trouble visuo-spatial, etc.). N\'utilise JAMAIS le mot "troubles" : prefere "difficultes", "fragilites".',
      'Tu decris des CONSTATS FONCTIONNELS ("presente des fragilites en motricite fine", "l\'ecriture est fonctionnelle") et NON des diagnostics.',
      'Si les performances sont dans la norme, dis clairement que c\'est fonctionnel/preserve.',
      'Si les performances sont en norme basse, parle de "fragilites" sans pathologiser.',
      'Si tu n\'es pas sur, privilegie la prudence et suggere un bilan complementaire.',
    ].join(' ');
  }

  // Directive projet d'accompagnement conditionnelle
  let projectDirective: string;
  if (projectInput.length > 5) {
    projectDirective = `Le praticien a defini le projet suivant : "${projectInput}". Developpe ce projet en tirets concrets (axes de travail, suivi propose, collaboration avec l'entourage).`;
  } else {
    projectDirective = 'Formule un projet d\'accompagnement coherent avec le diagnostique. Si un suivi est justifie, liste les axes d\'intervention (ex: graphomotricite, autonomie, adaptations scolaires). Si aucun suivi n\'est preconise, indique-le clairement.';
  }

  // Directive recommandations conditionnelle
  let recommendationsDirective: string;
  if (recommendationsInput.length > 5) {
    recommendationsDirective = `Le praticien propose les preconisations suivantes : "${recommendationsInput}". Integre ces elements et complete si pertinent.`;
  } else {
    recommendationsDirective = 'Formule des preconisations concretes et proportionnees aux resultats. Chaque preconisation doit etre directement actionnable.';
  }

  const subjectLabel = profile === 'adult' ? 'la personne' : "l'enfant";

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    `PROFIL OCCUPATIONNEL DEJA ETABLI :\n${profilContext}`,
    '',
    `OBSERVATIONS CLINIQUES :`,
    `⚠️ Les observations par epreuve ci-dessous peuvent contenir des notes prises rapidement en style telegraphique ou abrege. Dans la synthese ET dans les reformulations, reformule-les systematiquement en phrases cliniques completes et formelles.`,
    `${safeObservations}`,
    '',
    `RESULTATS DES TESTS (scores standardises) :\n${scoresEvidence}`,
    '',
    `DIRECTIVE DIAGNOSTIQUE :\n${diagnosticDirective}`,
    '',
    `DIRECTIVE PROJET D'ACCOMPAGNEMENT :\n${projectDirective}`,
    '',
    `DIRECTIVE PRECONISATIONS :\n${recommendationsDirective}`,
    '',
    'RAPPEL ABSOLU : Tu ne dois JAMAIS citer de score chiffre (NS, ET, z-score, percentile) ni nommer un test/epreuve (MABC-2, DTVP, NEPSY, BHK, EVIC, Espargot, etc.) dans le texte. Les scores et noms de tests te servent de CONNAISSANCE DE FOND pour formuler tes jugements cliniques en termes QUALITATIFS uniquement. N\'utilise JAMAIS le mot "troubles" (trop diagnostique) : prefere "difficultes", "fragilites", "points de vigilance".',
    '',
    'TACHE : Redige un JSON avec 5 champs :',
    '',
    '1. "synthese_diagnostic" (200-500 mots) :',
    '   INTRODUCTION :',
    '   Commence par une phrase naturelle integrant le contexte scolaire/professionnel actuel du profil occupationnel :',
    '   "{{PATIENT_PRENOM}}, [contexte scolaire actuel extrait du profil, ex: scolarise(e) en classe de Premiere Litteraire], est adresse(e) en bilan d\'ergotherapie pour [motif principal du referencement]."',
    '   N\'utilise JAMAIS de parentheses pour inserer des informations demographiques. N\'inclus PAS l\'age ni le genre dans l\'introduction.',
    '   Puis : "L\'entretien realise ainsi que les resultats des evaluations mettent en evidence plusieurs elements cles :"',
    '',
    '   CORPS — APPROCHE NARRATIVE PAR DOMAINE :',
    '   Organise par domaine fonctionnel avec des tirets "-". Chaque domaine peut contenir PLUSIEURS PARAGRAPHES si le contenu le justifie.',
    '   Pour chaque domaine :',
    '   1. Commence par les OBSERVATIONS FONCTIONNELLES : ce qui est preserve, ce qui est fragile, ce qui est deficitaire.',
    '   2. Decris les MANIFESTATIONS CONCRETES observees ou rapportees : "ce qui se manifeste par des sauts de ligne lors de la copie", "engendrant des confusions de lettres".',
    '   3. NE CITE AUCUN SCORE NI NOM DE TEST.',
    '',
    '   DOMAINES POSSIBLES (n\'utilise que ceux pour lesquels tu as des donnees) :',
    '   - "Sur le plan de la motricite fine et de la coordination bi-manuelle" : motricite fine, coordination bimanuelle, coordination oculo-manuelle. Decris ce qui est fonctionnel et ce qui est fragile.',
    '   - "Concernant les capacites visuo-spatiales" : perception, construction, orientation spatiale, coordination visuo-motrice, balayage visuel. Traduis en impact fonctionnel : sauts de ligne, repetitions, dependance au modele visuel.',
    '   - "Concernant l\'ecriture manuscrite" : Section la plus DETAILLEE. Developpe en PLUSIEURS PARAGRAPHES :',
    '     (a) Vitesse et qualite generale : ce qui est dans les normes, comment la qualite evolue avec l\'acceleration.',
    '     (b) Comportements associes observes : hesitations orthographiques, dependance visuelle au modele, rapport entre la pensee et le flux scriptural, effort cognitif soutenu generant de la fatigue.',
    '     (c) POSTURE D\'ECRITURE (paragraphe dedie) : lateralite, position du poignet et de la main (ex: flexion, position en crochet), mode de progression sur la ligne (rotation d\'epaule, compensation), type de prise de crayon avec particularites (ex: pouce en hyperextension), mobilite des doigts.',
    '     (d) DOULEURS : localisation precise (doigts, main, poignet, epaule...), cotation si disponible (ex: "que {{PATIENT_PRENOM}} evalue a X/10 sur l\'echelle de la douleur").',
    '     (e) CONCLUSION INTEGRATIVE du graphisme : lien entre posture, effort, et endurance ("Bien que l\'ecrit reste fluide et fonctionnel, il exige un effort physique et cognitif couteux, limitant l\'endurance sur le long terme").',
    '   - "Sur le plan attentionnel" : si donnees disponibles.',
    '   - "Sur le plan sensoriel" : si donnees disponibles.',
    '   - "Sur le plan informatique" : si des donnees de frappe/informatique sont disponibles. Decris : comparaison qualitative avec la vitesse manuscrite, posture de frappe, utilisation des doigts, connaissance du clavier, maitrise des logiciels. Conclus sur le role de compensation dans le parcours.',
    '',
    '   PARAGRAPHE DE CONCLUSION (OBLIGATOIRE) :',
    '   Termine par un PARAGRAPHE FINAL (hors tirets, 3-4 phrases) qui :',
    '   1. Synthetise les enjeux fonctionnels principaux de maniere integree (douleurs + difficultes ortho + balayage visuel → fatigue + degradation des productions).',
    '   2. Justifie EXPLICITEMENT la recommandation centrale en la reliant au contexte de vie (ex: filiere scolaire, projet professionnel).',
    '   Ce paragraphe ne cite aucun nouveau score. Il conclut et oriente.',
    '',
    '   REGLES CRITIQUES pour cette section :',
    '   - AUCUN score chiffre (NS, ET, z, percentile). AUCUN nom de test.',
    '   - Integre les details SPECIFIQUES des observations. Ne generalise pas si le fait precis est disponible.',
    '   - Si des performances sont dans la norme, dis-le positivement ("competences preservees", "fonctionnel").',
    '   - Si des performances sont fragiles, decris l\'impact fonctionnel concret.',
    '   - N\'utilise les domaines que s\'il y a des donnees correspondantes.',
    '   - Pas de metaphores. Ton clinique factuel mais accessible.',
    '',
    '2. "projet_accompagnement" (40-120 mots) :',
    `   Si un suivi en ergotherapie est recommande :`,
    `   - Commence par une phrase valorisant ${subjectLabel} ("jeune fille consciencieuse et appliquee", "enfant volontaire et investi(e)").`,
    `   - Precise la MODALITE de suivi : "je propose la mise en place de seances regulieres" OU "je propose la mise en place de seances ponctuelles, en si besoin" (adapte au niveau de necessite du suivi selon le diagnostique).`,
    `   - Liste 1-3 axes de travail en tirets simples et concis.`,
    `   - OBLIGATOIRE : Termine par une phrase de REEVALUATION : "Une reevaluation des competences est preconisee tous les 6 mois, afin d'ajuster les objectifs du suivi en ergotherapie et de s'adapter au plus pres de l'evolution de {{PATIENT_PRENOM}}."`,
    `   Si le suivi n'est PAS recommande :`,
    `   - Dis-le clairement : "Un accompagnement en ergotherapie n'est pas preconise pour {{PATIENT_PRENOM}}."`,
    '',
    '3. "recommandations" (50-120 mots) :',
    '   Commence par un en-tete adapte au contexte : "Adaptations pedagogiques recommandees :" (si contexte scolaire) ou "Adaptations recommandees :" (si autre contexte).',
    '   Puis 3-4 tirets concrets et DIRECTEMENT ACTIONNABLES.',
    '   Chaque recommandation doit pouvoir etre mise en oeuvre immediatement par l\'ecole ou la famille.',
    '   INTERDIT : recommandations vagues ("sensibilisation de l\'equipe"), recommandations materielles trop specifiques (noms de produits) sauf si justifie par les observations.',
    '   Si tout est normal, mentionne que l\'accompagnement n\'est pas necessaire.',
    '   EXEMPLE DE STYLE :',
    '   "Adaptations pedagogiques recommandees :\\n- Utilisation de l\'outil informatique pour l\'ensemble des productions ecrites longues et les evaluations afin de prevenir les douleurs et la fatigue.\\n- Maintien des amenagements de type tiers-temps.\\n- Allegement de la charge de copie par la fourniture de supports de cours imprimes ou numeriques."',
    '',
    `4. "objectifs_generaux" (40-120 mots) :`,
    `   Si un suivi en ergotherapie est recommande :`,
    `   - Commence par une phrase valorisant ${subjectLabel} ("jeune fille consciencieuse et appliquee", "enfant volontaire et investi(e)").`,
    `   - Precise la MODALITE de suivi : "je propose la mise en place de seances regulieres" OU "je propose la mise en place de seances ponctuelles, en si besoin" (adapte au niveau de necessite du suivi selon le diagnostique).`,
    `   - Liste 1-3 objectifs en tirets simples et concis. PAS de categories "court/moyen terme". PAS de timeline.`,
    `   - OBLIGATOIRE : Termine par une phrase de REEVALUATION : "Une reevaluation des competences est preconisee tous les 6 mois, afin d'ajuster les objectifs du suivi en ergotherapie et de s'adapter au plus pres de l'evolution de {{PATIENT_PRENOM}}."`,
    `   Si le suivi n'est PAS recommande :`,
    `   - Dis-le clairement : "Un accompagnement en ergotherapie n'est pas preconise pour {{PATIENT_PRENOM}}."`,
    `   - Propose tout de meme des pistes d'adaptations si pertinent.`,
    '',
    '5. "reformulated_observations" (tableau) :',
    '   Pour chaque epreuve des resultats des tests qui possede un champ "observation" non vide, retourne une version reformulee.',
    '   Format : tableau d\'objets [{ "subtestId": "<valeur exacte du champ subtestId>", "text": "<phrase reformulee>" }]',
    '   REGLES ABSOLUES :',
    '   - Utilise EXACTEMENT la valeur du champ "subtestId" fournie dans les resultats (ne la modifie jamais).',
    '   - Reformule en 1 phrase complete, clinique, formelle (15-50 mots). PAS de style telegraphique.',
    '   - Si l\'observation est deja une phrase complete et clinique, tu peux la conserver telle quelle.',
    '   - Si observation est vide ou null, n\'inclus PAS l\'epreuve dans le tableau.',
    '   EXEMPLES DE REFORMULATION :',
    '   - "prise crayon tendue" → "La prise du crayon est sous-optimale, avec une tension importante des doigts et une flexion excessive du poignet."',
    '   - "bon contact, bavarde bcp" → "L\'enfant etablit un bon contact relationnel, bien qu\'elle tende a engager des echanges verbaux frequents en parallele des epreuves."',
    '   - "fatigue fin seance, agitation" → "Une fatigue notable est observee en fin de seance, entrainant une augmentation de l\'agitation motrice et une baisse de la concentration."',
    '',
    'CONSIGNES DE STYLE :',
    '- Paragraphes aeres (double saut de ligne entre chaque domaine).',
    '- Ton clinique factuel, accessible aux parents et enseignants.',
    '- Tirets "-" pour les listes.',
    '- Orthographe francaise correcte avec accents obligatoires.',
    '- PAS de metaphores, PAS de guillemets dramatisants, PAS de repetition d\'explications de termes.',
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
    if (!isAllowedOrigin(req)) {
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let adminSupabase: ReturnType<typeof createClient> | null = null;
  let generationId: string | null = null;
  let userId: string | null = null;
  let currentTask: AITask | null = null;
  let finalized = false;

  try {
    if (!isAllowedOrigin(req)) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN_ORIGIN' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    userId = user.id;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'SERVER_MISCONFIGURED' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    adminSupabase = createClient(Deno.env.get('SUPABASE_URL')!, SUPABASE_SERVICE_ROLE_KEY);

    const withinLimit = await checkRateLimit(supabase, adminSupabase!, userId);
    if (!withinLimit) {
      return new Response(JSON.stringify({ error: 'RATE_LIMITED', message: 'Trop de requetes. Reessayez plus tard.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const task = String(body.task || '') as AITask;
    currentTask = task;
    const payload = (body.payload || {}) as Record<string, unknown>;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    const providedGenId = typeof body.generation_id === 'string' ? body.generation_id : null;

    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['report_bio', 'report_diagnostic'].includes(task)) {
      return new Response(JSON.stringify({ error: 'INVALID_TASK' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (providedGenId && !looksLikeUuid(providedGenId)) {
      return new Response(JSON.stringify({ error: 'INVALID_GENERATION_SESSION' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (task === 'report_bio' && providedGenId) {
      return new Response(JSON.stringify({ error: 'INVALID_GENERATION_SESSION' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (task === 'report_diagnostic' && !providedGenId) {
      return new Response(JSON.stringify({ error: 'MISSING_GENERATION_SESSION' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (task === 'report_diagnostic') {
      const windowStart = new Date(Date.now() - GENERATION_REUSE_WINDOW_MINUTES * 60 * 1000).toISOString();
      const { data: validGen } = await adminSupabase!
        .from('generation_log')
        .select('id, error_code')
        .eq('id', providedGenId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gte('created_at', windowStart)
        .single();

      if (!validGen) {
        return new Response(JSON.stringify({ error: 'INVALID_GENERATION_SESSION' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const claimed = await claimGenerationSession(adminSupabase!, providedGenId, userId);
      if (!claimed) {
        return new Response(JSON.stringify({ error: 'GENERATION_SESSION_BUSY' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      generationId = providedGenId;
    } else {
      const genId = await consumeCredit(supabase, adminSupabase!, userId);
      if (!genId) {
        return new Response(JSON.stringify({ error: 'CREDIT_INSUFFICIENT', message: 'Credits insuffisants.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      generationId = genId;
    }

    if (!GEMINI_API_KEY) {
      await safeFinalize(adminSupabase, generationId, userId, false, 'AI_NOT_CONFIGURED');
      finalized = true;
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
        geminiResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
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
          await safeFinalize(adminSupabase, generationId, userId, false, 'GEMINI_TIMEOUT');
          finalized = true;
          return new Response(JSON.stringify({ error: 'Gemini request timed out', retryable: true }), {
            status: 504,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (attempt === GEMINI_MAX_RETRIES) {
          await safeFinalize(adminSupabase, generationId, userId, false, 'GEMINI_EXCEPTION');
          finalized = true;
          throw err;
        }
        lastGeminiStatus = 0;
        geminiResponse = null;
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      const retryable = isRetryableStatus(lastGeminiStatus);
      await safeFinalize(adminSupabase, generationId, userId, false, retryable ? 'GEMINI_RETRYABLE_ERROR' : 'GEMINI_ERROR');
      finalized = true;
      return new Response(JSON.stringify({ error: 'AI generation failed', details: lastGeminiStatus || 0, retryable }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiResponse.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    if (task === 'report_diagnostic') {
      await safeFinalize(adminSupabase, generationId, userId, true);
      finalized = true;
    }

    return new Response(JSON.stringify({ text, generationId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    await captureEdgeException(_err, {
      functionName: 'generate',
      tags: { task: currentTask || 'unknown' },
      extra: { userId, generationId },
    });
    if (!finalized && (currentTask === 'report_bio' || currentTask === 'report_diagnostic')) {
      await safeFinalize(adminSupabase, generationId, userId, false, 'INTERNAL_ERROR');
      finalized = true;
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
