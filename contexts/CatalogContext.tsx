import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { TEST_CATALOG, CategoryDef, TestDef } from '../data/testCatalog';
import { Logger } from '../utils/logger';

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
  source: 'db' | 'local';
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>(TEST_CATALOG);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'db' | 'local'>('local');

  useEffect(() => {
    const fetchCatalog = async () => {
        try {
            // Check if DB has data
            const { count } = await supabase.from('official_tests').select('*', { count: 'exact', head: true });
            
            if (count && count > 0) {
                Logger.info('DB', 'Loading catalog from Supabase...');
                
                // Fetch Tests
                const { data: dbTests, error: testError } = await supabase.from('official_tests').select('*');
                if (testError) throw testError;

                // Fetch Subtests
                const { data: dbSubtests, error: subError } = await supabase.from('official_subtests').select('*');
                if (subError) throw subError;

                // Map Data to UI Structure using local categories as skeleton
                const newCatalog = TEST_CATALOG.map(cat => {
                    // Filter tests for this category
                    const catTests = dbTests.filter((t: any) => t.category_id === cat.id);
                    
                    // If no tests in DB for this category, we might skip it or keep it empty
                    // For now, if DB has data, we prioritize DB content.
                    
                    const mappedTests: TestDef[] = catTests.map((t: any) => {
                        const subtests = dbSubtests
                            .filter((s: any) => s.test_id === t.id)
                            .map((s: any) => ({
                                id: s.id,
                                name: s.name,
                                unit: s.unit || 'pts',
                                scoreType: s.score_type as any,
                                lowerIsBetter: false // Default, as DB column might be missing
                            }));

                        return {
                            id: t.id,
                            name: t.name,
                            subtests: subtests
                        };
                    });

                    // Only return category if it has tests from DB or if we want to show empty categories
                    return { ...cat, tests: mappedTests };
                });

                setCatalog(newCatalog);
                setSource('db');
            } else {
                Logger.warn('DB', 'Catalog tables empty. Using local fallback.');
            }
        } catch (e) {
            Logger.error('DB', 'Failed to load catalog', e);
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
