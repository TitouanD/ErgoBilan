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
const GEMINI_TIMEOUT_MS = parsePositiveInt(Deno.env.get("GEMINI_TIMEOUT_MS"), 50_000);
const MAX_REQUESTS_PER_HOUR = parsePositiveInt(Deno.env.get("AI_MAX_REQUESTS_PER_HOUR"), 15);
const GEMINI_MAX_RETRIES = parsePositiveInt(Deno.env.get("GEMINI_MAX_RETRIES"), 1);
const GEMINI_RETRY_BASE_MS = parsePositiveInt(Deno.env.get("GEMINI_RETRY_BASE_MS"), 2_000);
const GENERATION_REUSE_WINDOW_MINUTES = parsePositiveInt(Deno.env.get("GENERATION_REUSE_WINDOW_MINUTES"), 20);
const GENERATION_LOCK_TTL_SECONDS = parsePositiveInt(Deno.env.get("GENERATION_LOCK_TTL_SECONDS"), 120);
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

type AITask = 'report_bio' | 'report_diagnostic' | 'extract_style_feedback' | 'report_reevaluation';

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
1. **Narratif clinique** : Ecris en phrases courtes et directes, comme le ferait un professionnel experimente. Chaque phrase est informative. Pas de remplissage. Evite les phrases a multiples subordonnees. Adapte la longueur a la richesse du contenu clinique.
2. **Ne pathologise PAS et preserve la nuance exacte** : Si les resultats sont dans la norme ou norme basse, dis-le clairement ("fonctionnel", "preserve", "competences adequates"). Ne transforme pas une norme basse en difficulte. Si une donnee est neutre ou positive dans les sources (ex: "organisation satisfaisante"), ne la reformule JAMAIS de maniere negative (ex: "pour tenter de structurer"). Preserve le SENS EXACT des donnees.
3. **AUCUN score dans le texte** : Les scores chiffres (NS, ET, z-score, percentile) ne doivent JAMAIS apparaitre dans le rapport. Utilise-les comme connaissance de fond pour formuler ton jugement clinique en termes QUALITATIFS : "fonctionnel", "preserve", "fragile", "deficitaire", "nettement superieur aux attentes", "dans les normes attendues". Les scores figurent dans les annexes du rapport.
4. **AUCUN nom de test** : Ne cite JAMAIS le nom des outils d'evaluation (pas de MABC-2, DTVP, NEPSY, BHK, EVIC, Espargot, etc.). Decris le DOMAINE FONCTIONNEL evalue et les constats cliniques, pas l'instrument utilise.
5. **Structure par domaine** : Dans le diagnostique, organise par domaine fonctionnel. Chaque domaine peut contenir PLUSIEURS PARAGRAPHES si le contenu clinique le justifie (notamment le graphisme). Varie les introductions ("Sur le plan...", "Concernant...", "En ce qui concerne...").
6. **Pas de diagnostic medical** : Tu ne poses JAMAIS de diagnostic (pas de TDA/H, dysgraphie, dyspraxie...) sauf si le praticien l'a explicitement fourni. Tu decris des observations et des constats fonctionnels. N'utilise JAMAIS le mot "troubles" (trop diagnostique) : prefere "difficultes", "fragilites", "points de vigilance".
7. **Langage accessible et simple** : Le rapport est lu par les parents et l'ecole. Privilegie les descriptions fonctionnelles aux termes anatomiques. Prefere "prise de stylo crispee" a "prise tridigitale avec hyperflexion". Prefere "exploration visuelle lente" a "defaut de saccade oculomotrice". Si un terme technique n'a pas d'equivalent simple, explique-le entre parentheses UNE SEULE FOIS. Quand tu mentionnes un outil de compensation (ex: compensation informatique), precise entre parentheses le terme concret : "compensation informatique (ordinateur)".
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Utilise des tirets "-" pour les listes a puces. Aere le texte (double saut de ligne entre paragraphes).
9. **Manifestations fonctionnelles** : Apres chaque constat, decris ses MANIFESTATIONS OBSERVABLES dans la vie quotidienne ou scolaire ("ce qui se manifeste par des sauts de ligne lors de la copie", "engendrant une fatigue lors des productions ecrites"). INTERDIT : theoriser sur les causes neurologiques ou developpementales. AUTORISE : decrire l'impact fonctionnel observe ou rapporte.
10. **Pas de methodologie** : Ne mentionne JAMAIS de modele theorique (PPH, CIF, MCRO...) ni de protocole d'evaluation dans le rapport. Le rapport est centre sur l'enfant.
11. **Orthographe francaise** : Ecris en francais correct avec accents obligatoires. Ne rends jamais un texte sans accents.
12. **Reformulation des observations brutes** : Les observations par epreuve peuvent contenir des notes telegraphiques. Integre-les en les reformulant en phrases cliniques completes. Ne reproduis jamais le style brut.
13. **Ton professionnel** : Utilise "je" pour les propositions de suivi et recommandations ("je propose", "je preconise"). Le reste du rapport est en troisieme personne factuelle.
14. **INTERDICTION D'INVENTER** : Si un detail n'est pas explicitement present dans les donnees fournies, ne le mentionne pas. Ne deduis JAMAIS d'informations absentes. N'ajoute pas de details plausibles mais non fournis (horaires, qualite du sommeil, emotions non mentionnees, details sur l'origine des demarches). En cas de doute, omets.
15. **Pas de softeners inutiles** : N'utilise pas "globalement", "relativement", "plutot" quand le resultat est clairement dans la norme. Dis simplement "preserve" ou "fonctionnel". Evite "vivement preconise" : prefere "est preconise".
16. **Preserve les details specifiques** : Si les donnees contiennent des expressions du patient (ex: "dechicte" au lieu de couper), des preferences precises (matieres appreciees et non appreciees), des details colores ou des nuances relationnelles, integre-les tels quels. Ne generalise pas quand le detail specifique est plus informatif.
17. **FORMAT DIAGNOSTIQUE (tirets obligatoires)** : Dans la synthese diagnostique, les domaines fonctionnels sont TOUJOURS introduits par un tiret, le titre etant integre au tiret lui-meme : "- Sur le plan de... :\n[corps en prose]". INTERDICTION ABSOLUE de headers Markdown (##, ###), de texte en gras isole (**Titre** suivi d'un paragraphe separe), ou de ligne de titre sans tiret. EXEMPLE INTERDIT : "**Sur le plan de la motricite fine :**" puis paragraphe. EXEMPLE CORRECT : "- Sur le plan de la motricite fine :\nLes competences sont...".

EXEMPLES DE BON STYLE :
- "Les competences de {{PATIENT_PRENOM}} en motricite fine et coordination bi-manuelle sont preservees et fonctionnelles."
- "L'exploration visuelle est lente et peu efficace. Elle est davantage difficile lorsqu'il y a beaucoup d'informations visuelles."
- "{{PATIENT_PRENOM}} rapporte systematiquement une douleur durant l'ecriture, evaluee entre 1/10 et 6/10 selon les epreuves."
- "Les relations avec ses camarades se passent bien. Avec ses amies proches, cela peut etre plus complexe."
- "Un accompagnement en ergotherapie n'est pas preconise pour {{PATIENT_PRENOM}}."

EXEMPLES A EVITER :
- EVITE : "malgre des fragilites de concentration notees" → PREFERE : "a parfois des difficultes a se concentrer"
- EVITE : "une mise sous tension emotionnelle pour l'adolescente" → PREFERE : "la mise au travail est plus difficile"
- EVITE : "les relations avec ses pairs sont parfois decrites comme complexes" → PREFERE : "les relations se passent bien, meme si cela peut etre plus complexe avec certaines amies proches"
- EVITE : "prise tridigitale avec hyperflexion du pouce" → PREFERE : "prise de stylo adequate, mais crispee et avec une forte pression"
- EVITE : "pour tenter de structurer ses documents" → PREFERE : "son organisation est satisfaisante" (si c'est ce que disent les donnees)
`;

const ADULT_SYSTEM = `Tu es un ergotherapeute expert en readaptation adulte et maintien a domicile. Tu rediges des rapports d'evaluation en ergotherapie conformes a la convention clinique francaise.

REGLES NON NEGOCIABLES :
1. **Narratif clinique** : Ecris en phrases courtes et directes. Adapte la longueur au contenu. Pas de remplissage. Evite les phrases a multiples subordonnees.
2. **Ne pathologise PAS et preserve la nuance exacte** : Si les resultats sont dans la norme, dis-le clairement. Si une donnee est neutre ou positive, ne la reformule JAMAIS negativement. Preserve le sens exact des donnees sources.
3. **AUCUN score dans le texte** : Les scores chiffres ne doivent JAMAIS apparaitre. Utilise-les comme connaissance de fond pour formuler le jugement clinique en termes qualitatifs. Les scores figurent dans les annexes.
4. **AUCUN nom de test** : Ne cite JAMAIS le nom des outils d'evaluation. Decris le domaine evalue et les constats.
5. **Structure par domaine** : Organise le diagnostique par domaine fonctionnel. Chaque domaine peut contenir plusieurs paragraphes.
6. **Pas de diagnostic medical** : Decris des constats fonctionnels, pas de diagnostics. N'utilise JAMAIS le mot "troubles" (trop diagnostique) : prefere "difficultes", "fragilites", "points de vigilance".
7. **Approche fonctionnelle et langage simple** : Centre l'analyse sur les habitudes de vie (soins, travail, loisirs). Ton respectueux et collaboratif. Privilegie les descriptions fonctionnelles aux termes anatomiques. Quand tu mentionnes un outil de compensation, precise entre parentheses le terme concret.
8. **Format** : JSON valide strict. Valeurs = strings Markdown. Tirets "-" pour les listes.
9. **Manifestations fonctionnelles** : Decris l'impact fonctionnel observe apres chaque constat. Pas de theories causales.
10. **Pas de methodologie** : Ne mentionne JAMAIS de modele theorique dans le rapport.
11. **Orthographe francaise** : Accents obligatoires.
12. **Reformulation des observations brutes** : Reformule les notes telegraphiques en phrases cliniques completes.
13. **Ton professionnel** : Utilise "je" pour les propositions de suivi et recommandations.
14. **INTERDICTION D'INVENTER** : Si un detail n'est pas explicitement dans les donnees, ne le mentionne pas. En cas de doute, omets.
15. **Pas de softeners inutiles** : Evite "globalement", "relativement", "plutot" quand le resultat est dans la norme. Dis simplement "preserve" ou "fonctionnel".
16. **Preserve les details specifiques** : Integre les expressions du patient, les nuances relationnelles et les details colores tels quels. Ne generalise pas.`;

// ── JSON Schemas for Gemini responseSchema constraint ──────────────────────

const BIO_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    mandat_referencement: { type: 'STRING' as const, description: 'Ouverture sur le medecin prescripteur (obligatoire si present). Puis famille + 1-2 difficultes principales (pas une liste exhaustive). Puis priorites famille. Structure en 3 temps (60-130 mots). Markdown.' },
    mandat_evaluation: { type: 'STRING' as const, description: 'Objectif du bilan uniquement (quoi evaluer). Commence OBLIGATOIREMENT par "observer et d\'evaluer". Structure : capacites graphomotrices + facteurs sous-jacents (motricite fine, visuo-perceptives, exploration visuelle, bi-manuelle, oculo-manuelle) + phrase motricite globale si dans le perimetre + impact fonctionnel. 1-3 phrases (20-70 mots). Markdown.' },
    profil_occupationnel: { type: 'STRING' as const, description: 'Premiere phrase OBLIGATOIRE : age + genre + situation scolaire ("[Prenom] est un/une jeune [garcon/fille] de X ans, scolarise(e) en [niveau] au [type] [nom] a [ville]"). Profil par themes : scolarite, suivi therapeutique (concis), autonomie, loisirs, profil social/emotionnel. Si attention fonctionnelle : une phrase breve EN FIN de profil seulement. 150-300 mots. Markdown.' },
  },
  required: ['mandat_referencement', 'mandat_evaluation', 'profil_occupationnel'],
};

const DIAG_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    synthese_diagnostic: { type: 'STRING' as const, description: 'Diagnostique clinique narratif par domaine fonctionnel. AUCUN score ni nom de test. FORMAT OBLIGATOIRE : domaines introduits par tiret integrant le titre ("- Sur le plan de... :\n[prose]"), JAMAIS de headers gras isoles. Intro = motif de referencement uniquement (pas les elements decouverts pendant bilan). Conclusion obligatoire. 200-500 mots. Markdown.' },
    projet_accompagnement: { type: 'STRING' as const, description: 'Projet d\'accompagnement : phrase valorisante, modalite de suivi, 1-4 axes de travail en tirets couvrant CHAQUE domaine fonctionnel deficitaire de la synthese diagnostique, phrase de reevaluation (40-140 mots). Markdown.' },
    recommandations: { type: 'STRING' as const, description: 'En-tete contextualise puis 3-4 tirets concrets et actionnables (50-120 mots). Markdown.' },
    objectifs_generaux: { type: 'STRING' as const, description: 'Phrase valorisante, modalite de suivi, 1-4 objectifs en tirets couvrant CHAQUE domaine fonctionnel deficitaire de la synthese diagnostique, phrase de reevaluation (40-140 mots). Markdown.' },
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

  const styleBlock = String(payload.styleDirectives || '').trim();

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    ...(styleBlock ? [
      'PREFERENCES DE STYLE DU PRATICIEN (issues de ses corrections precedentes) :',
      styleBlock,
      '',
    ] : []),
    `CONTEXTE ${subjectLabel} : ${context}`,
    '',,
    `DONNEES BRUTES (questionnaire/anamnese) :\n${questionnaire}`,
    '',
    'TACHE : Redige un JSON avec 3 champs (valeurs = strings Markdown) en respectant STRICTEMENT ce format :',
    '',
    '1. "mandat_referencement" (3-5 phrases, 60-130 mots) :',
    '   STRUCTURE EN 3 TEMPS OBLIGATOIRE :',
    '   TEMPS 1 — PRESCRIPTEUR (phrase d\'ouverture) :',
    '   Si {{MEDECIN}} est present dans les donnees : le medecin doit etre LA PREMIERE PERSONNE NOMMEE dans la premiere phrase. La famille n\'est mentionnee qu\'ensuite.',
    '   ATTENTION : {{MEDECIN}} peut DEJA contenir le titre "Dr" ou "Docteur". Ne rajoute JAMAIS un second "Dr" devant ce placeholder.',
    '   REGLE GRAMMATICALE OBLIGATOIRE : Utilise l\'article contracte "du" (et non "de") devant {{MEDECIN}} car il commence par un titre : ecris "a la demande du {{MEDECIN}}" ou "sur demande du {{MEDECIN}}". NE JAMAIS ecrire "a la demande de {{MEDECIN}}" (erreur grammaticale frequente a eviter absolument).',
    '   Si la specialite du medecin est disponible dans les donnees (ex: generaliste, pediatre, neurologue), mentionne-la apres le nom : "{{MEDECIN}}, medecin generaliste".',
    '   Si {{MEDECIN}} est absent des donnees, ouvre sur la famille.',
    '   EXEMPLES DE STYLE pour le temps 1 :',
    '   - "{{PATIENT_PRENOM}} est recu(e) en consultation d\'ergotherapie a la demande du {{MEDECIN}}, medecin generaliste, afin de realiser un bilan d\'ergotherapie."',
    '   - "Cette demarche est egalement soutenue par les parents de {{PATIENT_PRENOM}}, suite a des observations de difficultes dans le domaine de [theme principal]."',
    '   TEMPS 2 — DIFFICULTES CONCRETES (1-2 phrases) :',
    '   Decris 1-2 difficultes REPRESENTATIVES et principales (pas une liste exhaustive). Attribue-les a leur source (parents, enseignant, enfant). Les details fins (confusions de lettres specifiques, comportements precis d\'ecriture) seront developpes dans le profil et le diagnostic — ne les anticipe pas ici.',
    '   EXEMPLES : "Ceux-ci rapportent que les productions ecrites de {{PATIENT_PRENOM}} sont difficiles a relire par ses enseignants ainsi que par lui-meme." / "La priorite de la famille est de determiner les adaptations a mettre en place pour la scolarite."',
    '   TEMPS 3 — PRIORITES (1 phrase) :',
    '   Si la famille a exprime des priorites/objectifs, mentionne-les en une phrase simple et directe.',
    '   INTERDIT : Ne mentionne PAS de details sur la chaine de referencement (orthopedie, orthopedagogue, etc.) sauf si EXPLICITEMENT present dans les donnees. Utilise "bilan d\'ergotherapie" et non "bilan initial" ni "evaluation fonctionnelle de ses capacites".',
    '',
    '2. "mandat_evaluation" (20-70 mots, 1-3 phrases) :',
    '   UNIQUE CONTENU : L\'OBJECTIF DU BILAN — quoi evaluer.',
    '   INTERDIT : Ne repete PAS les difficultes (elles sont dans le mandat de referencement). Ne mentionne pas les attentes de la famille. Pas de protocole ni de modele theorique.',
    '   FORMULE OBLIGATOIRE : Commence TOUJOURS par "observer et d\'evaluer" (jamais seulement "evaluer" ou "analyser").',
    '   STRUCTURE EN 1-3 PHRASES :',
    '   Phrase 1 (OBLIGATOIRE) : "L\'objectif de ce bilan en ergotherapie est d\'observer et d\'evaluer les capacites graphomotrices de {{PATIENT_PRENOM}}, ainsi que les facteurs sous-jacents tels que la motricite fine, les capacites visuo-perceptives et d\'exploration visuelle, la coordination bimanuelle et oculo-manuelle."',
    '   Phrase 2 (si motricite globale dans le perimetre du bilan, sinon omets) : "Ce bilan va egalement permettre d\'observer et d\'evaluer les capacites de motricite globale."',
    '   Phrase finale : lien avec l\'impact ("Cette evaluation vise a identifier les freins a [probleme principal] et a analyser leur impact sur [domaine pertinent]." ou "Cela permettra d\'evaluer leur impact sur [domaine pertinent].").',
    '   EXEMPLES DE STYLE :',
    '   - (graphisme seul) "L\'objectif de ce bilan en ergotherapie est d\'observer et d\'evaluer les capacites graphomotrices de {{PATIENT_PRENOM}}, ainsi que les facteurs sous-jacents tels que la motricite fine, les capacites visuo-perceptives et d\'exploration visuelle, la coordination bimanuelle et oculo-manuelle. Cette evaluation vise a identifier les freins a une ecriture fonctionnelle et a analyser leur impact sur ses activites scolaires."',
    '   - (avec motricite globale) "L\'objectif de ce bilan en ergotherapie est d\'observer et d\'evaluer les capacites graphomotrices de {{PATIENT_PRENOM}}, ainsi que les facteurs sous-jacents tels que la motricite fine, les capacites visuo-perceptives et d\'exploration visuelle, la coordination bimanuelle et oculo-manuelle. Ce bilan va egalement permettre d\'observer et d\'evaluer les capacites de motricite globale. Cela permettra d\'evaluer leur impact sur son autonomie quotidienne et ses activites scolaires."',
    '',
    '3. "profil_occupationnel" (150-300 mots) :',
    '   Synthese du profil en PARAGRAPHES THEMATIQUES, un par theme. Ordre OBLIGATOIRE :',
    '   a) SCOLARITE ACTUELLE : La PREMIERE PHRASE du profil doit inclure l\'age et le genre : "[PATIENT_PRENOM] est un/une jeune [garcon/fille/enfant] de X ans, il/elle est actuellement scolarise(e) en [niveau] au [type d\'etablissement] [nom] a [ville]." Format de lieu OBLIGATOIRE : "au [type] [nom] a [ville]" (ex : "au college Mescoat a Landerneau", "au lycee Louis le Grand a Paris") — JAMAIS "au sein de l\'etablissement [nom], [ville]". Si l\'age n\'est pas disponible, ouvre directement par la situation scolaire sans mention d\'age. Mentionne ensuite les amenagements en place avec leur CONTENU (pas juste "PAP" mais "PAP mentionnant un travail allege et du temps supplementaire"). Si les donnees rapportent l\'etat actuel des apprentissages scolaires tel que note par l\'ecole/l\'enseignant (ex: lecture, graphisme, pre-graphisme se passent bien ou au contraire posent difficulte), integre cette information brievement dans CE MEME paragraphe scolaire (ex: "Les apprentissages de la lecture et du graphisme se passent bien.") — ne la deplace pas ailleurs et ne l\'omets pas.',
    '   b) SUIVI THERAPEUTIQUE : prises en charge passees et en cours, avec dates si disponibles et motifs. CONCIS : 1-2 phrases par professionnel maximum. Ne liste pas toutes les dates si elles forment un catalogue. INTERDIT : n\'inclus JAMAIS le nom propre d\'un professionnel suivi (kinesitherapeute, neuropediatre, autre medecin ou reeducateur) autre que le medecin prescripteur {{MEDECIN}}. Mentionne uniquement la specialite et, si pertinent, l\'etablissement/le lieu (ex: "suivi hebdomadaire en kinesitherapie depuis aout 2022", "suivi annuel en neuropediatrie", "suivi au centre X a [ville]"), jamais le nom du praticien.',
    '   c) AUTONOMIE / VIE QUOTIDIENNE : autonomie dans les actes de la vie courante, difficultes spatiales ou autres mentionnees.',
    '   d) LOISIRS : activites extrascolaires, centres d\'interet, hobbies.',
    '   e) COMPORTEMENT EN CLASSE : Si des difficultes d\'attention, d\'investissement ou de comportement sont EXPLICITEMENT decrites dans les donnees, cree un paragraphe dedie avec les details (participation, motivation, preferences de matieres). Si au contraire l\'attention et le comportement sont fonctionnels (absence de difficulte notee), NE PAS creer un paragraphe dedie : integre une phrase breve a la FIN du profil, apres le profil social et emotionnel (ex: "[PATIENT_PRENOM] ne presente pas de difficulte d\'attention en classe." ou "[PATIENT_PRENOM] parvient a maintenir une attention suffisante pour suivre les enseignements."). Si l\'organisation est fonctionnelle, dis-le positivement. Ne reformule PAS negativement un constat positif.',
    '   f) PROFIL SOCIAL ET EMOTIONNEL : traits de personnalite (comptetitif, perfectionniste, curieux...), relations avec les pairs, sensibilite, confiance en soi. Inclus les nuances de caractere mentionnees (peut etre brusque ou maladroit, tres competiteur, timide...) si elles figurent dans les donnees. Sois PRECIS : si les relations sont bonnes en general mais complexes avec certaines personnes, decris cette nuance exacte au lieu de generaliser.',
    '   REGLES :',
    '   - Commence TOUJOURS par la situation scolaire actuelle, PAS par l\'historique developpemental.',
    '   - L\'historique developpemental precoce (age de marche, elocution...) ne doit etre mentionne QUE s\'il est directement pertinent pour la problematique actuelle.',
    '   - Omets les informations medicales sans rapport avec le referencement (somnambulisme, reflux...).',
    '   - Utilise des formulations ATTRIBUEES : "Selon les parents...", "{{PATIENT_PRENOM}} mentionne...".',
    '   - Cite les details SPECIFIQUES : dates, noms d\'amenagements, activites precises, matieres appreciees et non appreciees, expressions du patient.',
    '   - Si le patient utilise une expression particuliere ou imagee, conserve-la entre guillemets (ex: "dechicte" au lieu de couper).',
    '   - N\'invente AUCUN detail absent. Si une rubrique est vide, ne la mentionne pas.',
    '',
    'CONSIGNES DE STYLE :',
    '- Ton clinique mais accessible.',
    '- Paragraphes aeres (double saut de ligne).',
    '- Tirets "-" pour les listes.',
    '- Orthographe francaise correcte avec accents obligatoires.',
    '- Ne repete pas les memes informations entre sections.',
    '- N\'invente rien : si une donnee est absente, ne la mentionne pas.',
    '- Prefere le vocabulaire courant au vocabulaire savant quand le sens est identique : "seance(s) par semaine" plutot que "seance hebdomadaire", "fermetures eclairs" plutot que "fermetures a glissiere".',
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: BIO_RESPONSE_SCHEMA,
  };
};

// Free-text fields (diagnosticInput/projectInput/recommendationsInput) filled by the practitioner
// sometimes contain explicit negations ("Aucune", "RAS", "Non", "N/A"...) that are longer than
// the naive length threshold but carry NO substantive content. Treat those as empty so the
// "no input provided" branch (which lets the model reason from scratch) is used instead of the
// "integrate this verbatim" branch (which would otherwise be fed a contradictory instruction).
const EMPTY_FREE_TEXT_PATTERN = /^(aucune?|rien|non|ras|n\/?a|neant|sans objet|pas de [a-z\u00e0-\u00ff]+)\.?$/i;
const isSubstantiveInput = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length <= 5) return false;
  return !EMPTY_FREE_TEXT_PATTERN.test(trimmed);
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
  if (isSubstantiveInput(diagnosticInput)) {
    diagnosticDirective = [
      `Le praticien a pose le constat suivant : "${diagnosticInput}".`,
      'Justifie ce constat par les observations fonctionnelles fournies.',
      'Ne contredis PAS ce constat. Si certaines preuves sont faibles, mentionne-le avec nuance.',
      'Reste FACTUEL. Ne dramatise pas le diagnostic. Utilise le vocabulaire clinique ergo :',
      '"presente des difficultes de coordination bimanuelle" et NON "le diagnostic de X s\'illustre de maniere flagrante".',
      'Si le constat mentionne plusieurs diagnostics, traite chacun dans le domaine fonctionnel correspondant.',
      'IMPORTANT : Integre TOUTES les observations specifiques mentionnees par le praticien, y compris les recommandations de bilans complementaires (orthoptique, neuropsychologique, etc.). Si le praticien mentionne une recommandation de bilan complementaire, elle DOIT apparaitre dans la synthese diagnostique.',
      'COUVERTURE COMPLETE OBLIGATOIRE : chaque element distinct cite dans le constat du praticien (ex: regulation de la force, anticipation posturale, dissociation corporelle...) doit apparaitre dans le domaine correspondant. N\'en omets aucun pour le remplacer par un detail non fourni.',
      'ANTI-INVENTION : n\'ajoute AUCUN detail clinique specifique (ex: orientation d\'un pied ou d\'un membre, alternance de mains, fatigue/agitation) qui ne decoule pas explicitement du constat du praticien ou des observations fournies, meme s\'il semble plausible pour ce type de profil.',
      'Utilise les memes termes fonctionnels que le praticien plutot que des synonymes plus techniques.',
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
  if (isSubstantiveInput(projectInput)) {
    projectDirective = [
      `Le praticien a defini le projet suivant : "${projectInput}".`,
      'Developpe ce projet en tirets concrets (axes de travail, suivi propose, collaboration avec l\'entourage).',
      'COUVERTURE COMPLETE : ne te limite pas au seul theme mentionne par le praticien. Verifie la synthese diagnostique et assure-toi que le projet couvre CHAQUE domaine fonctionnel identifie comme deficitaire (motricite fine/graphisme, motricite globale/equilibre, AVQ/autonomie, visuo-spatial...), en ajoutant un axe pour un domaine deficitaire absent de la note du praticien si necessaire.',
      'COLLABORATION EXTERNE : si un suivi paramedical externe (kinesitherapeute, autre reeducateur) est deja mentionne dans le profil occupationnel et qu\'un domaine moteur global/equilibre est deficitaire, formule un axe de collaboration avec ce professionnel plutot que de dupliquer entierement ce travail en ergotherapie.',
    ].join(' ');
  } else {
    projectDirective = [
      'Formule un projet d\'accompagnement coherent avec le diagnostique.',
      'Si un suivi est justifie, liste les axes d\'intervention (ex: reeducation graphique, motricite fine, strategies visuo-spatiales, autonomie, motricite globale, adaptations scolaires) EN COUVRANT CHAQUE domaine deficitaire identifie dans la synthese diagnostique, pas uniquement le premier.',
      'Pour les axes graphiques/scriptaux, inclus TOUJOURS "qualite" aux cotes de "lisibilite" et "vitesse" (ex: "pour ameliorer la lisibilite, la qualite et la vitesse lors des ecrits").',
      'Si motricite fine/coordination ET reeducation graphique figurent tous deux dans les axes, formule la motricite fine comme prerequis a la reeducation graphique (ex: "Travail de la motricite fine et de la coordination bi-manuelle pour favoriser la reeducation graphique.").',
      'COLLABORATION EXTERNE : si un suivi paramedical externe (kinesitherapeute, autre reeducateur) est deja mentionne dans le profil occupationnel et qu\'un domaine moteur global/equilibre est deficitaire, formule un axe de collaboration avec ce professionnel plutot que de dupliquer entierement ce travail.',
      'Si aucun suivi n\'est preconise, indique-le clairement.',
    ].join(' ');
  }

  // Directive recommandations conditionnelle
  let recommendationsDirective: string;
  if (isSubstantiveInput(recommendationsInput)) {
    recommendationsDirective = `Le praticien propose les preconisations suivantes : "${recommendationsInput}". Integre ces elements fidellement et complete si pertinent. Formule les recommandations de maniere LARGE et PRAGMATIQUE, avec des exemples concrets entre parentheses quand c'est utile. ADAPTE le registre au niveau scolaire de l'enfant (voir regle de niveau scolaire ci-dessous).`;
  } else {
    recommendationsDirective = 'Formule des preconisations concretes et proportionnees aux resultats. Chaque preconisation doit etre directement actionnable. Formule-les de maniere LARGE et PRAGMATIQUE, avec des exemples concrets entre parentheses (ex: "textes a trous, supports de cours photocpies..."). Ajoute "lorsque cela est possible" quand la recommandation necessite une adaptation au contexte de la classe. REGLE DE NIVEAU SCOLAIRE (obligatoire) : si l\'enfant est scolarise en maternelle (TPS/PS/MS/GS) et n\'a pas encore d\'activites d\'ecriture scolaire formelle rapportees, NE PROPOSE PAS d\'adaptations pedagogiques de type "limiter la copie", "modeles manuscrits" ou "plan incline en classe" (non pertinentes avant le CP) : privilegie des recommandations pour LA MAISON/LA FAMILLE (jeux moteurs, activites creatives, positionnement a la maison, guidance parentale) et adapte l\'en-tete en consequence (ex: "Adaptations recommandees a la maison :").';
  }

  const subjectLabel = profile === 'adult' ? 'la personne' : "l'enfant";

  const styleBlock = String(payload.styleDirectives || '').trim();

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    ...(styleBlock ? [
      'PREFERENCES DE STYLE DU PRATICIEN (issues de ses corrections precedentes) :',
      styleBlock,
      '',
    ] : []),
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
    '   REGLE STRICTE DU MOTIF : La phrase de motif ("est adresse(e) en bilan d\'ergotherapie pour...") doit reprendre UNIQUEMENT le motif de referencement explicite fourni dans les donnees du dossier. INTERDICTION ABSOLUE d\'ajouter des elements decouverts PENDANT l\'evaluation (douleurs, fatigue, comportement...) dans cette phrase. Ces elements appartiennent au corps de la synthese, pas a l\'introduction.',
    '   N\'utilise JAMAIS de parentheses pour inserer des informations demographiques. N\'inclus PAS l\'age ni le genre dans l\'introduction.',
    '   Puis : "L\'entretien realise ainsi que les resultats des evaluations mettent en evidence plusieurs elements cles :"',
    '',
    '   CORPS — APPROCHE NARRATIVE PAR DOMAINE :',
    '   FORMAT OBLIGATOIRE : Le titre du domaine doit figurer DANS le tiret lui-meme, suivi d\'un deux-points, puis du corps en prose sur la ou les lignes suivantes (sans nouveau tiret pour le corps).',
    '   EXEMPLE DE FORMAT CORRECT :',
    '   "- Sur le plan de la motricite fine et de la coordination bi-manuelle :\\nLes competences sont deficitaires. Une maladresse est observee lors..."',
    '   "- Concernant les capacites visuo-perceptives :\\nLes resultats sont heterogenes. Les capacites d\'exploration visuelle..."',
    '   EXEMPLES DE FORMAT INTERDIT (a ne JAMAIS produire) :',
    '   "**Sur le plan de la motricite fine et des coordinations :**\\nLes competences..." — le gras isole est INTERDIT.',
    '   "Sur le plan de la motricite fine et des coordinations :\\nLes competences..." — sans tiret est INTERDIT.',
    '   INTERDIT : Ne cree JAMAIS un header en gras, en italique ou en prose separe pour introduire un domaine. Le titre EST dans le tiret, toujours precede du "-".',
    '   Chaque domaine peut contenir PLUSIEURS PARAGRAPHES si le contenu le justifie.',
    '   Pour chaque domaine :',
    '   1. Commence par les OBSERVATIONS FONCTIONNELLES : ce qui est preserve, ce qui est fragile, ce qui est deficitaire.',
    '   2. Decris les MANIFESTATIONS CONCRETES observees ou rapportees : "ce qui se manifeste par des sauts de ligne lors de la copie", "engendrant des confusions de lettres".',
    '   3. NE CITE AUCUN SCORE NI NOM DE TEST.',
    '   4. PRESERVE LES OBSERVATIONS SPECIFIQUES : Si l\'ergotherapeute a note une observation precise sur une epreuve (ex: performance sur une epreuve particuliere, comportement specifique observe), integre ce detail en le reformulant. Ne generalise PAS un fait specifique en formulation vague.',
    '',
    '   DOMAINES POSSIBLES (n\'utilise que ceux pour lesquels tu as des donnees) :',
    '   - "Sur le plan de la motricite fine et de la coordination bi-manuelle" : motricite fine, coordination bimanuelle, coordination oculo-manuelle. Decris ce qui est fonctionnel et ce qui est fragile.',
    '   - "Concernant les capacites visuo-spatiales" : REGLE CRITIQUE — Si TOUTES les performances visuo-perceptives sont dans la norme ou norme haute, la section doit s\'ouvrir OBLIGATOIREMENT par "Les competences de perception visuelle sont preservees et fonctionnelles." INTERDICTION d\'ajouter une fragilite ou une reserve qui n\'est pas explicitement supportee par un score deficitaire dans les donnees. Si certains sous-scores sont deficitaires, nomme EXPLICITEMENT les competences preservees ET celles en difficulte en termes fonctionnels. Traduis en impact fonctionnel : sauts de ligne, repetitions, dependance au modele visuel. Si le praticien recommande un bilan complementaire (orthoptique, etc.), mentionne-le dans ce domaine.',
    '   - "Concernant l\'ecriture manuscrite" : Section la plus DETAILLEE. Developpe en PLUSIEURS PARAGRAPHES :',
    '     (a) Vitesse et qualite generale : ce qui est dans les normes, comment la qualite evolue avec l\'acceleration.',
    '     (b) Comportements associes observes : hesitations orthographiques, dependance visuelle au modele, rapport entre la pensee et le flux scriptural, effort cognitif soutenu generant de la fatigue.',
    '     (c) POSTURE D\'ECRITURE (paragraphe dedie) : lateralite, position du poignet et de la main, mode de progression sur la ligne, prise de crayon. Decris en termes FONCTIONNELS et simples : "prise de stylo adequate, mais crispee et avec une forte pression" plutot que "prise tridigitale avec hyperflexion du pouce". Le parent doit comprendre. ANTI-INVENTION ABSOLUE s\'appliquant a TOUTE LA POSTURE : Decris UNIQUEMENT ce que l\'ergotherapeute a ecrit dans les observations. Si un element de posture est note "correct", "adequate", "fonctionnel" ou toute formulation positive, dis-le explicitement ("la posture est correcte", "la prise du crayon est fonctionnelle"). NE DEDUIS AUCUN detail absent — ni pour la prise (position du pouce, tension des doigts, angle du poignet, pression), ni pour la posture du corps (position de la tete, courbure du dos, stabilite de l\'assise). Si ces elements ne figurent pas dans les observations, ne les mentionne pas.',
    '     (d) DOULEURS : localisation precise avec termes anatomiques corrects (doigts, main, poignet, epaule, face interne de l\'avant-bras — JAMAIS "interieur de l\'avant-bras"), cotation si disponible (ex: "que {{PATIENT_PRENOM}} evalue a X/10 sur l\'echelle de la douleur").',
    '     (e) CONCLUSION INTEGRATIVE du graphisme : lien entre posture, effort, et endurance ("Bien que l\'ecrit reste fluide et fonctionnel, il exige un effort physique et cognitif couteux, limitant l\'endurance sur le long terme").',
    '   - "Sur le plan attentionnel" : si donnees disponibles.',
    '   - "Sur le plan sensoriel" : si donnees disponibles.',
    '   - "Sur le plan informatique" : si des donnees de frappe/informatique sont disponibles. Decris : comparaison qualitative avec la vitesse manuscrite, posture de frappe, utilisation des doigts, connaissance du clavier, maitrise des logiciels. Conclus sur le role de compensation dans le parcours.',
    '',
    '   PARAGRAPHE DE CONCLUSION (OBLIGATOIRE) :',
    '   Termine par un PARAGRAPHE FINAL CONCIS (hors tirets, 2-3 phrases) qui :',
    '   1. Synthetise les enjeux fonctionnels GLOBAUX en couvrant TOUS les domaines deficitaires identifies dans le cas (AVQ, motricite globale, ecriture, autonomie, visuo-spatial...) — pas uniquement l\'ecriture. Si plusieurs domaines sont impactes, le mentionner explicitement.',
    '   2. Justifie la recommandation centrale de maniere directe ("est preconise" et NON "est vivement preconise"). Pas de qualificatifs restrictifs inutiles ("pour les travaux de redaction longs" → "pour les productions ecrites") sauf si c\'est le constat specifique du praticien.',
    '   Ce paragraphe ne cite aucun nouveau score. Il conclut et oriente.',
    '',
    '   REGLES CRITIQUES pour cette section :',
    '   - AUCUN score chiffre (NS, ET, z, percentile). AUCUN nom de test.',
    '   - Integre les details SPECIFIQUES des observations. Ne generalise pas si le fait precis est disponible.',
    '   - Si des performances sont dans la norme, dis-le positivement ("competences preservees", "fonctionnel").',
    '   - Si des performances sont fragiles, decris l\'impact fonctionnel concret.',
    '   - N\'utilise les domaines que s\'il y a des donnees correspondantes.',
    '   - Pas de metaphores. Ton clinique factuel mais accessible.',
    '   - ANTI-INVENTION (s\'applique a TOUS les domaines, pas seulement au visuo-spatial ou a la posture) : n\'ajoute JAMAIS une observation, une fragilite, un detail comportemental ou une manifestation (ex: orientation d\'un pied ou d\'un membre, alternance des mains, fatigue, agitation) qui ne decoule pas explicitement des observations fournies ou du constat du praticien, meme si cela parait cliniquement plausible pour ce type de profil.',
    '   - NE COMBLE JAMAIS l\'espace pour atteindre le nombre de mots minimum en inventant des details cliniques. Une synthese plus courte mais fidele aux donnees est TOUJOURS preferable a une synthese plus longue mais inexacte.',
    '',
    '2. "projet_accompagnement" (40-140 mots) :',
    `   Si un suivi en ergotherapie est recommande :`,
    `   - Commence par une phrase valorisant ${subjectLabel} ("jeune fille consciencieuse et appliquee", "enfant volontaire et investi(e)").`,
    `   - Precise la MODALITE de suivi : "je propose la mise en place de seances regulieres" OU "je propose la mise en place de seances ponctuelles, en si besoin" (adapte au niveau de necessite du suivi selon le diagnostique).`,
    `   - Liste 1-4 axes de travail en tirets simples et concis. REGLE DE COUVERTURE : un axe par domaine fonctionnel deficitaire identifie dans la synthese diagnostique (ex: graphisme/motricite fine, posture/prise du crayon, AVQ/autonomie, motricite globale/equilibre) — ne te limite pas au seul axe graphique si d'autres domaines sont deficitaires. REGLE ECRITURE : Pour les axes graphiques/scriptaux, inclus TOUJOURS "qualite" aux cotes de "lisibilite" et "vitesse" (ex: "pour ameliorer la lisibilite, la qualite et la vitesse lors des ecrits"). REGLE PREREQUIS : Si motricite fine/coordination ET reeducation graphique figurent tous deux, formule la motricite fine comme prerequis : "Travail de la motricite fine et de la coordination bi-manuelle pour favoriser la reeducation graphique."`,
    `   - LONGUEUR DES AXES : Chaque axe doit etre un label CONCIS (5-15 mots maximum). Evite les propositions subordonnees explicatives ("pour automatiser le geste", "afin de liberer la charge cognitive") sauf si le praticien les a explicitement formulees dans projectInput. Exemples CORRECTS : "- Amelioration de la vitesse de frappe au clavier" / "- Apprentissage de l'ordinateur afin de compenser les difficultes graphiques et d'orthographe". Exemple INTERDIT : "- Amelioration de la vitesse de frappe au clavier pour automatiser le geste et liberer la charge cognitive".`,
    `   - OBLIGATOIRE : Termine par une phrase de REEVALUATION : "Une reevaluation des competences est preconisee tous les 6 mois, afin d'ajuster les objectifs du suivi en ergotherapie et de s'adapter au plus pres de l'evolution de {{PATIENT_PRENOM}}."`,
    `   Si le suivi n'est PAS recommande :`,
    `   - Dis-le clairement : "Un accompagnement en ergotherapie n'est pas preconise pour {{PATIENT_PRENOM}}."`,
    '',
    '3. "recommandations" (50-120 mots) :',
    '   Commence par un en-tete adapte au contexte : "Adaptations pedagogiques recommandees :" (si contexte scolaire) ou "Adaptations recommandees :" (si autre contexte).',
    '   REGLE ANTI-REPETITION : Si la conclusion de la synthese diagnostique preconise deja explicitement un outil de compensation (ordinateur, clavier, logiciel...), NE PAS en faire la premiere recommandation pedagogique. Commence par les adaptations environnementales et pedagogiques : limitation de la copie, amenagement du temps, valorisation du fond. Ne repete que si la compensation informatique n\'est pas encore mentionnee dans la conclusion.',
    '   Puis 3-4 tirets concrets et DIRECTEMENT ACTIONNABLES.',
    '   Chaque recommandation doit pouvoir etre mise en oeuvre immediatement par l\'ecole ou la famille.',
    '   SUGGESTIONS ERGONOMIQUES STANDARDS : Inclus ces adaptations UNIQUEMENT si elles sont directement justifiees par les observations du praticien. NE PAS ajouter de maniere systematique si l\'observation correspondante est absente des notes cliniques.',
    '   - Plan incline : A PROPOSER UNIQUEMENT si une problematique posturale est EXPLICITEMENT notee dans les observations (tete proche de la feuille, mauvaise posture du buste, dos voute...). Ne pas proposer si la posture est decrite comme correcte ou si elle n\'est pas mentionnee.',
    '   - Assise dynamique (coussin a air) : A PROPOSER UNIQUEMENT si agitation motrice ou besoin de mouvement important sont EXPLICITEMENT notes dans les observations du praticien.',
    '   INTERDIT : recommandations vagues ("sensibilisation de l\'equipe"), recommandations materielles trop specifiques (noms de produits) sauf si justifie par les observations.',
    '   Si tout est normal, mentionne que l\'accompagnement n\'est pas necessaire.',
    '   STYLE : Formule LARGE et PRAGMATIQUE avec des exemples concrets entre parentheses. Ajoute "lorsque cela est possible" quand la recommandation necessite une adaptation au contexte.',
    '   EXEMPLE DE STYLE :',
    '   "Adaptations pedagogiques recommandees :\\n- Utilisation preferentielle de l\'outil informatique pour l\'ensemble des productions ecrites, lorsque cela est possible.\\n- Limiter la charge de copie (fourniture de supports de cours photocpies, textes a trous...).\\n- Renforcement des reperes visuels sur les supports de travail (lignes de couleurs, aeration des documents).\\n- Poursuite du tiers-temps pour compenser la lenteur et la fatigue induite."',
    '',
    `4. "objectifs_generaux" (40-140 mots) :`,
    `   Si un suivi en ergotherapie est recommande :`,
    `   - Commence par une phrase valorisant ${subjectLabel} ("jeune fille consciencieuse et appliquee", "enfant volontaire et investi(e)").`,
    `   - Precise la MODALITE de suivi : "je propose la mise en place de seances regulieres" OU "je propose la mise en place de seances ponctuelles, en si besoin" (adapte au niveau de necessite du suivi selon le diagnostique).`,
    `   - Liste 1-4 objectifs en tirets simples et concis, un par domaine fonctionnel deficitaire identifie dans la synthese diagnostique. PAS de categories "court/moyen terme". PAS de timeline.`,
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

// ── STYLE FEEDBACK EXTRACTION ──────────────────────

// Structured style preferences: global rules + per-section rules
const FEEDBACK_RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    global: { type: 'STRING' as const, description: 'Regles de style generales applicables a toutes les sections. Bullet points "-". Max 400 chars. Aucune donnee clinique.' },
    sections: {
      type: 'OBJECT' as const,
      properties: {
        mandat_ref:      { type: 'STRING' as const, description: 'Regles specifiques au Mandat de referencement. Bullet points. Max 200 chars. Vide si aucune correction sur cette section.' },
        mandat_eval:     { type: 'STRING' as const, description: 'Regles specifiques au Mandat d evaluation. Bullet points. Max 200 chars.' },
        profil:          { type: 'STRING' as const, description: 'Regles specifiques au Profil occupationnel. Bullet points. Max 200 chars.' },
        diagnostic:      { type: 'STRING' as const, description: 'Regles specifiques a la Synthese diagnostique. Bullet points. Max 200 chars.' },
        objectifs:       { type: 'STRING' as const, description: 'Regles specifiques aux Objectifs generaux. Bullet points. Max 200 chars.' },
        project:         { type: 'STRING' as const, description: 'Regles specifiques au Projet d accompagnement. Bullet points. Max 200 chars.' },
        recommandations: { type: 'STRING' as const, description: 'Regles specifiques aux Recommandations. Bullet points. Max 200 chars.' },
      },
    },
  },
  required: ['global'],
};

const FEEDBACK_SYSTEM = `Tu es un assistant specialise dans l'analyse de style redactionnel pour des rapports d'ergotherapie.
Tu recois des textes ANONYMISES (les noms et donnees personnelles ont ete remplaces par des placeholders).

REGLES ABSOLUES DE SECURITE DES DONNEES :
- Tu ne dois JAMAIS inclure de donnees cliniques, medicales ou personnelles dans ta sortie.
- Tu ne dois JAMAIS reproduire de contenu specifique a un patient (symptomes, diagnostics, situations).
- Tu extrais UNIQUEMENT des regles de STYLE et de FORMULATION abstraites et generiques.
- Si tu detectes des donnees patient dans ta sortie, supprime-les immediatement.

Ton role : comparer les textes originaux (generes par IA) avec les corrections du praticien pour en deduire des PREFERENCES DE STYLE ABSTRAITES, organisees par section de rapport.`;

const buildFeedbackTask = (payload: Record<string, unknown>): BuildResult => {
  const diffs = payload.diffs as Array<{ sectionId: string; original: string; corrected: string }> || [];
  // existingPreferences may be a JSON string (structured) or a plain string (legacy)
  const existingPreferencesRaw = String(payload.existingPreferences || '').trim();
  let existingGlobal = '';
  let existingSections: Record<string, string> = {};
  if (existingPreferencesRaw) {
    try {
      const parsed = JSON.parse(existingPreferencesRaw);
      existingGlobal = String(parsed?.global || '');
      existingSections = (parsed?.sections && typeof parsed.sections === 'object') ? parsed.sections as Record<string, string> : {};
    } catch {
      existingGlobal = existingPreferencesRaw; // legacy plain string → treat as global
    }
  }

  if (diffs.length === 0) throw new Error('No diffs provided');

  const SECTION_LABELS: Record<string, string> = {
    mandat_ref: 'Mandat de referencement',
    mandat_eval: "Mandat d'evaluation",
    profil: 'Profil occupationnel',
    diagnostic: 'Synthese diagnostique',
    objectifs: 'Objectifs generaux',
    project: "Projet d'accompagnement",
    recommandations: 'Recommandations / Preconisations',
  };

  const diffBlocks = diffs.map((d) => {
    const label = SECTION_LABELS[d.sectionId] || d.sectionId;
    return `--- ${label} ---\nORIGINAL :\n${d.original}\n\nCORRIGE PAR LE PRATICIEN :\n${d.corrected}`;
  }).join('\n\n');

  const existingBlock = [
    ...(existingGlobal ? [`PREFERENCES GENERALES EXISTANTES :\n${existingGlobal}`] : []),
    ...Object.entries(existingSections)
      .filter(([, v]) => v)
      .map(([k, v]) => `PREFERENCES EXISTANTES pour "${SECTION_LABELS[k] || k}" :\n${v}`),
  ].join('\n\n');

  const userPrompt = [
    'REGLE DE SECURITE : Ne reproduis AUCUNE donnee clinique, medicale ou personnelle dans ta reponse. Extrais UNIQUEMENT des regles de style abstraites.',
    '',
    ...(existingBlock ? [
      'PREFERENCES EXISTANTES (a consolider, pas de doublons, maximum 10 regles au total) :',
      existingBlock,
      '',
    ] : []),
    'CORRECTIONS DU PRATICIEN (textes anonymises) :',
    diffBlocks,
    '',
    'TACHE : Analyse les differences. Pour chaque correction, identifie la regle sous-jacente et classe-la dans :',
    '- "global" : UNIQUEMENT pour les regles applicables a TOUTES les sections (ton, ponctuation, longueur de phrase, tendances stylistiques transversales).',
    '- "sections.mandat_eval", "sections.diagnostic", etc. : pour les regles specifiques a UNE section (format, template de formule, contenu attendu, ordre des elements, regles de structure, conditions d\'ajout d\'un element).',
    '',
    'EXEMPLES de bonnes regles globales :',
    '- Prefere les phrases courtes et directes.',
    '- Evite les softeners inutiles ("globalement", "relativement").',
    '- Utilise "lorsque cela est possible" pour contextualiser les recommandations.',
    '',
    'EXEMPLES de bonnes regles de section (structurelles, de template et de contenu) :',
    '- (mandat_eval) Commence toujours par "observer et d\'evaluer" plutot que simplement "evaluer" ou "analyser".',
    '- (mandat_eval) Structure : capacites graphomotrices + facteurs sous-jacents (motricite fine, visuo-perceptives, exploration visuelle, bi-manuelle, oculo-manuelle) + phrase motricite globale si dans le perimetre du bilan.',
    '- (diagnostic) Le titre de domaine figure dans le tiret lui-meme ("- Sur le plan de...:") suivi du corps en prose ; pas de header separe.',
    '- (diagnostic) Preserves les observations cliniques specifiques telles que notees ; ne pas generaliser un fait precis.',
    '- (project) Formule la motricite fine comme prerequis a la reeducation graphique quand les deux axes coexistent.',
    '- (project) Inclure "qualite" en plus de "lisibilite" et "vitesse" pour les axes graphiques.',
    '- (recommandations) Ne propose plan incline ou assise dynamique que si une problematique posturale ou un besoin de mouvement est explicitement note dans les observations.',
    '- (mandat_ref) Mentionne le contexte PCO si present dans les donnees du dossier.',
    '',
    'EXEMPLES de MAUVAISES regles (A EVITER car elles contiennent des donnees patient) :',
    '- "Pour [prenom], mentionner le bilan orthoptique" ← contient un prenom',
    '- "Quand l\'enfant a des douleurs 6/10, le dire" ← contient des donnees cliniques',
    '',
    'FORMAT : JSON avec "global" (string, bullet points, max 400 chars) et "sections" (objet, champs optionnels, max 200 chars chacun). Consolide avec les preferences existantes.',
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: FEEDBACK_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: FEEDBACK_RESPONSE_SCHEMA,
  };
};

const REEVALUATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    resume_initial: { type: 'string' },
    evolution_commentee: { type: 'string' },
    recommandations: { type: 'string' },
    conclusion: { type: 'string' },
  },
  required: ['resume_initial', 'evolution_commentee', 'recommandations', 'conclusion'],
};

const buildReevaluationTask = (payload: Record<string, unknown>): BuildResult => {
  const profile = String(payload.profile || 'pediatric');
  const childContext = String(payload.childContext || '');
  const previousScoresSummary = String(payload.previousScoresSummary || 'Non disponible');
  const newScoresSummary = String(payload.newScoresSummary || 'Non disponible');
  const evolutionSummary = String(payload.evolutionSummary || 'Non disponible');
  const previousReportContext = String(payload.previousReportContext || '').trim();
  const styleBlock = String(payload.styleDirectives || '').trim();
  const subjectLabel = profile === 'adult' ? 'PATIENT' : 'ENFANT';

  const userPrompt = [
    SECURITY_INSTRUCTION,
    '',
    ...(styleBlock ? [
      'PREFERENCES DE STYLE DU PRATICIEN :',
      styleBlock,
      '',
    ] : []),
    `CONTEXTE ${subjectLabel} : ${childContext}`,
    '',
    ...(previousReportContext ? [
      'CONTENU DU BILAN INITIAL (sections cliniques du rapport precedent) :',
      previousReportContext,
      '',
    ] : []),
    'SCORES BILAN INITIAL (valeur NS ou ET selon le test) :',
    previousScoresSummary,
    '',
    'SCORES REEVALUATION (valeur NS ou ET selon le test) :',
    newScoresSummary,
    '',
    'EVOLUTION PAR SOUS-TEST (delta calcule automatiquement) :',
    evolutionSummary,
    '',
    'TACHE : Redige un JSON avec 4 champs (valeurs = strings HTML) :',
    '',
    '1. "resume_initial" (80-150 mots, HTML) :',
    '   Resume concis du bilan initial pour un compte-rendu de suivi, style clinique sobre.',
    '   IMPORTANT : utilise EXCLUSIVEMENT les informations fournies dans le CONTENU DU BILAN INITIAL ci-dessus.',
    '   Structure obligatoire en deux parties :',
    '   (a) Phrase d\'introduction situant le bilan (date si presente dans le contexte, motif) + liste <ul><li> des deficits/fragilites identifies (extraits litteralement du [Diagnostique]).',
    '   (b) Phrase "A la suite de ce bilan, les objectifs de prise en charge etaient :" + liste <ul><li> des objectifs (extraits litteralement du [Objectifs]).',
    '   Ne paraphrase pas : reprends les formulations cliniques exactes du bilan initial fourni.',
    '   Utilise <p> et <ul><li> uniquement.',
    '',
    '2. "evolution_commentee" (200-400 mots, HTML) :',
    '   EXCEPTION CRITIQUE : Contrairement aux bilans initiaux, ce document est un compte-rendu de suivi adresse a des professionnels de sante (medecins, enseignants specialises). Pour cette section UNIQUEMENT, tu DOIS :',
    '   - Citer les noms des tests par leur denomination exacte (Lespargot, BHK, EVIC, MABC-2, DTVP, NEPSY, etc.).',
    '   - Creer une table HTML de comparaison pour CHAQUE test evalue. Format obligatoire pour chaque table :',
    '     <table><thead><tr><th>Epreuve</th><th>Bilan initial (DATE_INITIALE)</th><th>Reevaluation (DATE_REEV)</th><th>Tendance</th></tr></thead><tbody>... scores ET ou NS avec signe ... </tbody></table>',
    '   Remplace DATE_INITIALE et DATE_REEV par les dates reelles fournies dans le contexte (ex: "07/2025", "02/2026"). Si les dates ne sont pas disponibles, utilise "Bilan initial" et "Reevaluation".',
    '   Apres chaque table, ajoute UN PARAGRAPHE <p> d\'interpretation clinique (2-3 phrases) : progression observee, points de vigilance, lien avec la prise en charge.',
    '   Commence la section par une phrase d\'introduction situant la reevaluation (date, contexte, motif si fourni).',
    '   IMPORTANT : cite les valeurs numeriques exactes des scores fournis (NS, ET, delta) — ne les omets pas.',
    '   Identifie clairement les domaines ameliores, stables, et les points de vigilance persistants.',
    '   Utilise des formulations cliniques (ex: "on observe", "les resultats indiquent", "la progression est notable").',
    '   Utilise <p> pour les paragraphes et <strong> pour les valeurs numeriques importantes dans les interpretations.',
    '   Utilise <table><thead><tr><th> pour les tables de comparaison (pas de style inline). Pas de Markdown dans les champs HTML.',
    '',
    '3. "recommandations" (100-200 mots, HTML) :',
    '   Recommandations pedagogiques et adaptations actualisees en lien avec les resultats.',
    '   Format : liste <ul><li> de recommandations concretes et operationnelles.',
    '   Ajuste en fonction des forces et axes de progres identifies.',
    '',
    '4. "conclusion" (100-180 mots, HTML) :',
    '   Synthese conclusive du compte-rendu de suivi, style "Conclusion" de rapport clinique.',
    '   Commence par resumer la progression globale observee (ton positif si pertinent, nuance si necessaire).',
    '   Mentionne l\'investissement et la motivation du patient si cela ressort du contexte fourni.',
    '   Indique si les objectifs initiaux restent inchanges ou s\'ils evoluent.',
    '   Termine par une phrase sur la continuite du suivi et les prochains objectifs prioritaires.',
    '   Utilise <p> pour les paragraphes.',
    '',
    'STYLE : Clinique, accessible, ton bienveillant mais factuel, orthographe francaise avec accents.',
    'Ne mentionne jamais le prenom ou le nom du patient (utilise uniquement "le/la patient(e)", "il", "elle", ou le genre grammatical adequat).',
    'Les champs sont du HTML valide (pas du Markdown).',
    'RAPPEL EXCEPTION NOMS DE TESTS : Dans ce compte-rendu de suivi professionnel, les noms des tests (Lespargot, BHK, EVIC, MABC-2, etc.) DOIVENT etre cites explicitement dans evolution_commentee. Seul le rapport initial les masque (lecteurs non-professionnels).',
  ].join('\n');

  return {
    contents: userPrompt,
    systemInstruction: profile === 'adult' ? ADULT_SYSTEM : PEDIATRIC_SYSTEM,
    responseMimeType: 'application/json',
    responseSchema: REEVALUATION_RESPONSE_SCHEMA,
  };
};

const buildTask = (task: AITask, payload: Record<string, unknown>): BuildResult => {
  if (task === 'report_bio') return buildBioTask(payload);
  if (task === 'report_diagnostic') return buildDiagnosticTask(payload);
  if (task === 'extract_style_feedback') return buildFeedbackTask(payload);
  if (task === 'report_reevaluation') return buildReevaluationTask(payload);
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

    if (!['report_bio', 'report_diagnostic', 'extract_style_feedback', 'report_reevaluation'].includes(task)) {
      return new Response(JSON.stringify({ error: 'INVALID_TASK' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Style feedback task: no credits, no generation session ──
    if (task === 'extract_style_feedback') {
      if (!GEMINI_API_KEY) {
        return new Response(JSON.stringify({ error: 'AI service not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const built = buildTask(task, payload);
      const feedbackGeminiBody: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: String(built.contents || '') }] }],
        generationConfig: {
          responseMimeType: built.responseMimeType,
          ...(built.responseSchema && { responseSchema: built.responseSchema }),
        },
        ...(built.systemInstruction && { system_instruction: { parts: [{ text: built.systemInstruction }] } }),
      };

      try {
        const fbController = new AbortController();
        const fbTimer = setTimeout(() => fbController.abort(), GEMINI_TIMEOUT_MS);
        const fbResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify(feedbackGeminiBody),
          signal: fbController.signal,
        });
        clearTimeout(fbTimer);

        if (!fbResponse.ok) {
          return new Response(JSON.stringify({ error: 'Feedback extraction failed' }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const fbData = await fbResponse.json();
        const fbText = fbData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

        if (fbText) {
          try {
            const parsed = JSON.parse(fbText);
            // Store structured JSON (global + sections) — serialize back to compact JSON string
            const globalRules = String(parsed?.global || '').trim().slice(0, 400);
            const sections = parsed?.sections && typeof parsed.sections === 'object' ? parsed.sections : {};
            const cleanSections: Record<string, string> = {};
            for (const [k, v] of Object.entries(sections)) {
              const s = String(v || '').trim().slice(0, 200);
              if (s) cleanSections[k] = s;
            }
            const hasContent = globalRules.length > 0 || Object.keys(cleanSections).length > 0;
            if (hasContent) {
              const structured = JSON.stringify({ global: globalRules, sections: cleanSections });
              await adminSupabase!.from('practitioners')
                .update({ ai_style_preferences: structured })
                .eq('id', userId);
            }
          } catch {
            // JSON parse failure — non-blocking
          }
        }

        return new Response(JSON.stringify({ text: fbText, generationId: null }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Feedback extraction error' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

    if (task === 'report_reevaluation') {
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
    if (!finalized && (currentTask === 'report_bio' || currentTask === 'report_diagnostic' || currentTask === 'report_reevaluation')) {
      await safeFinalize(adminSupabase, generationId, userId, false, 'INTERNAL_ERROR');
      finalized = true;
    }
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
