
import { GoogleGenAI } from "@google/genai";
import { SubscriptionService } from './subscription';
import { cleanAndParseJson } from '../utils/aiHelpers';
import { Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';
import { Logger } from '../utils/logger';

// --- 1. PROMPTS PÉDIATRIQUES (ORIGINAL - STRICTEMENT INCHANGÉ) ---

const SYS_PROMPT_PEDIATRIC = `Tu es un Ergothérapeute Expert en pédiatrie (Modèle PPH/MOH). Ton rôle est de rédiger des bilans cliniques rigoureux mais pédagogiques.

TES RÈGLES D'OR (Non négociables) :
1. **Vulgarisation Intelligente (Priorité Absolue)** : Ton rapport est lu par des non-experts (Parents, Enseignants).
   - Traduis le jargon clinique en impacts concrets sur la vie quotidienne.
   - Si tu utilises un terme expert (ex: 'coût cognitif', 'praxies', 'efficience'), accompagne-le toujours d'une explication simple ou d'un exemple.
   - Objectif : Être "l'interprète" des difficultés de l'enfant pour son entourage.
2. **Causalité & Preuves** : Ne liste pas juste des symptômes. Fais le lien : "Score faible au BHK (Preuve) -> Dysgraphie (Constat) -> Illisibilité et lenteur en classe (Impact)".
3. **Discernement Thérapeutique** : Ne pathologise pas tout.
   - Si les scores sont limites (-1 ET) ou compensés, privilégie les 'Adaptations' ou une 'Guidance' plutôt qu'une rééducation systématique.
   - Valorise toujours les compétences préservées et les stratégies de l'enfant.
4. **Nuance Comportementale** : Distingue le "ne sait pas faire" (trouble instrumental) du "ne le fait pas quand on veut" (trouble exécutif/comportemental).
5. **Mise en page** : 
   - Aère le texte (double saut de ligne entre paragraphes).
   - Utilise des tirets simples "-" pour les listes.
   - Pas de listes à puces dans les paragraphes narratifs longs.
6. **Format** : Réponds toujours en JSON valide strict.`;

// --- 2. PROMPTS ADULTE (NOUVEAU - NEURO/ORTHO/GÉRIATRIE) ---

const SYS_PROMPT_ADULT = `Tu es un Ergothérapeute Expert en réadaptation adulte et maintien à domicile. Ton rôle est de rédiger des bilans cliniques axés sur l'autonomie et la qualité de vie.

TES RÈGLES D'OR (Non négociables) :
1. **Approche Fonctionnelle** : Centre ton analyse sur les habitudes de vie (Soins personnels, Travail, Loisirs, Conduite). Le jargon médical doit servir à expliquer une limitation d'activité.
2. **Vulgarisation & Respect** : Le rapport est lu par le patient, sa famille et les médecins. Adopte un ton adulte, respectueux et collaboratif.
3. **Sécurité & Prévention** : Identifie clairement les risques (Chutes, Oublis, Épuisement de l'aidant) et propose des solutions concrètes (Aides techniques, Aménagement du logement).
4. **Objectivité** : Base tes conclusions sur les observations et les scores.
5. **Mise en page** : Aère le texte. Utilise des tirets simples "-".
6. **Format** : Réponds toujours en JSON valide strict.`;

// 3. Sécurité des Données (Commun)
const SECURITY_INSTRUCTION = `RÈGLE DE SÉCURITÉ : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymisés (ex: {{PATIENT_PRENOM}}, {{ECOLE}}). Ils doivent rester intacts dans le texte généré.`;

const TIMEOUT_MS = 90000; // 90 secondes max avant timeout forcé

export interface GenerationPayload {
    safeQuestionnaire: string;
    safeObservations: string;
    scoresRaw: string;
    childContext: string;
}

// Helper pour extraire l'âge en années
const getAgeYears = (ageStr: string): number => {
    const match = ageStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

export const AIService = {
    
    /**
     * Génère le rapport complet en une ou plusieurs passes selon la complexité.
     * Inclut un Timeout de sécurité.
     */
    generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<any[]> => {
        
        Logger.info('AI', 'Starting report generation process', { patientId: patient.id });

        // 1. Détection du Contexte (Prompt Switching)
        const ageYears = getAgeYears(patient.age);
        const isAdult = ageYears >= 20;
        
        const activeSystemPrompt = isAdult ? SYS_PROMPT_ADULT : SYS_PROMPT_PEDIATRIC;
        const contextType = isAdult ? "ADULTE" : "ENFANT";
        
        Logger.info('AI', `Context detected: ${contextType} (${ageYears} ans). Loading specific prompts.`);

        // 2. Vérification & Consommation Crédit
        Logger.debug('AI', 'Requesting credit consumption...');
        const hasCredit = await SubscriptionService.consumeCredit();
        if (!hasCredit) {
            Logger.warn('AI', 'Credit consumption failed: Insufficient funds');
            throw new Error("CREDIT_INSUFFICIENT");
        }
        Logger.info('AI', 'Credit consumed successfully. Proceeding to Gemini.');

        // 3. Appel IA avec Timeout Race
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 
        const model = 'gemini-3-flash-preview'; 

        const callAI = async () => {
            
            // --- CONSTRUCTION DYNAMIQUE DES USER PROMPTS ---
            
            let promptBio = '';
            let promptDiag = '';

            if (isAdult) {
                // === MODE ADULTE ===
                promptBio = `
${SECURITY_INSTRUCTION}

CONTEXTE PATIENT : ${payload.childContext} (Adulte)

DONNÉES BRUTES (Entretien & Vie Quotidienne) :
${payload.safeQuestionnaire}

TÂCHE : Rédige les 3 sections suivantes au format JSON :

1. "mandat_referencement" : Une phrase simple et formelle.
   - Structure : "{{PATIENT_PRENOM}} est rencontré(e) ce jour à la demande de {{MEDECIN}} (ou du patient) afin d’évaluer [Insérer ici la problématique fonctionnelle : autonomie, reprise travail, aménagement...]."

2. "mandat_evaluation" : Un paragraphe décrivant la plainte principale.
   - Sujets : Douleurs, perte d'autonomie, difficultés au travail ou à la maison, historique médical pertinent (AVC, chute, maladie évolutive).

3. "profil_occupationnel" : Une synthèse complète de la vie quotidienne.
   - Structure : 3 paragraphes thématiques.
   - Thèmes : 
     - Autonomie personnelle (Soins, Repas, Déplacements).
     - Vie Domestique (Ménage, Courses, Gestion administrative).
     - Vie Sociale & Professionnelle (Travail, Loisirs, Conduite automobile).
   - Important : Mentionne l'environnement (Logement, Aidants présents).
`;

                promptDiag = `
${SECURITY_INSTRUCTION}

CONTEXTE ÉTABLI (Profil) : A insérer ici par le code si on faisait du chaining, mais ici on a le contexte global.

OBSERVATIONS CLINIQUES (Capacités fonctionnelles) :
${payload.safeObservations}

RÉSULTATS DES TESTS (Mesures chiffrées) :
${payload.scoresRaw}

TÂCHE : Agis comme un expert clinique. Croise les observations et les scores pour rédiger le diagnostic fonctionnel.
Rédige 3 sections JSON (Le contenu des valeurs doit être du texte MARKDOWN, aéré) :

1. "synthese_diagnostic" : L'analyse clinique finale.
   - **Analyse des Capacités** : Moteur, Cognitif, Sensoriel. Fais le lien avec les résultats des tests.
   - **Analyse de la Participation** : Impact concret sur la vie quotidienne (ex: "Le déficit de préhension limite la préparation des repas").
   - Conclus sur le niveau d'autonomie global.

2. "recommandations" : Liste des préconisations.
   - Format : Liste à puces avec tirets "-".
   - Thèmes : Aides techniques (ex: barre d'appui, couverts adaptés), Aménagement du logement, Conseils aux aidants, Ergonomie au travail.

3. "objectifs_generaux" :
   - **PROJET D'INTERVENTION** : 
     - Liste 3-4 objectifs centrés sur l'occupation (ex: "Pouvoir se doucher seul en sécurité", "Reprendre la conduite").
     - Indique si un suivi en ergothérapie est nécessaire ou si des conseils ponctuels suffisent.
`;

            } else {
                // === MODE PÉDIATRIQUE (Legacy intact) ===
                promptBio = `
${SECURITY_INSTRUCTION}

CONTEXTE ENFANT : ${payload.childContext}

DONNÉES BRUTES (Questionnaire Famille & École) :
${payload.safeQuestionnaire}

TÂCHE : Rédige les 3 sections suivantes au format JSON :

1. "mandat_referencement" : Une phrase simple et formelle.
   - Structure imposée : "{{PATIENT_PRENOM}} est reçu(e) en consultation d’ergothérapie à la demande de {{MEDECIN}} (ou famille) afin d’évaluer [Insérer ici le motif principal reformulé cliniquement]."

2. "mandat_evaluation" : Un paragraphe décrivant la plainte principale et son impact scolaire/quotidien.
   - Style : Décris la gêne fonctionnelle (illisibilité, lenteur, douleur, agitation) et le contexte scolaire de manière claire pour les parents.

3. "profil_occupationnel" : Une synthèse complète de la vie de l'enfant (Hors résultats des tests).
   - Structure : Rédige 3 ou 4 paragraphes thématiques fluides.
   - Thèmes : Développement, Autonomie (repas, habillage, sommeil), Vie scolaire (classe, AESH, comportement), Loisirs/Intérêts.
   - Important : Mentionne toujours les points forts ou "compétences préservées" et les intérêts de l'enfant.
`;

                promptDiag = `
${SECURITY_INSTRUCTION}

CONTEXTE ÉTABLI (Profil) : (Sera injecté via contexte précédent ou implicite)

OBSERVATIONS CLINIQUES (Signes d'appel - Step 3) :
${payload.safeObservations}

RÉSULTATS DES TESTS (Preuves chiffrées - Step 2) :
${payload.scoresRaw}

TÂCHE : Agis comme un expert clinique qui explique à des parents. Croise les observations et les scores pour rédiger le diagnostic.
Rédige 3 sections JSON (Le contenu des valeurs doit être du texte MARKDOWN, aéré) :

1. "synthese_diagnostic" : L'analyse clinique finale.
   - **Analyse Sensorielle (Si pertinent)** : Explique l'impact des particularités sensorielles sur la vie quotidienne (ex: bruit -> fatigue).
   - **Analyse Instrumentale vs Exécutive** : Explique si les échecs viennent d'un manque de capacité (moteur/visuel) ou d'une gestion comportementale (précipitation, attention).
   - **Axes classiques** : Moteur, Visuo-Spatial, Graphisme. Fais toujours le lien Causal (Score -> Gêne scolaire).
   - Conclus sur la fatigabilité et l'impact général.

2. "recommandations" : Liste des adaptations scolaires et à la maison.
   - Format : Liste à puces avec tirets "-".
   - Sois concret et actionnable pour l'enseignant (ex: "Photocopies", "Limiter la quantité d'écrit", "Placer au premier rang").

3. "objectifs_generaux" :
   - **DECISION THÉRAPEUTIQUE** : Analyse la sévérité globale.
     - CAS A (Trouble avéré, impact fort) : "Un accompagnement en ergothérapie est préconisé." -> Liste 3-4 objectifs SMART simples (ex: "Améliorer la lisibilité pour être relu par l'enseignant").
     - CAS B (Fragilités, compensé, ou léger) : "Un accompagnement régulier n'est pas indiqué ce jour. La mise en place d'adaptations est recommandée." -> Liste les points de vigilance.
`;
            }

            // --- EXÉCUTION ---
            
            // ÉTAPE 1 : PROFIL
            Logger.debug('AI', 'Sending BIO Prompt to Gemini', { model, promptLength: promptBio.length });
            
            const bioResponse = await ai.models.generateContent({ 
                model, 
                contents: promptBio, 
                config: { 
                    responseMimeType: "application/json",
                    systemInstruction: activeSystemPrompt
                } 
            });
            
            Logger.debug('AI', 'Received BIO Response', bioResponse.text?.substring(0, 100) + '...');
            const jsonBio = cleanAndParseJson(bioResponse.text);

            // Injecter le profil généré dans le prompt Diag pour le contexte
            promptDiag = promptDiag.replace("CONTEXTE ÉTABLI (Profil) :", `CONTEXTE ÉTABLI (Profil) : ${JSON.stringify(jsonBio.profil_occupationnel)}`);

            // ÉTAPE 2 : DIAGNOSTIC
            Logger.debug('AI', 'Sending DIAG Prompt to Gemini');
            const diagResponse = await ai.models.generateContent({ 
                model, 
                contents: promptDiag, 
                config: { 
                    responseMimeType: "application/json",
                    systemInstruction: activeSystemPrompt
                } 
            });
            const jsonDiag = cleanAndParseJson(diagResponse.text);

            Logger.info('AI', 'Generation completed successfully. Hydrating templates.');

            // Mapping des résultats (Identique pour les deux modes, le contenu changera juste de sens)
            return [
                { id: 'mandat_ref', title: 'Mandat de référencement', content: hydrateReport(jsonBio.mandat_referencement || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'mandat_eval', title: "Motif de l'évaluation", content: hydrateReport(jsonBio.mandat_evaluation || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'profil', title: 'Profil occupationnel', content: hydrateReport(jsonBio.profil_occupationnel || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'diagnostic', title: 'Synthèse Clinique', content: hydrateReport(jsonDiag.synthese_diagnostic || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'recommandations', title: isAdult ? 'Préconisations & Aides Techniques' : 'Recommandations Pédagogiques', content: hydrateReport(jsonDiag.recommandations || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'objectifs', title: 'Projet d\'Intervention', content: hydrateReport(jsonDiag.objectifs_generaux || "Non généré.", patient), status: 'draft', isAiGenerated: true },
            ];
        };

        // --- TIMEOUT WRAPPER ---
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error("TIMEOUT_AI"));
            }, TIMEOUT_MS);
        });

        try {
            // Course entre l'IA et le Timeout
            const result = await Promise.race([callAI(), timeoutPromise]);
            return result as any[];
        } catch (e: any) {
            Logger.error('AI', 'Generation failed', e);
            if (e.message === "TIMEOUT_AI") {
                throw new Error("Le serveur IA met trop de temps à répondre. Veuillez réessayer plus tard.");
            }
            throw e; 
        }
    }
};
