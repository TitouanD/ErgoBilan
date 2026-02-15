import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/db';
import type {
  CategoryDef,
  TestDef,
  SubtestDef,
  ScoreType,
  ComputationMode,
  SubtestInputConfig,
  SubtestInputModel,
} from '../data/testCatalog';
import { Logger } from '../utils/logger';

interface CatalogContextType {
  catalog: CategoryDef[];
  loading: boolean;
  hasLoaded: boolean;
  ensureCatalogLoaded: () => Promise<void>;
  searchTests: (query: string) => TestDef[];
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [flatTests, setFlatTests] = useState<TestDef[]>([]);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const ensureCatalogLoaded = useCallback(async () => {
    if (hasLoaded) return;
    if (inFlightRef.current) return inFlightRef.current;

    isMountedRef.current = true;

    const loadPromise = (async () => {
      setLoading(true);
      try {
        Logger.info('DB', 'Initializing Unified Catalog (Black Box Strategy)...');

        const { data: viewRows, error: viewError } = await supabase
          .from('view_unified_catalog')
          .select('*')
          .order('sort_order', { ascending: true });

        if (viewError) throw viewError;

        Logger.info('DB', 'Catalog view rows', {
          count: viewRows?.length || 0,
          sampleIds: (viewRows || []).slice(0, 3).map((r: any) => r.id),
        });
        Logger.info('DB', 'Catalog view sample', (viewRows || [])[0] || null);

        const { data: subtestsData, error: subError } = await supabase
          .from('view_unified_subtests')
          .select('id, test_id, name, unit, score_type, computation_mode, input_model, input_config');

        if (subError) {
          Logger.warn('DB', 'Subtests view unavailable, continuing without subtests.', subError);
        }
        Logger.info('DB', 'Subtests rows', { count: subtestsData?.length || 0 });

        const categoryMap: Record<string, CategoryDef> = {};
        const allTests: TestDef[] = [];
        const subtestsByTestId: Record<string, SubtestDef[]> = {};

        const normalizeScoreType = (value?: string | null): ScoreType => {
          if (!value) return 'standard';
          const normalized = value.toLowerCase().trim();
          if (['standard', 'std', 'standard_score'].includes(normalized)) return 'standard';
          if (['scaled', 'ns', 'note_standard', 'note standard', 'scaled_score'].includes(normalized)) return 'scaled';
          if (['t-score', 'tscore', 't score', 't'].includes(normalized)) return 't-score';
          if (['percentile', 'pct', 'percentile_rank', 'percentile rank'].includes(normalized)) return 'percentile';
          if (['sten', 'stennine', 'stanine'].includes(normalized)) return 'sten';
          if (['none', 'raw', 'raw-only', 'raw_only', 'na', 'n/a', 'no-score', 'no score'].includes(normalized)) return 'none';
          return 'standard';
        };

        const normalizeComputationMode = (value?: string | null): ComputationMode => {
          if (!value) return 'LOOKUP';
          const normalized = value.toUpperCase().trim();
          if (normalized === 'PARAMETRIC') return 'PARAMETRIC';
          if (normalized === 'NONE') return 'NONE';
          return 'LOOKUP';
        };

        const normalizeInputModel = (value?: string | null): SubtestInputModel => {
          if (!value) return 'numeric_4mode';
          const normalized = value.toLowerCase().trim();
          if (normalized === 'qualitative_category') return 'qualitative_category';
          if (normalized === 'raw_only') return 'raw_only';
          return 'numeric_4mode';
        };

        const normalizeInputConfig = (value: unknown): SubtestInputConfig | undefined => {
          if (!value || typeof value !== 'object') return undefined;
          const raw = value as Record<string, unknown>;

          const options = Array.isArray(raw.options)
            ? raw.options
                .map((entry) => {
                  if (!entry || typeof entry !== 'object') return null;
                  const option = entry as Record<string, unknown>;
                  const code = String(option.code || '').trim();
                  const label = String(option.label || '').trim();
                  const order = Number(option.order);
                  if (!code || !label || Number.isNaN(order)) return null;
                  const reportText = option.reportText ? String(option.reportText) : undefined;
                  return { code, label, order, reportText };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
                .sort((a, b) => a.order - b.order)
            : undefined;

          const defaultMetricRaw = typeof raw.defaultMetric === 'string' ? raw.defaultMetric.trim() : '';
          const defaultMetric = ['raw', 'standard', 'z', 'percentile'].includes(defaultMetricRaw)
            ? (defaultMetricRaw as 'raw' | 'standard' | 'z' | 'percentile')
            : undefined;

          if ((!options || options.length === 0) && !defaultMetric) return undefined;
          return {
            ...(options && options.length > 0 ? { options } : {}),
            ...(defaultMetric ? { defaultMetric } : {}),
          };
        };

        (subtestsData || []).forEach((s: any) => {
          let inputModel = normalizeInputModel(s.input_model);
          const inputConfig = normalizeInputConfig(s.input_config);
          if (s.input_config && !inputConfig) {
            Logger.warn('DB', 'Invalid input_config for subtest, applying safe fallback', { subtestId: s.id, testId: s.test_id });
          }
          if (inputModel === 'qualitative_category' && (!inputConfig?.options || inputConfig.options.length === 0)) {
            Logger.warn('DB', 'qualitative_category without options, fallback to raw_only', { subtestId: s.id, testId: s.test_id });
            inputModel = 'raw_only';
          }

          const sub: SubtestDef = {
            id: s.id,
            name: s.name,
            unit: s.unit || 'pts',
            scoreType: normalizeScoreType(s.score_type),
            lowerIsBetter: false,
            computationMode: normalizeComputationMode(s.computation_mode),
            inputModel,
            inputConfig,
          };

          if (!subtestsByTestId[s.test_id]) {
            subtestsByTestId[s.test_id] = [];
          }
          subtestsByTestId[s.test_id].push(sub);
        });

        viewRows?.forEach((row: any) => {
          if (!categoryMap[row.category_id]) {
            categoryMap[row.category_id] = {
              id: row.category_id,
              name: row.category_label,
              iconKey: row.icon_key || 'Box',
              sortOrder: row.sort_order || 99,
              tests: [],
            };
          }

          const testSubtests: SubtestDef[] = subtestsByTestId[row.id] || [];
          const testDef: TestDef = {
            id: row.id,
            name: row.label,
            subtests: testSubtests,
          };

          categoryMap[row.category_id].tests.push(testDef);
          allTests.push(testDef);
        });

        const finalCatalog = Object.values(categoryMap).sort((a, b) => a.sortOrder - b.sortOrder);

        setCatalog(finalCatalog);
        setFlatTests(allTests);
        setHasLoaded(true);
        Logger.info('DB', 'Catalog built', { categories: finalCatalog.length, tests: allTests.length });
        Logger.info('DB', `Catalog loaded: ${allTests.length} tests in ${finalCatalog.length} categories.`);
      } catch (e) {
        Logger.error('DB', 'Catalog Load Error', e);
        setCatalog([]);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = loadPromise;
    return loadPromise;
  }, [hasLoaded]);

  const searchTests = (query: string): TestDef[] => {
    if (!query.trim()) return [];
    if (!hasLoaded) return [];
    const lowerQ = query.toLowerCase();
    return flatTests.filter(
      (t) => t.name.toLowerCase().includes(lowerQ) || t.subtests.some((s) => s.name.toLowerCase().includes(lowerQ)),
    );
  };

  return <CatalogContext.Provider value={{ catalog, loading, hasLoaded, ensureCatalogLoaded, searchTests }}>{children}</CatalogContext.Provider>;
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};
