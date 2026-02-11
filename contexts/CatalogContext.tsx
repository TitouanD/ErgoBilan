
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/db';
import { CategoryDef, TestDef, SubtestDef } from '../data/testCatalog';
import { Logger } from '../utils/logger';

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
    hasLoaded: boolean;
    ensureCatalogLoaded: () => Promise<void>;
  searchTests: (query: string) => TestDef[]; // Recherche globale optimisée
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [flatTests, setFlatTests] = useState<TestDef[]>([]); // Cache pour la recherche
  const inFlightRef = useRef<Promise<void> | null>(null);
  const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

  const ensureCatalogLoaded = useCallback(async () => {
      if (hasLoaded) return;
      if (inFlightRef.current) return inFlightRef.current;

      // Ensure we don't carry a stale "unmounted" flag in StrictMode
      isMountedRef.current = true;

      const loadPromise = (async () => {
          setLoading(true);
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

              Logger.info('DB', 'Catalog view rows', {
                  count: viewRows?.length || 0,
                  sampleIds: (viewRows || []).slice(0, 3).map((r: any) => r.id)
              });
              Logger.info('DB', 'Catalog view sample', (viewRows || [])[0] || null);

              // 2. Récupération des sous-tests via VUE SÉCURISÉE
              // Même logique que le catalog : on passe par une vue qui hérite la visibilité
              // du test parent et n'expose JAMAIS organization_id.
              const { data: subtestsData, error: subError } = await supabase
                  .from('view_unified_subtests')
                  .select('id, test_id, name, unit, score_type');

              if (subError) {
                  Logger.warn('DB', 'Subtests view unavailable, continuing without subtests.', subError);
              }
              Logger.info('DB', 'Subtests rows', { count: subtestsData?.length || 0 });

              // 3. Construction de l'arbre (Mapping)
              const categoryMap: Record<string, CategoryDef> = {};
              const allTests: TestDef[] = [];
              const subtestsByTestId: Record<string, SubtestDef[]> = {};

              (subtestsData || []).forEach((s: any) => {
                  const sub: SubtestDef = {
                      id: s.id,
                      name: s.name,
                      unit: s.unit || 'pts',
                      scoreType: s.score_type as any,
                      lowerIsBetter: false // Défaut, ajusté si besoin par DB future
                  };
                  if (!subtestsByTestId[s.test_id]) {
                      subtestsByTestId[s.test_id] = [];
                  }
                  subtestsByTestId[s.test_id].push(sub);
              });

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
                  const testSubtests: SubtestDef[] = subtestsByTestId[row.id] || [];

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
              setHasLoaded(true);
              Logger.info('DB', 'Catalog built', { categories: finalCatalog.length, tests: allTests.length });
              Logger.info('DB', `Catalog loaded: ${allTests.length} tests in ${finalCatalog.length} categories.`);

          } catch (e) {
              Logger.error('DB', 'Catalog Load Error', e);
              // Fallback vide silencieux (ou gestion d'erreur UI)
              setCatalog([]);
          } finally {
              setLoading(false);
              inFlightRef.current = null;
          }
      })();

      inFlightRef.current = loadPromise;
      return loadPromise;
  }, [hasLoaded]);

  // Moteur de recherche en mémoire (rapide)
  const searchTests = (query: string): TestDef[] => {
      if (!query.trim()) return [];
            if (!hasLoaded) return [];
      const lowerQ = query.toLowerCase();
      return flatTests.filter(t => 
          t.name.toLowerCase().includes(lowerQ) || 
          t.subtests.some(s => s.name.toLowerCase().includes(lowerQ))
      );
  };

  return (
        <CatalogContext.Provider value={{ catalog, loading, hasLoaded, ensureCatalogLoaded, searchTests }}>
      {children}
    </CatalogContext.Provider>
  );
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};

