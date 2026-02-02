
import { GoogleGenAI } from "@google/genai";
import { SubscriptionService } from './subscription';
import { cleanAndParseJson } from '../utils/aiHelpers';
import { Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';

// --- CONFIGURATION EXPERTE ---

// 1. Le "Cerveau" Clinique (Persona & Règles)
const SYSTEM_INSTRUCTION = `Tu es un Ergothérapeute Expert en pédiatrie (Modèle PPH/MOH). Ton rôle est de rédiger des bilans cliniques de haute qualité pour des dossiers médicaux (MDPH) ou scolaires.

TES RÈGLES D'OR (Non négociables) :
1. **Vocabulaire Expert** : Utilise impérativement des termes comme 'restriction de participation', 'coût cognitif', 'efficience', 'ressources attentionnelles', 'compétences préservées', 'impact fonctionnel'.
2. **Ton Clinique** : Sois objectif, précis et bienveillant. Utilise le conditionnel pour les hypothèses. Pas de jargon inutile, mais une terminologie précise.
3. **Structure** :
   - Ne fais JAMAIS de listes à puces pour le 'Profil Occupationnel' ou la 'Synthèse Diagnostique'. Rédige des paragraphes fluides et liés.
   - Les listes à puces sont réservées uniquement aux 'Recommandations' et 'Objectifs'.
4. **Causalité (CRITIQUE)** : Ne répète pas bêtement les scores bruts. Utilise-les comme PREUVES pour justifier tes observations cliniques.
   - *Mauvais* : "Score MABC = 5. L'écriture est sale."
   - *Bon* : "L'écriture présente un coût moteur important, objectivé par une note standard chutée (NS=5) en dextérité manuelle, entraînant une fatigabilité rapide."
5. **Format** : Tu dois toujours répondre en JSON valide strict.`;

// 2. Sécurité des Données
const SECURITY_INSTRUCTION = `RÈGLE DE SÉCURITÉ : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymisés (ex: {{PATIENT_PRENOM}}, {{ECOLE}}). Ils doivent rester intacts dans le texte généré.`;

export interface GenerationPayload {
    safeQuestionnaire: string;
    safeObservations: string;
    scoresRaw: string;
    childContext: string;
}

export const AIService = {
    
    /**
     * Génère le rapport complet en une ou plusieurs passes selon la complexité.
     */
    generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<any[]> => {
        
        // 1. Vérification & Consommation Crédit
        const hasCredit = await SubscriptionService.consumeCredit();
        if (!hasCredit) {
            throw new Error("CREDIT_INSUFFICIENT");
        }

        // 2. Appel IA
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 
        // Utilisation du modèle Pro pour une meilleure capacité de raisonnement clinique complexe
        const model = 'gemini-3-flash-preview'; 

        try {
            // --- ÉTAPE 1 : CONTEXTUALISATION & PROFIL (Partie Narrative) ---
            const promptBio = `
${SECURITY_INSTRUCTION}

CONTEXTE ENFANT : ${payload.childContext}

DONNÉES BRUTES (Questionnaire Famille & École) :
${payload.safeQuestionnaire}

TÂCHE : Rédige les 3 sections suivantes au format JSON :

1. "mandat_referencement" : Une phrase simple et formelle.
   - Structure imposée : "{{PATIENT_PRENOM}} est reçu(e) en consultation d’ergothérapie à la demande du Dr {{MEDECIN}} (ou de la famille/école) afin d’évaluer [Insérer ici le motif principal reformulé cliniquement]."

2. "mandat_evaluation" : Un paragraphe décrivant la plainte principale et son impact scolaire/quotidien.
   - Style : Commence par "A ce jour, {{PATIENT_PRENOM}} rencontre des difficultés dans son environnement...". Décris la gêne fonctionnelle (illisibilité, lenteur, douleur, agitation).

3. "profil_occupationnel" : Une synthèse complète de la vie de l'enfant (Hors résultats des tests).
   - Structure : Rédige 3 ou 4 paragraphes thématiques fluides.
   - Thèmes : Historique médical/développemental, Autonomie (repas, habillage, sommeil), Vie scolaire (classe, AESH, comportement), Loisirs/Intérêts.
   - Important : Mentionne toujours les points forts ou "compétences préservées".
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

            // --- ÉTAPE 2 : DIAGNOSTIC & PRÉCONISATIONS (Partie Analytique) ---
            const promptDiag = `
${SECURITY_INSTRUCTION}

CONTEXTE ÉTABLI (Profil) : ${JSON.stringify(jsonBio.profil_occupationnel)}

OBSERVATIONS CLINIQUES (Signes d'appel - Step 3) :
${payload.safeObservations}

RÉSULTATS DES TESTS (Preuves chiffrées - Step 2) :
${payload.scoresRaw}

TÂCHE : Agis comme un expert clinique. Croise les observations et les scores pour rédiger le diagnostic.
Rédige 3 sections JSON (Le contenu des valeurs doit être du texte MARKDOWN) :

1. "synthese_diagnostic" : L'analyse clinique finale.
   - Structure impérative en 3 axes (adaptés selon les troubles détectés) :
     a) **Sur le plan Moteur & Praxique** : (Coordination, tonus, motricité fine/globale).
     b) **Sur le plan Visuo-Spatial & Perceptif** : (Organisation spatiale, stratégies visuelles).
     c) **Sur le plan Graphomoteur & Exécutif** : (Qualité d'écriture, vitesse, posture, attention, fonctions exécutives).
   - CRUCIAL : Pour chaque axe, fais le lien Causal. "L'observation X (confirmée par le score Y au test Z) entraine la difficulté W".
   - Conclus sur le coût cognitif global et la fatigabilité.

2. "recommandations" : Liste des adaptations scolaires concrètes et réalisables.
   - Format : Liste à puces Markdown.
   - Exemples : Tiers-temps, ordinateur, photocopies, limitation de la copie, supports aérés, outils spécifiques.

3. "objectifs_generaux" :
   - Commence par une phrase positive sur le potentiel et la motivation de l'enfant.
   - Liste 3-4 objectifs de suivi ergonomiques précis (ex: "Améliorer la qualité du tracé", "Automatiser la frappe au clavier", "Soutenir l'attention visuelle").
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

            // 3. Hydratation & Formatting Final
            return [
                { id: 'mandat_ref', title: 'Mandat de référencement', content: hydrateReport(jsonBio.mandat_referencement || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'mandat_eval', title: 'Mandat d\'évaluation', content: hydrateReport(jsonBio.mandat_evaluation || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'profil', title: 'Profil occupationnel', content: hydrateReport(jsonBio.profil_occupationnel || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                
                { id: 'diagnostic', title: 'Diagnostic en ergothérapie', content: hydrateReport(jsonDiag.synthese_diagnostic || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                
                { id: 'recommandations', title: 'Recommandations pédagogiques', content: hydrateReport(jsonDiag.recommandations || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'objectifs', title: 'Objectifs & Projet Thérapeutique', content: hydrateReport(jsonDiag.objectifs_generaux || "Non généré.", patient), status: 'draft', isAiGenerated: true },
            ];

        } catch (e) {
            console.error("AI Generation Error:", e);
            throw new Error("GENERATION_FAILED");
        }
    }
};
