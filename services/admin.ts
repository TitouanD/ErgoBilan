
import { supabase } from './db';
import { Contribution, TestData, Patient } from '../types';
import { Logger } from '../utils/logger';

/**
 * Service dédié aux opérations Administrateur.
 * Gère la promotion des contributions (JSON) vers le catalogue officiel (SQL Relational).
 */
export const AdminService = {

    /**
     * Récupère la file d'attente des contributions
     */
    getPendingContributions: async () => {
        const { data, error } = await supabase
            .from('contributions_queue')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Parsing robuste du JSON (Gère string, string-in-string, et object)
        return data.map((item: any) => {
            let parsed: any = {};
            try {
                if (typeof item.raw_data_json === 'string') {
                    // Premier parse
                    parsed = JSON.parse(item.raw_data_json);
                    // Si c'est encore une string (double serialization fréquente avec les CSV/SQL inserts manuels)
                    if (typeof parsed === 'string') {
                        parsed = JSON.parse(parsed);
                    }
                } else if (typeof item.raw_data_json === 'object' && item.raw_data_json !== null) {
                    parsed = item.raw_data_json;
                }
            } catch (e) {
                Logger.error('SYSTEM', `Erreur JSON pour contribution ${item.id}:`, e);
                // On garde un objet vide pour ne pas crasher l'UI, l'ID permettra de l'identifier
            }
            
            return {
                ...parsed,
                id: item.id, // L'ID SQL est prioritaire sur celui du JSON
                submittedAt: item.created_at,
                // Fallback si le JSON est cassé
                testName: parsed.testName || "Test Sans Nom (Erreur Format)",
                userName: parsed.userName || "Inconnu",
                rows: parsed.rows || []
            } as Contribution;
        });
    },

    /**
     * Rejeter une contribution
     */
    rejectContribution: async (id: string) => {
        const { error } = await supabase
            .from('contributions_queue')
            .update({ status: 'rejected' })
            .eq('id', id);
        if (error) throw error;
    },

    /**
     * Valider et Intégrer une contribution dans le catalogue officiel
     * C'est ici que la magie opère : JSON -> SQL Relationnel
     * Amélioré pour gérer l'idempotence (évite les doublons si on re-valide).
     */
    integrateContribution: async (contribution: Contribution) => {
        
        // 1. Création ou Récupération du Test (Évite conflit unique constraint sur 'name')
        let testId = `test_${contribution.testName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
        
        // On vérifie d'abord s'il existe déjà
        const { data: existingTest } = await supabase
            .from('official_tests')
            .select('id')
            .ilike('name', contribution.testName)
            .maybeSingle();

        if (existingTest) {
            testId = existingTest.id;
            Logger.info('DB', `Test existant trouvé (${testId}), ajout des données à ce test.`);
        } else {
            const { error: testError } = await supabase
                .from('official_tests')
                .insert({
                    id: testId,
                    name: contribution.testName,
                    author: contribution.userName, 
                    version: '1.0',
                    category_id: 'community' 
                });

            if (testError) throw new Error(`Erreur création Test: ${testError.message}`);
        }

        // 2. Groupement des lignes par Sous-test
        const rowsBySubtest: Record<string, typeof contribution.rows> = {};
        contribution.rows.forEach(row => {
            const subKey = row.subtest || "Global";
            if (!rowsBySubtest[subKey]) rowsBySubtest[subKey] = [];
            rowsBySubtest[subKey].push(row);
        });

        // 3. Création des Sous-tests et des Normes
        for (const [subtestName, rows] of Object.entries(rowsBySubtest)) {
            // ID déterministe pour permettre l'upsert
            const subtestSlug = subtestName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            const subtestId = `${testId}_${subtestSlug}`;
            
            // A. Insert/Update Subtest
            const { error: subError } = await supabase
                .from('official_subtests')
                .upsert({
                    id: subtestId,
                    test_id: testId,
                    name: subtestName,
                    unit: 'pts', 
                    score_type: 'standard', // Pourrait être déduit des données
                    computation_mode: contribution.structureType || 'LOOKUP' // ICI : Utilisation du type détecté
                }, { onConflict: 'id' });
            
            if (subError) Logger.error('DB', `Erreur Subtest ${subtestName}:`, subError);

            // B. Insert Norms
            // On génère des IDs uniques basés sur le temps pour éviter les conflits si on re-importe
            const normsPayload = rows.map((row, idx) => {
                const ageMatch = row.label.match(/(\d+)/); 
                const ageYear = ageMatch ? parseInt(ageMatch[1]) : 0;
                
                // MAPPING CONDITIONNEL CRITIQUE
                let mean = null;
                let sd = null;
                let rawMin = 0;
                let rawMax = 0;

                if (contribution.structureType === 'PARAMETRIC') {
                    // Si paramétrique, on utilise les champs mean/sd
                    mean = parseFloat(row.mean || row.raw); // Fallback row.raw pour rétro-compatibilité
                    sd = parseFloat(row.sd || row.zScore);  // Fallback row.zScore pour rétro-compatibilité
                } else {
                    // Si Lookup, on utilise raw
                    rawMin = parseFloat(row.raw) || 0;
                    rawMax = parseFloat(row.raw) || 0; // Si range "10-12", parsing à affiner plus tard
                }

                return {
                    id: `${subtestId}_norm_${Date.now()}_${idx}`,
                    subtest_id: subtestId,
                    age_min_months: ageYear * 12, 
                    age_max_months: (ageYear * 12) + 11,
                    gender: 'Mixed',
                    // Valeurs conditionnelles
                    raw_min: rawMin,
                    raw_max: rawMax,
                    mean: mean,
                    sd: sd,
                    // Scores standards (seulement pour Lookup, sinon calculés à la volée)
                    standard_score: contribution.structureType === 'LOOKUP' ? (parseFloat(row.standard) || null) : null,
                    percentile: contribution.structureType === 'LOOKUP' ? (parseFloat(row.percentile) || null) : null,
                    z_score: contribution.structureType === 'LOOKUP' ? (parseFloat(row.zScore) || null) : null
                };
            });

            if (normsPayload.length > 0) {
                const { error: normsError } = await supabase
                    .from('official_norms')
                    .insert(normsPayload);
                
                if (normsError) Logger.error('DB', "Erreur insertion normes", normsError);
            }
        }

        // 4. Marquer la contribution comme validée
        const { error: finalError } = await supabase
            .from('contributions_queue')
            .update({ status: 'validated' })
            .eq('id', contribution.id);

        if (finalError) throw finalError;
    },

    /**
     * MODULE C : Télémétrie Passive & Anonyme
     * Extrait les scores validés, calcule l'âge en mois, et les envoie pour statistiques.
     * Cette fonction est conçue pour ne jamais bloquer l'interface (Fire & Forget).
     */
    logAnonymousStats: async (tests: TestData, patient: Patient) => {
        try {
            // 1. Calcul Age en mois précis
            if (!patient.dob) return;
            const birthDate = new Date(patient.dob);
            const now = new Date();
            // Calcul approximatif suffisant pour des stats globales
            const ageMonths = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());

            if (ageMonths < 0) return; // Date futuriste ou invalide

            const payload: any[] = [];
            const sessionHash = 'anon_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

            // 2. Extraction des scores validés uniquement
            for (const [testId, subtests] of Object.entries(tests)) {
                for (const [subtestId, result] of Object.entries(subtests)) {
                    if (result.status === 'validated' && result.raw) {
                        // Nettoyage valeur brute (on ne garde que le numérique pour l'instant)
                        // Exemple: "12 pts" -> 12
                        const rawVal = parseFloat(result.raw.replace(',', '.').replace(/[^0-9.-]/g, ''));
                        
                        if (!isNaN(rawVal)) {
                            payload.push({
                                test_id: testId,
                                subtest_id: subtestId,
                                age_months: ageMonths,
                                gender: patient.gender || 'Mixed',
                                raw_score: rawVal,
                                computed_standard: result.standard ? parseFloat(result.standard) : null,
                                computed_percentile: result.percentile ? parseFloat(result.percentile) : null,
                                source_hash: sessionHash, // Permet de grouper les lignes d'un même patient anonyme
                                is_clinical: true
                            });
                        }
                    }
                }
            }

            if (payload.length > 0) {
                // Fire & Forget (Pas de await bloquant coté UI, mais on await ici pour le catch)
                const { error } = await supabase.from('contribution_insights').insert(payload);
                if (error) {
                    Logger.warn('DB', "Telemetry insert failed", error.message);
                } else {
                    Logger.info('DB', `Telemetry sent: ${payload.length} data points.`);
                }
            }

        } catch (e) {
            // Sécurité absolue : On ne veut jamais faire planter l'app pour des stats
            Logger.warn('DB', "Telemetry error (Silent)", e);
        }
    }
};
