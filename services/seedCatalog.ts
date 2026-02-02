
import { supabase } from './db';
import { TEST_CATALOG } from '../data/testCatalog';
import { SCALES } from '../utils/scoring';

/**
 * Migration pour initialiser le catalogue.
 * Note: En prod, ceci devrait être un script admin. 
 * Ici, on tente l'insertion si la table est vide.
 */
export const seedDatabaseFromCatalog = async () => {
    // Vérification rapide
    const { data } = await supabase.from('official_tests').select('id').limit(1);
    if (data && data.length > 0) {
        console.log("📦 Catalogue Supabase déjà initialisé.");
        return;
    }

    console.log("🌱 Initialisation Catalogue Supabase...");

    // On ne fait que les Tests et Sous-tests pour l'instant pour éviter de spammer
    // Les normes sont complexes à migrer ainsi.
    for (const category of TEST_CATALOG) {
        for (const test of category.tests) {
            await supabase.from('official_tests').upsert({
                id: test.id,
                name: test.name,
                category_id: category.id,
                author: 'Reference',
                version: '1.0'
            });

            for (const subtest of test.subtests) {
                const dbSubtestId = `${test.id}_${subtest.id}`;
                await supabase.from('official_subtests').upsert({
                    id: dbSubtestId,
                    test_id: test.id,
                    name: subtest.name,
                    unit: subtest.unit,
                    score_type: subtest.scoreType,
                    computation_mode: 'PARAMETRIC'
                });
                
                // Norme générique par défaut (Simulation)
                await supabase.from('official_norms').upsert({
                    id: `${dbSubtestId}_default`,
                    subtest_id: dbSubtestId,
                    age_min_months: 0,
                    age_max_months: 240,
                    gender: 'Mixed',
                    mean: 10,
                    sd: 3
                });
            }
        }
    }
};
