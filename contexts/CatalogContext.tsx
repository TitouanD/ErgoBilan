
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { TEST_CATALOG, CategoryDef, TestDef } from '../data/testCatalog';
import { Logger } from '../utils/logger';
import { StorageService } from '../services/storage'; // Pour détecter le mode démo si besoin, ou via AuthContext

// On recrée l'interface de base pour éviter l'import circulaire si AuthContext dépend de CatalogContext
// Mais ici on va utiliser une variable globale ou un fetch conditionnel.

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
  source: 'db' | 'local';
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>([]); // Vide par défaut
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'db' | 'local'>('local');

  useEffect(() => {
    let isMounted = true;

    const initCatalog = async () => {
        // 1. DÉTECTION DU MODE : On vérifie si un utilisateur est connecté
        const { data: { session } } = await supabase.auth.getSession();
        
        // Si pas de session (ou mode démo simulé dans l'app), on charge le snapshot local
        // Note: isDemoMode est géré dans AuthContext, mais ici on fait une vérif simple sur la session
        if (!session) {
            Logger.info('DB', 'Demo/Offline Mode: Loading local snapshot.');
            if (isMounted) {
                setCatalog(TEST_CATALOG); // Charge le fichier statique
                setSource('local');
                setLoading(false);
            }
            return;
        }

        // 2. MODE CONNECTÉ : CHARGEMENT DB
        try {
            Logger.info('DB', 'Authenticated: Fetching official catalog...');
            
            const { data: dbTests, error: testError } = await supabase.from('official_tests').select('*');
            if (testError) throw testError;

            const { data: dbSubtests, error: subError } = await supabase.from('official_subtests').select('*');
            if (subError) throw subError;

            // Construction de l'arbre à partir de la DB uniquement
            // On part d'un squelette de catégories vide ou basique pour l'ordre d'affichage
            const categoriesMap: Record<string, CategoryDef> = {
                'motricite-globale': { id: 'motricite-globale', name: 'Motricité Globale', iconName: 'Brain', tests: [] },
                'ecriture': { id: 'ecriture', name: 'Écriture', iconName: 'Pencil', tests: [] },
                'visuo-perceptif': { id: 'visuo-perceptif', name: 'Visuo-perceptif', iconName: 'Eye', tests: [] },
                'attention-executif': { id: 'attention-executif', name: 'Attention / Exécutif', iconName: 'Focus', tests: [] },
                'sensoriel': { id: 'sensoriel', name: 'Sensoriel', iconName: 'Hand', tests: [] },
                'autre': { id: 'autre', name: 'Autre', iconName: 'Home', tests: [] }
            };

            dbTests.forEach((t: any) => {
                const catId = categoriesMap[t.category_id] ? t.category_id : 'autre';
                
                const subtests = dbSubtests
                    .filter((s: any) => s.test_id === t.id)
                    .map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        unit: s.unit || 'pts',
                        scoreType: s.score_type as any,
                        lowerIsBetter: false 
                    }));

                categoriesMap[catId].tests.push({
                    id: t.id,
                    name: t.name,
                    subtests: subtests
                });
            });

            if (isMounted) {
                // On transforme la map en array et on filtre les catégories vides
                const finalCatalog = Object.values(categoriesMap).filter(c => c.tests.length > 0);
                setCatalog(finalCatalog);
                setSource('db');
            }

        } catch (e) {
            Logger.error('DB', 'Failed to load DB catalog, falling back to local snapshot', e);
            if (isMounted) {
                setCatalog(TEST_CATALOG);
                setSource('local');
            }
        } finally {
            if (isMounted) setLoading(false);
        }
    };

    initCatalog();

    return () => { isMounted = false; };
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
