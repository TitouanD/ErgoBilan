
import { Patient } from '../types';

interface AnonymizationResult {
    text: string;
    // On n'a plus besoin de stocker une Map dynamique complexe car on utilise la structure du patient
    // Mais on garde la signature pour compatibilité si besoin, ou on simplifie.
}

// Liste des champs du patient à anonymiser explicitement
// On mappe la clé du patient vers le Placeholder attendu par l'IA
const MAPPING_CONFIG: { field: keyof Patient | 'parentNames', placeholder: string }[] = [
    { field: 'firstName', placeholder: '{{PATIENT_PRENOM}}' },
    { field: 'lastName', placeholder: '{{PATIENT_NOM}}' },
    { field: 'parentNames', placeholder: '{{PARENTS}}' },
    { field: 'address', placeholder: '{{ADRESSE}}' },
    { field: 'parentPhone', placeholder: '{{TELEPHONE}}' },
    { field: 'parentEmail', placeholder: '{{EMAIL}}' },
    { field: 'school', placeholder: '{{ECOLE}}' },
    { field: 'teacher', placeholder: '{{ENSEIGNANT}}' },
    { field: 'prescribingDoctor', placeholder: '{{MEDECIN}}' },
    { field: 'avsDetails', placeholder: '{{AVS_DETAILS}}' },
    { field: 'dob', placeholder: '{{DATE_NAISSANCE}}' },
];

/**
 * Anonymise le texte en remplaçant les valeurs du patient par des placeholders.
 * Algorithme "Search & Swap" trié par longueur de valeur décroissante.
 */
export const anonymizeData = (text: string, patient: Patient): { text: string } => {
    let safeText = text;

    // 1. Construction de la liste des remplacements
    // On inclut aussi le Nom Complet concaténé manuellement pour être sûr
    const replacements: { value: string, placeholder: string }[] = [];

    // Ajout explicite du nom complet (prioritaire car souvent le plus long)
    const fullName = `${patient.firstName} ${patient.lastName}`.trim();
    if (fullName.length > 2) {
        replacements.push({ value: fullName, placeholder: '{{PATIENT_NOM_COMPLET}}' });
    }

    // Ajout des champs unitaires
    MAPPING_CONFIG.forEach(config => {
        const val = patient[config.field as keyof Patient];
        if (typeof val === 'string' && val.trim().length > 1) { // On ignore les valeurs vides ou trop courtes (1 char)
            replacements.push({ value: val.trim(), placeholder: config.placeholder });
        }
    });

    // 2. Tri par longueur décroissante (CRITIQUE pour éviter les remplacements partiels)
    replacements.sort((a, b) => b.value.length - a.value.length);

    // 3. Exécution des remplacements (Case Insensitive pour sécurité)
    replacements.forEach(({ value, placeholder }) => {
        // Echappement des caractères spéciaux pour la regex
        const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Regex globale et insensible à la casse
        const regex = new RegExp(escapedValue, 'gi');
        safeText = safeText.replace(regex, placeholder);
    });

    return { text: safeText };
};

/**
 * Réhydrate le rapport en remettant les vraies valeurs.
 * Gère le nettoyage des placeholders résiduels.
 */
export const hydrateReport = (text: string, patient: Patient): string => {
    let finalReport = text;

    // 1. Reconstruction de la liste de réhydratation
    const replacements: { value: string, placeholder: string }[] = [];
    
    // Nom complet
    replacements.push({ value: `${patient.firstName} ${patient.lastName}`, placeholder: '{{PATIENT_NOM_COMPLET}}' });
    
    // Champs unitaires
    MAPPING_CONFIG.forEach(config => {
        const val = patient[config.field as keyof Patient];
        if (typeof val === 'string') {
             replacements.push({ value: val, placeholder: config.placeholder });
        }
    });

    // 2. Remplacement inverse (Placeholder -> Valeur réelle)
    replacements.forEach(({ value, placeholder }) => {
        // On cherche le placeholder littéralement (avec les accolades)
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPlaceholder, 'g');
        finalReport = finalReport.replace(regex, value);
    });

    // 3. Nettoyage des placeholders résiduels (Erreur LLM ou hallucination)
    // Regex pour trouver tout ce qui ressemble à {{...}}
    finalReport = finalReport.replace(/\{\{[A-Z_]+\}\}/g, "l'enfant");

    return finalReport;
};
