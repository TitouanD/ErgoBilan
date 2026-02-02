
import { Patient, ScoreResult, AnonymousTestContribution } from '../types';

export const calculateAgeInMonths = (dob: string): number => {
    if (!dob) return 0;
    const birth = new Date(dob);
    const now = new Date();
    const years = now.getFullYear() - birth.getFullYear();
    const months = now.getMonth() - birth.getMonth();
    return (years * 12) + months;
};

/**
 * Prépare le payload pour le "Crowdsourcing Lab".
 * Supprime toute clé étrangère vers le patient.
 * Convertit DOB en âge précis (mois).
 */
export const createAnonymousPayload = (
    patient: Patient, 
    testId: string, 
    subtestId: string, 
    result: ScoreResult
): AnonymousTestContribution | null => {
    
    // Safety check : On n'envoie que des données valides et complètes
    if (!result.raw || !result.standard || !patient.dob) return null;

    return {
        testId,
        subtestId,
        ageInMonths: calculateAgeInMonths(patient.dob),
        gender: (patient.gender === 'M' || patient.gender === 'F') ? patient.gender : 'Other',
        rawScore: parseFloat(result.raw) || 0,
        standardScore: parseFloat(result.standard) || 0,
        percentile: parseFloat(result.percentile) || 0,
        zScore: result.zScore,
        timestamp: new Date().toISOString()
    };
};

/**
 * Envoi réel des données anonymisées vers la file d'attente (via Supabase dans le composant appelant)
 * Cette fonction mockée n'est plus utilisée directement, remplacée par AdminService ou appels directs.
 * On la garde pour la logique métier pure si besoin.
 */
export const apiContributeAnonymousData = async (payload: AnonymousTestContribution) => {
    // Placeholder pour future implémentation directe si besoin hors composant
    console.log("Contribution prête:", payload);
};
