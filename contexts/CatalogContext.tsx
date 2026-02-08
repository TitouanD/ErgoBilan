
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { CategoryDef, TestDef, SubtestDef } from '../data/testCatalog';
import { Logger } from '../utils/logger';

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
  searchTests: (query: string) => TestDef[]; // Recherche globale optimisée
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [flatTests, setFlatTests] = useState<TestDef[]>([]); // Cache pour la recherche

  useEffect(() => {
    let isMounted = true;

    const initCatalog = async () => {
        try {
            Logger.info('DB', 'Initializing Unified Catalog (Black Box Strategy)...');
            
            // 1. Récupération de la structure via la VUE SÉCURISÉE
            // Cette vue filtre déjà les tests privés/publics côté serveur.
            // On ne reçoit JAMAIS 'organization_id' ou 'author'.
            const { data: viewRows, error: viewError } = await supabase
                .from('view_unified_catalog')
                .select('*')
                .order('sort_order', { ascending: true });

            if (viewError) throw viewError;

            // 2. Récupération des sous-tests (Inputs)
            // On ne sélectionne QUE les champs techniques nécessaires au calcul.
            const { data: subtestsData, error: subError } = await supabase
                .from('official_subtests')
                .select('id, test_id, name, unit, score_type');

            if (subError) throw subError;

            if (!isMounted) return;

            // 3. Construction de l'arbre (Mapping)
            const categoryMap: Record<string, CategoryDef> = {};
            const allTests: TestDef[] = [];

            // A. Initialisation des catégories basées sur la vue
            viewRows?.forEach((row: any) => {
                if (!categoryMap[row.category_id]) {
                    categoryMap[row.category_id] = {
                        id: row.category_id,
                        name: row.category_label,
                        iconKey: row.icon_key || 'Box',
                        sortOrder: row.sort_order || 99,
                        tests: []
                    };
                }

                // B. Assemblage du Test
                const testSubtests: SubtestDef[] = subtestsData
                    ?.filter((s: any) => s.test_id === row.id)
                    .map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        unit: s.unit || 'pts',
                        scoreType: s.score_type as any,
                        lowerIsBetter: false // Défaut, ajusté si besoin par DB future
                    })) || [];

                const testDef: TestDef = {
                    id: row.id,
                    name: row.label, // 'name' dans la table, 'label' dans la vue
                    subtests: testSubtests
                };

                categoryMap[row.category_id].tests.push(testDef);
                allTests.push(testDef);
            });

            // Conversion en Array trié
            const finalCatalog = Object.values(categoryMap).sort((a, b) => a.sortOrder - b.sortOrder);
            
            setCatalog(finalCatalog);
            setFlatTests(allTests);
            Logger.info('DB', `Catalog loaded: ${allTests.length} tests in ${finalCatalog.length} categories.`);

        } catch (e) {
            Logger.error('DB', 'Catalog Load Error', e);
            // Fallback vide silencieux (ou gestion d'erreur UI)
            setCatalog([]); 
        } finally {
            if (isMounted) setLoading(false);
        }
    };

    initCatalog();

    return () => { isMounted = false; };
  }, []);

  // Moteur de recherche en mémoire (rapide)
  const searchTests = (query: string): TestDef[] => {
      if (!query.trim()) return [];
      const lowerQ = query.toLowerCase();
      return flatTests.filter(t => 
          t.name.toLowerCase().includes(lowerQ) || 
          t.subtests.some(s => s.name.toLowerCase().includes(lowerQ))
      );
  };

  return (
    <CatalogContext.Provider value={{ catalog, loading, searchTests }}>
      {children}
    </CatalogContext.Provider>
  );
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};
