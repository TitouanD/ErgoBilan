
import { GoogleGenAI } from "@google/genai";
import { SubscriptionService } from './subscription';
import { cleanAndParseJson } from '../utils/aiHelpers';
import { Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';

// --- CONFIGURATION EXPERTE V2 ---

// 1. Le "Cerveau" Clinique (Persona & Règles)
const SYSTEM_INSTRUCTION = `Tu es un Ergothérapeute Expert en pédiatrie (Modèle PPH/MOH). Ton rôle est de rédiger des bilans cliniques de haute précision.

TES RÈGLES D'OR (Non négociables) :
1. **Vocabulaire Expert** : Utilise 'restriction de participation', 'coût cognitif', 'efficience', 'ressources attentionnelles', 'compétences préservées', 'impact fonctionnel', 'hypersensibilité'.
2. **Discernement Thérapeutique (CRITIQUE)** : Ne prescris pas de rééducation systématiquement. 
   - Si les scores sont dans la norme basse (-1 ET) ou si les difficultés sont fonctionnellement compensées, oriente vers des 'Adaptations' ou une 'Guidance' plutôt qu'un suivi.
   - Ne pathologise pas tout : valorise les stratégies de compensation de l'enfant.
3. **Nuance Comportementale** : Distingue le trouble instrumental (l'enfant ne *sait pas* faire) du trouble exécutif/comportemental (l'enfant *va trop vite*, est impulsif ou inattentif). Note si l'échec est dû à la "Performance" plutôt qu'à la "Compétence".
4. **Causalité** : Utilise les scores comme PREUVES (ex: "L'écriture est lente, *objectivé par un score de -2ET au BHK*").
5. **Mise en page** : 
   - Aère le texte (double saut de ligne entre paragraphes).
   - Utilise des tirets simples "-" pour les listes.
   - Pas de listes à puces dans les paragraphes narratifs.
6. **Format** : Réponds toujours en JSON valide strict.`;

// 2. Sécurité des Données
const SECURITY_INSTRUCTION = `RÈGLE DE SÉCURITÉ : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymisés (ex: {{PATIENT_PRENOM}}, {{ECOLE}}). Ils doivent rester intacts dans le texte généré.`;

const TIMEOUT_MS = 90000; // 90 secondes max avant timeout forcé

export interface GenerationPayload {
    safeQuestionnaire: string;
    safeObservations: string;
    scoresRaw: string;
    childContext: string;
}

export const AIService = {
    
    /**
     * Génère le rapport complet en une ou plusieurs passes selon la complexité.
     * Inclut un Timeout de sécurité.
     */
    generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<any[]> => {
        
        // 1. Vérification & Consommation Crédit
        const hasCredit = await SubscriptionService.consumeCredit();
        if (!hasCredit) {
            throw new Error("CREDIT_INSUFFICIENT");
        }

        // 2. Appel IA avec Timeout Race
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 
        const model = 'gemini-3-flash-preview'; 

        const callAI = async () => {
            // --- ÉTAPE 1 : CONTEXTUALISATION & PROFIL ---
            const promptBio = `
${SECURITY_INSTRUCTION}

CONTEXTE ENFANT : ${payload.childContext}

DONNÉES BRUTES (Questionnaire Famille & École) :
${payload.safeQuestionnaire}

TÂCHE : Rédige les 3 sections suivantes au format JSON :

1. "mandat_referencement" : Une phrase simple et formelle.
   - Structure imposée : "{{PATIENT_PRENOM}} est reçu(e) en consultation d’ergothérapie à la demande de {{MEDECIN}} (ou famille) afin d’évaluer [Insérer ici le motif principal reformulé cliniquement]."

2. "mandat_evaluation" : Un paragraphe décrivant la plainte principale et son impact scolaire/quotidien.
   - Style : Décris la gêne fonctionnelle (illisibilité, lenteur, douleur, agitation) et le contexte scolaire.

3. "profil_occupationnel" : Une synthèse complète de la vie de l'enfant (Hors résultats des tests).
   - Structure : Rédige 3 ou 4 paragraphes thématiques fluides.
   - Thèmes : Développement, Autonomie (repas, habillage, sommeil), Vie scolaire (classe, AESH, comportement), Loisirs/Intérêts.
   - Important : Mentionne toujours les points forts ou "compétences préservées" et les intérêts de l'enfant.
`;
            
            const bioResponse = await ai.models.generateContent({ 
                model, 
                contents: promptBio, 
                config: { 
                    responseMimeType: "application/json",
                    systemInstruction: SYSTEM_INSTRUCTION
                } 
            });
            const jsonBio = cleanAndParseJson(bioResponse.text);

            // --- ÉTAPE 2 : DIAGNOSTIC & PRÉCONISATIONS ---
            const promptDiag = `
${SECURITY_INSTRUCTION}

CONTEXTE ÉTABLI (Profil) : ${JSON.stringify(jsonBio.profil_occupationnel)}

OBSERVATIONS CLINIQUES (Signes d'appel - Step 3) :
${payload.safeObservations}

RÉSULTATS DES TESTS (Preuves chiffrées - Step 2) :
${payload.scoresRaw}

TÂCHE : Agis comme un expert clinique. Croise les observations et les scores pour rédiger le diagnostic.
Rédige 3 sections JSON (Le contenu des valeurs doit être du texte MARKDOWN, aéré) :

1. "synthese_diagnostic" : L'analyse clinique finale.
   - **Analyse Sensorielle (Si pertinent)** : Si des données sensorielles (Dunn 2, hypersensibilité, recherche, évitement, bruit) sont présentes, rédige un paragraphe dédié analysant l'impact sur la vie quotidienne et la régulation émotionnelle.
   - **Analyse Instrumentale vs Exécutive** : Analyse si les échecs sont dus à un déficit de capacité (moteur/visuel) ou à des facteurs comportementaux (précipitation, impulsivité, attention).
   - **Axes classiques** : Moteur/Praxique, Visuo-Spatial, Graphomoteur. Fais le lien Causal (Score -> Gêne).
   - Conclus sur le coût cognitif global et la fatigabilité.

2. "recommandations" : Liste des adaptations scolaires et à la maison.
   - Format : Liste à puces avec tirets "-".
   - Inclus des conseils sensoriels si nécessaire (casque, pauses, refuges).
   - Exemples : Tiers-temps, ordinateur, photocopies, limitation de la copie.

3. "objectifs_generaux" :
   - **DECISION THÉRAPEUTIQUE** : Analyse la sévérité globale.
     - CAS A (Trouble avéré, impact fort) : "Un accompagnement en ergothérapie est préconisé." -> Liste 3-4 objectifs SMART (ex: "Améliorer la qualité du tracé", "Automatiser la frappe").
     - CAS B (Fragilités, compensé, ou léger) : "Un accompagnement régulier n'est pas indiqué ce jour. La mise en place d'adaptations est recommandée." -> Liste les points de vigilance ou propose une guidance ponctuelle.
`;
            
            const diagResponse = await ai.models.generateContent({ 
                model, 
                contents: promptDiag, 
                config: { 
                    responseMimeType: "application/json",
                    systemInstruction: SYSTEM_INSTRUCTION
                } 
            });
            const jsonDiag = cleanAndParseJson(diagResponse.text);

            return [
                { id: 'mandat_ref', title: 'Mandat de référencement', content: hydrateReport(jsonBio.mandat_referencement || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'mandat_eval', title: 'Mandat d\'évaluation', content: hydrateReport(jsonBio.mandat_evaluation || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'profil', title: 'Profil occupationnel', content: hydrateReport(jsonBio.profil_occupationnel || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'diagnostic', title: 'Diagnostic en ergothérapie', content: hydrateReport(jsonDiag.synthese_diagnostic || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'recommandations', title: 'Recommandations pédagogiques', content: hydrateReport(jsonDiag.recommandations || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'objectifs', title: 'Objectifs & Projet Thérapeutique', content: hydrateReport(jsonDiag.objectifs_generaux || "Non généré.", patient), status: 'draft', isAiGenerated: true },
            ];
        };

        // --- TIMEOUT WRAPPER ---
        // Empêche le chargement infini si l'API ne répond pas
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
            console.error("AI Service Error:", e);
            if (e.message === "TIMEOUT_AI") {
                throw new Error("Le serveur IA met trop de temps à répondre. Veuillez réessayer plus tard.");
            }
            throw e; // Relancer les autres erreurs (crédits, etc)
        }
    }
};
