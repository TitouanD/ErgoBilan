import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/db';
import type {
  CategoryDef,
  TestDef,
  SubtestDef,
  ScoreType,
  ComputationMode,
  RawDirection,
  SubtestInputConfig,
  SubtestInputModel,
  SubtestItem,
  ItemsAggregation,
  ItemsDisplayGroup,
  RawSection,
} from '../data/testCatalog';
import { Logger } from '../utils/logger';
import { normalizeSubtestName, normalizeTestName } from '../utils';

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        Logger.warn('DB', 'Catalog load skipped: user not authenticated');
        return;
      }

      setLoading(true);
      try {
        Logger.info('DB', 'Initializing Unified Catalog (Black Box Strategy)...');

        // Select only required columns: test metadata + category/icon info for display
        const { data: viewRows, error: viewError } = await supabase
          .from('view_unified_catalog')
          .select('id, label, category_id, category_label, icon_key, sort_order')
          .order('sort_order', { ascending: true });

        if (viewError) throw viewError;

        Logger.info('DB', 'Catalog view rows', {
          count: viewRows?.length || 0,
          sampleIds: (viewRows || []).slice(0, 3).map((r: any) => r.id),
        });
        Logger.info('DB', 'Catalog view sample', (viewRows || [])[0] || null);

        let subtestsData: any[] | null = null;
        let subError: any = null;
        ({ data: subtestsData, error: subError } = await supabase
          .from('view_unified_subtests')
          .select('id, test_id, name, unit, score_type, computation_mode, input_model, input_config, raw_direction, source_subtest_id, is_override_clone, always_show_raw, raw_display_decimals, display_group_order, display_order'));

        if (subError && String(subError.code || '') === '42703') {
          // Backward-compat: allow older DB schema before new columns.
          ({ data: subtestsData, error: subError } = await supabase
            .from('view_unified_subtests')
            .select('id, test_id, name, unit, score_type, computation_mode, input_model, input_config, raw_direction, source_subtest_id, is_override_clone'));
        }

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
          if (['sten'].includes(normalized)) return 'sten';
          if (['stanine', 'stennine'].includes(normalized)) return 'stanine';
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
          if (normalized === 'computed_items') return 'computed_items';
          if (normalized === 'custom_text') return 'custom_text';
          return 'numeric_4mode';
        };

        const normalizeRawDirection = (value?: string | null): RawDirection => {
          const normalized = String(value || '').toLowerCase().trim();
          if (normalized === 'higher_better') return 'higher_better';
          if (normalized === 'lower_better') return 'lower_better';
          return 'auto';
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

          // items for computed_items model
          const items = Array.isArray(raw.items) ? (raw.items as SubtestItem[]) : undefined;
          const itemsAggregation = typeof raw.itemsAggregation === 'string' ? (raw.itemsAggregation as ItemsAggregation) : undefined;
          const aggregationHint = typeof raw.aggregationHint === 'string' ? raw.aggregationHint : undefined;
          const displayGroup = typeof raw.displayGroup === 'string' ? (raw.displayGroup as ItemsDisplayGroup) : undefined;
          const maxRawScore = typeof raw.maxRawScore === 'number' ? raw.maxRawScore : undefined;
          const rawValueLabel = typeof raw.rawValueLabel === 'string' ? raw.rawValueLabel : undefined;
          const showRawFraction = raw.showRawFraction === true;
          const rawSections = Array.isArray(raw.rawSections) ? (raw.rawSections as RawSection[]) : undefined;
          const qualitativeLayout = typeof raw.qualitativeLayout === 'string' ? (raw.qualitativeLayout as 'radio' | 'select' | 'toggle') : undefined;
          const groupKey = typeof raw.groupKey === 'string' && raw.groupKey.trim() ? raw.groupKey.trim() : undefined;
          const groupHeaderLabel = typeof raw.groupHeaderLabel === 'string' && raw.groupHeaderLabel.trim() ? raw.groupHeaderLabel.trim() : undefined;
          const groupOrder = typeof raw.groupOrder === 'number' && Number.isFinite(raw.groupOrder) ? raw.groupOrder : undefined;
          const orderIndex = typeof raw.orderIndex === 'number' && Number.isFinite(raw.orderIndex) ? raw.orderIndex : undefined;

          if (
            (!options || options.length === 0) &&
            !defaultMetric &&
            !items &&
            !itemsAggregation &&
            !aggregationHint &&
            !displayGroup &&
            !maxRawScore &&
            !rawValueLabel &&
            !showRawFraction &&
            !rawSections &&
            !qualitativeLayout &&
            !groupKey &&
            !groupHeaderLabel &&
            groupOrder === undefined &&
            orderIndex === undefined
          ) return undefined;
          return {
            ...(options && options.length > 0 ? { options } : {}),
            ...(defaultMetric ? { defaultMetric } : {}),
            ...(items ? { items } : {}),
            ...(itemsAggregation ? { itemsAggregation } : {}),
            ...(aggregationHint ? { aggregationHint } : {}),
            ...(displayGroup ? { displayGroup } : {}),
            ...(maxRawScore !== undefined ? { maxRawScore } : {}),
            ...(rawValueLabel ? { rawValueLabel } : {}),
            ...(showRawFraction ? { showRawFraction } : {}),
            ...(rawSections ? { rawSections } : {}),
            ...(qualitativeLayout ? { qualitativeLayout } : {}),
            ...(groupKey ? { groupKey } : {}),
            ...(groupHeaderLabel ? { groupHeaderLabel } : {}),
            ...(groupOrder !== undefined ? { groupOrder } : {}),
            ...(orderIndex !== undefined ? { orderIndex } : {}),
          };
        };

        const hasNonEmptyInputConfig = (value: unknown): boolean => {
          if (!value || typeof value !== 'object') return false;
          const raw = value as Record<string, unknown>;
          return Object.keys(raw).length > 0;
        };

        (subtestsData || []).forEach((s: any) => {
          let inputModel = normalizeInputModel(s.input_model);
          const inputConfig = normalizeInputConfig(s.input_config);
          const displayGroupOrder = Number.isFinite(s.display_group_order) ? Number(s.display_group_order) : undefined;
          const displayOrder = Number.isFinite(s.display_order) ? Number(s.display_order) : undefined;
          if (hasNonEmptyInputConfig(s.input_config) && !inputConfig) {
            Logger.warn('DB', 'Invalid input_config for subtest, applying safe fallback', { subtestId: s.id, testId: s.test_id });
          }
          if (inputModel === 'qualitative_category' && (!inputConfig?.options || inputConfig.options.length === 0)) {
            Logger.warn('DB', 'qualitative_category without options, fallback to raw_only', { subtestId: s.id, testId: s.test_id });
            inputModel = 'raw_only';
          }

          const sub: SubtestDef = {
            id: s.id,
            name: s.name,
            displayGroupOrder,
            displayOrder,
            unit: s.unit || 'pts',
            scoreType: normalizeScoreType(s.score_type),
            lowerIsBetter: false,
            rawDirection: normalizeRawDirection(s.raw_direction),
            sourceSubtestId: s.source_subtest_id || null,
            isOverrideClone: s.is_override_clone === true,
            computationMode: normalizeComputationMode(s.computation_mode),
            inputModel,
            inputConfig,
            alwaysShowRaw: s.always_show_raw === true,
            rawDisplayDecimals: typeof s.raw_display_decimals === 'number' ? s.raw_display_decimals : undefined,
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
          if (testSubtests.length === 0) {
            return;
          }
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
    const lowerQ = query.toLowerCase().trim();
    const normalizedQ = normalizeSubtestName(query);
    const normalizedQTest = normalizeTestName(query);
    // Escape regex special chars so queries like 'C+1' don't throw
    const safeQ = lowerQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordStartRe = new RegExp('\\b' + safeQ, 'i');

    const scoreTest = (name: string): number => {
      const lname = name.toLowerCase();
      if (lname.startsWith(lowerQ)) return 4;
      if (wordStartRe.test(name)) return 3;
      if (lname.includes(lowerQ)) return 2;
      const normalizedCandidate = normalizeSubtestName(name);
      if (normalizedQ && normalizedCandidate.includes(normalizedQ)) return 2;
      const normalizedTestCandidate = normalizeTestName(name);
      if (normalizedQTest && normalizedTestCandidate.includes(normalizedQTest)) return 2;
      return 0;
    };

    const scored = flatTests
      .map((t) => {
        const testScore = scoreTest(t.name);
        const subtestScore = t.subtests.reduce((best, s) => Math.max(best, scoreTest(s.name)), 0);
        // Subtests matches rank slightly below direct test matches
        const total = testScore > 0 ? testScore : subtestScore > 0 ? subtestScore - 0.5 : 0;
        return { test: t, score: total };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((x) => x.test);
  };

  return <CatalogContext.Provider value={{ catalog, loading, hasLoaded, ensureCatalogLoaded, searchTests }}>{children}</CatalogContext.Provider>;
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};
