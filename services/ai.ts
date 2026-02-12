
import { callAIProxy } from './aiProxy';
import { SubscriptionService } from './subscription';
import { supabase } from './db';
import { cleanAndParseJson } from '../utils/aiHelpers';
import { Patient, ClinicalSynthesis, GeneratedReportSection } from '../types';
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

// --- 2. PROMPTS ADULTE ---

const SYS_PROMPT_ADULT = `Tu es un Ergothérapeute Expert en réadaptation adulte et maintien à domicile. Ton rôle est de rédiger des bilans cliniques axés sur l'autonomie et la qualité de vie.

TES RÈGLES D'OR (Non négociables) :
1. **Approche Fonctionnelle** : Centre ton analyse sur les habitudes de vie (Soins personnels, Travail, Loisirs, Conduite). Le jargon médical doit servir à expliquer une limitation d'activité.
2. **Vulgarisation & Respect** : Le rapport est lu par le patient, sa famille et les médecins. Adopte un ton adulte, respectueux et collaboratif.
3. **Sécurité & Prévention** : Identifie clairement les risques (Chutes, Oublis, Épuisement de l'aidant) et propose des solutions concrètes (Aides techniques, Aménagement du logement).
4. **Objectivité** : Base tes conclusions sur les observations et les scores.
5. **Mise en page** : Aère le texte. Utilise des tirets simples "-".
6. **Format** : Réponds toujours en JSON valide strict.`;

const SECURITY_INSTRUCTION = `RÈGLE DE SÉCURITÉ : Tu ne dois JAMAIS modifier, supprimer ou inventer les placeholders anonymisés (ex: {{PATIENT_PRENOM}}, {{ECOLE}}). Ils doivent rester intacts dans le texte généré.`;

// --- AI Response JSON shapes ---
interface BioResponse {
    mandat_referencement?: string;
    mandat_evaluation?: string;
    profil_occupationnel?: string;
}

interface DiagResponse {
    synthese_diagnostic?: string;
    recommandations?: string;
    objectifs_generaux?: string;
}



export interface GenerationPayload {
    safeQuestionnaire: string;
    safeObservations: string;
    scoresRaw: string;
    childContext: string;
    synthesis: ClinicalSynthesis; // Ajout des intentions
}

const getAgeYears = (ageStr: string): number => {
    const match = ageStr.match(/(\d+)\s*(?:ans|yrs|years)?/i);
    if (ageStr.toLowerCase().includes('mois') && !ageStr.toLowerCase().includes('ans')) return 0;
    return match ? parseInt(match[1], 10) : 0;
};

export const AIService = {
    
    generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<GeneratedReportSection[]> => {
        
        Logger.info('AI', 'Starting report generation process', { patientId: patient.id });

        const ageYears = getAgeYears(patient.age);
        const isAdult = ageYears >= 20;
        const activeSystemPrompt = isAdult ? SYS_PROMPT_ADULT : SYS_PROMPT_PEDIATRIC;
        
        // NOTE: Credit consumption is enforced SERVER-SIDE in the Edge Function.
        // The first AI call consumes 1 credit and returns a generationId.
        // The second call reuses that generationId (no additional credit consumed).
        // On total failure, the client refunds via SubscriptionService.
        Logger.debug('AI', 'Starting AI generation (credits enforced server-side)...');

        let sessionGenerationId: string | null = null;

        const callAI = async (): Promise<GeneratedReportSection[]> => {
            
            // --- STEP 1: BIO (consumes 1 credit, returns generationId) ---
            let promptBio = '';
            if (isAdult) {
                promptBio = `
${SECURITY_INSTRUCTION}
CONTEXTE PATIENT : ${payload.childContext} (Adulte)
DONNÉES BRUTES : ${payload.safeQuestionnaire}
TÂCHE : Rédige "mandat_referencement", "mandat_evaluation", "profil_occupationnel" (JSON).
`;
            } else {
                promptBio = `
${SECURITY_INSTRUCTION}
CONTEXTE ENFANT : ${payload.childContext}
DONNÉES BRUTES : ${payload.safeQuestionnaire}
TÂCHE : Rédige "mandat_referencement", "mandat_evaluation", "profil_occupationnel" (JSON).
`;
            }

            const bioResponse = await callAIProxy({
                contents: promptBio,
                responseMimeType: "application/json",
                systemInstruction: activeSystemPrompt
            });
            // Capture the generation session ID from first call
            sessionGenerationId = bioResponse.generationId ?? null;
            const jsonBio = cleanAndParseJson(bioResponse.text) as BioResponse | null;

            // --- STEP 2: DIAGNOSTIC (reuses generation session — no new credit) ---
            const profilContext = JSON.stringify(jsonBio?.profil_occupationnel || "Non disponible");
            
            // Construction de la Directive Diagnostique
            let diagnosticDirective = "";
            if (payload.synthesis.diagnosticInput && payload.synthesis.diagnosticInput.length > 5) {
                diagnosticDirective = `IMPORTANT : Le praticien a POSÉ le diagnostic suivant : "${payload.synthesis.diagnosticInput}". Ta tâche est de rédiger la synthèse clinique en JUSTIFIANT ce diagnostic par les scores et observations fournis. Ne contredis pas ce diagnostic.`;
            } else {
                diagnosticDirective = "Tu dois DÉDUIRE le diagnostic et la synthèse à partir des scores et observations.";
            }

            let recoDirective = "";
            if (payload.synthesis.recommendationsInput && payload.synthesis.recommendationsInput.length > 5) {
                recoDirective = `Le praticien propose le projet suivant : "${payload.synthesis.recommendationsInput}". Intègre et structure ces éléments dans les sections recommandations et objectifs.`;
            }

            const promptDiag = `
${SECURITY_INSTRUCTION}

CONTEXTE ÉTABLI : ${profilContext}
OBSERVATIONS CLINIQUES : ${payload.safeObservations}
RÉSULTATS TESTS : ${payload.scoresRaw}

${diagnosticDirective}
${recoDirective}

TÂCHE : Rédige 3 sections JSON (Markdown string values) :
1. "synthese_diagnostic" : Analyse clinique, lien Scores <-> Impact Vie Quotidienne.
2. "recommandations" : Conseils concrets.
3. "objectifs_generaux" : Projet d'intervention.
`;

            const diagResponse = await callAIProxy({
                contents: promptDiag,
                responseMimeType: "application/json",
                systemInstruction: activeSystemPrompt,
                generationId: sessionGenerationId ?? undefined,
            });
            const jsonDiag = cleanAndParseJson(diagResponse.text) as DiagResponse | null;

            return [
                { id: 'mandat_ref', title: 'Mandat de référencement', content: hydrateReport(jsonBio?.mandat_referencement || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
                { id: 'mandat_eval', title: "Motif de l'évaluation", content: hydrateReport(jsonBio?.mandat_evaluation || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
                { id: 'profil', title: 'Profil occupationnel', content: hydrateReport(jsonBio?.profil_occupationnel || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
                { id: 'diagnostic', title: 'Synthèse Clinique', content: hydrateReport(jsonDiag?.synthese_diagnostic || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
                { id: 'recommandations', title: isAdult ? 'Préconisations' : 'Recommandations Pédagogiques', content: hydrateReport(jsonDiag?.recommandations || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
                { id: 'objectifs', title: 'Projet d\'Intervention', content: hydrateReport(jsonDiag?.objectifs_generaux || "Non généré.", patient), status: 'draft' as const, isAiGenerated: true as const },
            ];
        };

        try {
            const result = await callAI();
            // Mark generation as completed after both AI calls succeeded
            if (sessionGenerationId) {
                const genId = sessionGenerationId; // capture for async closure
                (async () => {
                    try {
                        const { error } = await supabase.from('generation_log')
                            .update({ status: 'completed' })
                            .eq('id', genId);
                        if (error) Logger.warn('AI', 'Failed to mark generation completed', error);
                        else Logger.debug('AI', 'Generation marked completed', genId);
                    } catch (e) {
                        Logger.warn('AI', 'Exception marking generation completed', e);
                    }
                })();
            }
            return result;
        } catch (e: unknown) {
            Logger.error('AI', 'Generation failed', e);
            // Refund credit if we had a session (still 'consumed' since we never marked 'completed')
            if (sessionGenerationId) {
                await SubscriptionService.refundCredit(sessionGenerationId).catch(() => {});
            }
            throw e;
        }
    }
};