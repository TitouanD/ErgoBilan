
import { supabase } from './db';
import { Contribution, Patient, TestData } from '../types';
import { Logger } from '../utils/logger';

// Données simulées pour le Dashboard Ops
const MOCK_AI_STATS = {
    dailyUsage: [
        { date: '10/01', tokens: 12500, cost: 0.04, errors: 0 },
        { date: '11/01', tokens: 15000, cost: 0.05, errors: 1 },
        { date: '12/01', tokens: 42000, cost: 0.14, errors: 0 },
        { date: '13/01', tokens: 38000, cost: 0.12, errors: 2 },
        { date: '14/01', tokens: 55000, cost: 0.18, errors: 0 },
        { date: '15/01', tokens: 48000, cost: 0.15, errors: 0 },
        { date: '16/01', tokens: 62000, cost: 0.21, errors: 1 },
    ],
    failures: [
        { id: 'err_1', date: '2023-10-13T14:30:00Z', type: 'TIMEOUT_AI', context: 'Anamnèse très longue (> 4000 chars)', user: 'doc.martin@email.com' },
        { id: 'err_2', date: '2023-10-13T16:15:00Z', type: 'INVALID_JSON', context: 'Structure réponse corrompue (Markdown missing)', user: 'ergo.sophie@email.com' },
        { id: 'err_3', date: '2023-10-16T09:10:00Z', type: 'SAFETY_BLOCK', context: 'Contenu potentiellement flaggé par Google', user: 'test.user@email.com' }
    ]
};

/**
 * Service dédié aux opérations Administrateur.
 * ARCHITECTURE "PROMOTION" : Gestion des tests privés (OrganizationID != NULL) vers Public (NULL).
 */
export const AdminService = {

    /**
     * Récupère la liste des tests candidats à la promotion (Tests privés)
     * Utilise la vue SQL dédiée.
     */
    getCandidates: async () => {
        const { data, error } = await supabase
            .from('admin_candidates_promotion')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        return data;
    },

    /**
     * Récupère le détail complet d'un test candidat pour prévisualisation
     * Reconstitue la structure JSON-like pour l'affichage UI
     */
    getCandidateDetails: async (testId: string) => {
        // 1. Fetch Test info
        const { data: test } = await supabase.from('official_tests').select('*').eq('id', testId).single();
        if (!test) throw new Error("Test introuvable");

        // 2. Fetch Subtests
        const { data: subtests } = await supabase.from('official_subtests').select('*').eq('test_id', testId);
        
        // 3. Fetch Norms
        const subtestIds = subtests?.map(s => s.id) || [];
        const { data: norms } = await supabase.from('official_norms').select('*').in('subtest_id', subtestIds);

        // 4. Flatten for UI Preview (Format ExtractedRow like)
        const rows: any[] = [];
        
        subtests?.forEach(sub => {
            const subNorms = norms?.filter(n => n.subtest_id === sub.id) || [];
            subNorms.forEach(norm => {
                // Reconstruction d'un label lisible
                const ageLabel = norm.age_min_months ? `${Math.floor(norm.age_min_months/12)} ans` : 'Global';
                
                rows.push({
                    id: norm.id,
                    subtest: sub.name,
                    label: ageLabel,
                    raw: norm.raw_min === norm.raw_max ? norm.raw_min : `${norm.raw_min}-${norm.raw_max}`,
                    standard: norm.standard_score,
                    percentile: norm.percentile,
                    mean: norm.mean,
                    sd: norm.sd
                });
            });
        });

        return {
            id: test.id,
            testName: test.name,
            author: test.author,
            submittedAt: test.created_at,
            rows: rows
        };
    },

    /**
     * "Rejeter" = Supprimer le test privé de la base
     * (L'utilisateur devra le recréer s'il souhaite corriger)
     */
    deleteTest: async (testId: string) => {
        // Grâce au ON DELETE CASCADE défini en SQL (si présent), supprimer le test suffit.
        // Sinon, on supprime en cascade manuellement par sécurité.
        
        // 1. Récupérer les subtests
        const { data: subtests } = await supabase.from('official_subtests').select('id').eq('test_id', testId);
        const subIds = subtests?.map(s => s.id) || [];

        if (subIds.length > 0) {
            // 2. Delete Norms
            await supabase.from('official_norms').delete().in('subtest_id', subIds);
            // 3. Delete Subtests
            await supabase.from('official_subtests').delete().eq('test_id', testId);
        }
        // 4. Delete Test
        const { error } = await supabase.from('official_tests').delete().eq('id', testId);
        if (error) throw error;
    },

    /**
     * PROMOUVOIR LE TEST (Validé)
     * Passe l'organization_id à NULL pour le rendre public.
     */
    promoteTest: async (testId: string) => {
        // 1. Identifier les sous-éléments
        const { data: subtests } = await supabase.from('official_subtests').select('id').eq('test_id', testId);
        const subIds = subtests?.map(s => s.id) || [];

        // 2. Update Norms (Public)
        if (subIds.length > 0) {
            await supabase.from('official_norms')
                .update({ organization_id: null })
                .in('subtest_id', subIds);
        }

        // 3. Update Subtests (Public)
        await supabase.from('official_subtests')
            .update({ organization_id: null })
            .eq('test_id', testId);

        // 4. Update Test (Public + Move to Official Category if needed)
        // On le force dans une catégorie "Community" ou on garde celle choisie
        const { error } = await supabase.from('official_tests')
            .update({ organization_id: null })
            .eq('id', testId);

        if (error) throw error;
    },

    /**
     * MODULE C : Télémétrie Passive & Anonyme
     */
    logAnonymousStats: async (tests: TestData, patient: Patient) => {
        try {
            if (!patient.dob) return;
            const birthDate = new Date(patient.dob);
            const now = new Date();
            const ageMonths = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());

            if (ageMonths < 0) return;

            const payload: any[] = [];
            const sessionHash = 'anon_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

            for (const [testId, subtests] of Object.entries(tests)) {
                for (const [subtestId, result] of Object.entries(subtests)) {
                    if (result.status === 'validated' && result.raw) {
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
                                source_hash: sessionHash,
                                is_clinical: true
                            });
                        }
                    }
                }
            }

            if (payload.length > 0) {
                const { error } = await supabase.from('contribution_insights').insert(payload);
                if (error) Logger.warn('DB', "Telemetry insert failed", error.message);
            }

        } catch (e) {
            Logger.warn('DB', "Telemetry error (Silent)", e);
        }
    },

    // --- PHASE 3 : ANALYTIQUE ---

    getInsightsForSubtest: async (subtestId: string) => {
        const { data, error } = await supabase
            .from('contribution_insights')
            .select('computed_standard')
            .eq('subtest_id', subtestId)
            .not('computed_standard', 'is', null);
        
        if (error) throw error;
        return data.map((d: any) => parseFloat(d.computed_standard));
    },

    getQualityAlerts: async () => {
        const { data, error } = await supabase
            .from('contribution_insights')
            .select('test_id, computed_standard')
            .not('computed_standard', 'is', null);

        if (error) throw error;

        const stats: Record<string, { total: number, extreme: number }> = {};

        data.forEach((row: any) => {
            if (!stats[row.test_id]) stats[row.test_id] = { total: 0, extreme: 0 };
            const score = parseFloat(row.computed_standard);
            if (score > 145 || score < 55) {
                stats[row.test_id].extreme++;
            }
            stats[row.test_id].total++;
        });

        return Object.entries(stats)
            .map(([testId, s]) => ({
                testId,
                total: s.total,
                extremeRate: (s.extreme / s.total) * 100
            }))
            .filter(s => s.total > 10 && s.extremeRate > 5);
    },

    // --- PHASE 4 : OPS & MONITORING (IA) ---

    getAIHealthStats: async () => {
        return new Promise<{daily: any[], totalCost: number, errorRate: number}>(resolve => {
            setTimeout(() => {
                const totalCost = MOCK_AI_STATS.dailyUsage.reduce((acc, d) => acc + d.cost, 0);
                const totalErrors = MOCK_AI_STATS.dailyUsage.reduce((acc, d) => acc + d.errors, 0);
                const totalRequests = 150; 
                
                resolve({
                    daily: MOCK_AI_STATS.dailyUsage,
                    totalCost: parseFloat(totalCost.toFixed(2)),
                    errorRate: parseFloat(((totalErrors / totalRequests) * 100).toFixed(1))
                });
            }, 500);
        });
    },

    getAIFailures: async () => {
        return new Promise<any[]>(resolve => {
            setTimeout(() => resolve(MOCK_AI_STATS.failures), 500);
        });
    }
};
