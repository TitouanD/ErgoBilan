
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { TEST_CATALOG, CategoryDef, TestDef } from '../data/testCatalog';
import { Logger } from '../utils/logger';

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
  source: 'db' | 'local' | 'merged';
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>(TEST_CATALOG);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'db' | 'local' | 'merged'>('local');

  useEffect(() => {
    const fetchCatalog = async () => {
        try {
            // Check if DB has data
            const { count } = await supabase.from('official_tests').select('*', { count: 'exact', head: true });
            
            if (count && count > 0) {
                Logger.info('DB', 'Loading extended catalog from Supabase...');
                
                // Fetch Tests (RLS will automatically filter Public + My Org's Private)
                const { data: dbTests, error: testError } = await supabase.from('official_tests').select('*');
                if (testError) throw testError;

                // Fetch Subtests
                const { data: dbSubtests, error: subError } = await supabase.from('official_subtests').select('*');
                if (subError) throw subError;

                // STRATÉGIE DE FUSION : On part du catalogue local (Deep Copy)
                // On ajoute les tests DB dans les catégories correspondantes
                const mergedCatalog = JSON.parse(JSON.stringify(TEST_CATALOG)) as CategoryDef[];

                dbTests.forEach((t: any) => {
                    // Trouver la catégorie cible
                    let category = mergedCatalog.find(c => c.id === t.category_id);
                    
                    // Si catégorie inconnue (ex: nouveau tag), on la crée ou on met dans 'Autre'
                    // Pour simplifier ici, si pas trouvée, on met dans la première catégorie ou on ignore
                    if (!category) {
                        // Optionnel : Créer une catégorie dynamique si besoin. Ici on skip pour la sécurité.
                        return;
                    }

                    // Vérifier si le test existe déjà (pour éviter les doublons si on migre un jour les tests locaux en DB)
                    if (category.tests.find(existing => existing.id === t.id)) {
                        return;
                    }

                    // Construire l'objet Test
                    const subtests = dbSubtests
                        .filter((s: any) => s.test_id === t.id)
                        .map((s: any) => ({
                            id: s.id,
                            name: s.name,
                            unit: s.unit || 'pts',
                            scoreType: s.score_type as any,
                            lowerIsBetter: false 
                        }));

                    const newTest: TestDef = {
                        id: t.id,
                        name: t.name,
                        subtests: subtests
                    };

                    // Ajouter le test à la catégorie
                    category.tests.push(newTest);
                });

                setCatalog(mergedCatalog);
                setSource('merged');
            } else {
                Logger.info('DB', 'No DB tests found. Using local catalog.');
            }
        } catch (e) {
            Logger.error('DB', 'Failed to load catalog', e);
            // Fallback silencieux sur le catalogue local déjà initialisé
        } finally {
            setLoading(false);
        }
    };

    fetchCatalog();
  }, []);

  return (
    <CatalogContext.Provider value={{ catalog, loading, source }}>
      {children}
    </CatalogContext.Provider>
  );
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};
