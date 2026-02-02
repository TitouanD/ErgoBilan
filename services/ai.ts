
import { GoogleGenAI } from "@google/genai";
import { SubscriptionService } from './subscription';
import { cleanAndParseJson } from '../utils/aiHelpers';
import { Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';

// --- PROMPT DE SÉCURITÉ ---
const SECURITY_INSTRUCTION = `RÈGLE CRITIQUE : placeholders {{PATIENT_PRENOM}} intacts.`;

export interface GenerationPayload {
    safeQuestionnaire: string;
    safeObservations: string;
    scoresRaw: string;
    childContext: string;
}

export const AIService = {
    
    /**
     * Génère le rapport complet.
     * Vérifie les crédits CÔTÉ SERVEUR (via SubscriptionService RPC) avant d'appeler l'IA.
     */
    generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<any[]> => {
        
        // 1. Vérification & Consommation Crédit
        const hasCredit = await SubscriptionService.consumeCredit();
        if (!hasCredit) {
            throw new Error("CREDIT_INSUFFICIENT");
        }

        // 2. Appel IA (Si crédit validé)
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 
        const model = 'gemini-3-flash-preview'; 

        try {
            // Étape 1 : Profil
            const promptBio = `${SECURITY_INSTRUCTION}\nAgis comme un Ergothérapeute.\nRédige 3 sections JSON : "mandat_referencement", "mandat_evaluation", "profil_occupationnel".\nDonnées: ${payload.safeQuestionnaire} ${payload.childContext}`;
            
            const bioResponse = await ai.models.generateContent({ 
                model, 
                contents: promptBio, 
                config: { responseMimeType: "application/json" } 
            });
            const jsonBio = cleanAndParseJson(bioResponse.text);

            // Étape 2 : Diagnostic
            const promptDiag = `${SECURITY_INSTRUCTION}\nAgis comme un Ergothérapeute.\nRédige 3 sections JSON (Markdown) : "synthese_diagnostic", "objectifs_generaux", "recommandations".\nSource: ${JSON.stringify(jsonBio.profil_occupationnel)}, Obs: ${payload.safeObservations}, Scores: ${payload.scoresRaw}`;
            
            const diagResponse = await ai.models.generateContent({ 
                model, 
                contents: promptDiag, 
                config: { responseMimeType: "application/json" } 
            });
            const jsonDiag = cleanAndParseJson(diagResponse.text);

            // 3. Hydratation & Formatting
            return [
                { id: 'mandat_ref', title: 'Mandat de référencement', content: hydrateReport(jsonBio.mandat_referencement || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'mandat_eval', title: 'Mandat d\'évaluation', content: hydrateReport(jsonBio.mandat_evaluation || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'profil', title: 'Profil occupationnel', content: hydrateReport(jsonBio.profil_occupationnel || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'diagnostic', title: 'DIAGNOSTIC EN ERGOTHERAPIE', content: hydrateReport(jsonDiag.synthese_diagnostic || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'objectifs', title: 'LES OBJECTIFS GENERAUX', content: hydrateReport(jsonDiag.objectifs_generaux || "Non généré.", patient), status: 'draft', isAiGenerated: true },
                { id: 'recommandations', title: 'RECOMMANDATIONS', content: hydrateReport(jsonDiag.recommandations || "Non généré.", patient), status: 'draft', isAiGenerated: true }
            ];

        } catch (e) {
            console.error("AI Generation Error:", e);
            throw new Error("GENERATION_FAILED");
        }
    }
};
