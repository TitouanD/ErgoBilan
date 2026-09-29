/**
 * CatalogContext — test catalogue loaded from Supabase (views `view_unified_catalog`
 * and `view_unified_subtests`, filtered server-side to official tests + the
 * practitioner's organization tests). Loaded lazily on first need.
 * Without a session (demo mode) the static excerpt data/demoCatalog.ts is used.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../services/db';
import type { Json, Tables } from '../types/supabase';
import type { CategoryDef, TestDef, SubtestDef, SubtestInputConfig, SubtestInputModel, SubtestInputOption } from '../data/testCatalog';
import { Logger } from '../utils/logger';
import { normalizeSubtestName, normalizeTestName } from '../utils/catalogNames';
import { resolveScaleType } from '../utils/scoring';
import { EMPTY_CATALOG_INDEX, buildCatalogIndex, type CatalogIndex } from '../utils/catalogIndex';
import { DEMO_CATALOG } from '../data/demoCatalog';

interface CatalogContextType {
  catalog: CategoryDef[];
  /** O(1) lookups (names, scale types, categories) — see utils/catalogIndex.ts. */
  index: CatalogIndex;
  loading: boolean;
  hasLoaded: boolean;
  /** Load once (no-op when already loaded) and resolve with the up-to-date index. */
  ensureCatalogLoaded: () => Promise<CatalogIndex>;
  /** Force a reload (e.g. after creating a custom test). */
  reloadCatalog: () => Promise<CatalogIndex>;
  searchTests: (query: string) => TestDef[];
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

const INPUT_MODELS: ReadonlyArray<SubtestInputModel> = ['numeric_4mode', 'qualitative_category', 'custom_text'];

const toInputModel = (value: string | null): SubtestInputModel =>
  INPUT_MODELS.includes(value as SubtestInputModel) ? (value as SubtestInputModel) : 'numeric_4mode';

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Validate the free-form `input_config` jsonb; unknown keys are ignored. */
const toInputConfig = (value: Json | null): SubtestInputConfig | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const options: SubtestInputOption[] | undefined = Array.isArray(raw.options)
    ? raw.options
        .map((entry): SubtestInputOption | null => {
          if (!entry || typeof entry !== 'object') return null;
          const o = entry as Record<string, unknown>;
          const code = String(o.code ?? '').trim();
          const label = String(o.label ?? '').trim();
          const order = Number(o.order);
          if (!code || !label || Number.isNaN(order)) return null;
          return { code, label, order, reportText: asString(o.reportText) };
        })
        .filter((o): o is SubtestInputOption => o !== null)
        .sort((a, b) => a.order - b.order)
    : undefined;

  const config: SubtestInputConfig = {
    ...(options?.length ? { options } : {}),
    ...(asString(raw.groupKey) ? { groupKey: asString(raw.groupKey) } : {}),
    ...(asString(raw.groupHeaderLabel) ? { groupHeaderLabel: asString(raw.groupHeaderLabel) } : {}),
    ...(asNumber(raw.groupOrder) !== undefined ? { groupOrder: asNumber(raw.groupOrder) } : {}),
    ...(asNumber(raw.orderIndex) !== undefined ? { orderIndex: asNumber(raw.orderIndex) } : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
};

type SubtestRow = Tables<'view_unified_subtests'>;
type TestRow = Pick<
  Tables<'view_unified_catalog'>,
  'id' | 'label' | 'category_id' | 'category_label' | 'icon_key' | 'sort_order'
>;

const toSubtestDef = (s: SubtestRow): SubtestDef | null => {
  if (!s.id || !s.name) return null;
  const inputConfig = toInputConfig(s.input_config);
  let inputModel = toInputModel(s.input_model);
  if (inputModel === 'qualitative_category' && !inputConfig?.options?.length) {
    Logger.warn('DB', 'qualitative_category without options, fallback to custom_text', { subtestId: s.id });
    inputModel = 'custom_text';
  }
  return {
    id: s.id,
    name: s.name,
    displayGroupOrder: s.display_group_order ?? undefined,
    displayOrder: s.display_order ?? undefined,
    unit: s.unit || 'pts',
    scoreType: resolveScaleType(s.score_type),
    inputModel,
    inputConfig,
  };
};

const buildCatalog = (testRows: TestRow[], subtestRows: SubtestRow[]): CategoryDef[] => {
  const subtestsByTestId = new Map<string, SubtestDef[]>();
  for (const row of subtestRows) {
    const def = row.test_id ? toSubtestDef(row) : null;
    if (!def) continue;
    subtestsByTestId.set(row.test_id!, [...(subtestsByTestId.get(row.test_id!) ?? []), def]);
  }

  const categories = new Map<string, CategoryDef>();
  for (const row of testRows) {
    if (!row.id || !row.category_id) continue;
    const subtests = subtestsByTestId.get(row.id);
    if (!subtests?.length) continue; // a test without subtests cannot be scored
    const category = categories.get(row.category_id) ?? {
      id: row.category_id,
      name: row.category_label || row.category_id,
      iconKey: row.icon_key || 'Box',
      sortOrder: row.sort_order ?? 99,
      tests: [],
    };
    category.tests.push({ id: row.id, name: row.label || row.id, subtests });
    categories.set(row.category_id, category);
  }
  return [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder);
};

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [catalog, setCatalog] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const inFlightRef = useRef<Promise<CatalogIndex> | null>(null);
  const hasLoadedRef = useRef(false);
  const indexRef = useRef<CatalogIndex>(EMPTY_CATALOG_INDEX);
  /** Which catalogue is loaded: the demo one must be replaced once a user signs in. */
  const sourceRef = useRef<'demo' | 'db' | null>(null);

  const apply = useCallback((next: CategoryDef[], source: 'demo' | 'db') => {
    indexRef.current = buildCatalogIndex(next);
    sourceRef.current = source;
    hasLoadedRef.current = true;
    setCatalog(next);
    setHasLoaded(true);
  }, []);

  const clear = useCallback(() => {
    hasLoadedRef.current = false;
    sourceRef.current = null;
    indexRef.current = EMPTY_CATALOG_INDEX;
    setHasLoaded(false);
    setCatalog([]);
  }, []);

  const load = useCallback(async (): Promise<CatalogIndex> => {
    if (inFlightRef.current) return inFlightRef.current;

    const promise = (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        // Only the demo mode reaches catalogue screens without a session.
        apply(DEMO_CATALOG, 'demo');
        inFlightRef.current = null;
        return indexRef.current;
      }
      setLoading(true);
      try {
        const [tests, subtests] = await Promise.all([
          supabase.from('view_unified_catalog').select('id, label, category_id, category_label, icon_key, sort_order').order('sort_order'),
          supabase
            .from('view_unified_subtests')
            .select('id, test_id, name, unit, score_type, input_model, input_config, display_group_order, display_order'),
        ]);
        if (tests.error) throw tests.error;
        if (subtests.error) throw subtests.error;

        const next = buildCatalog(tests.data ?? [], subtests.data ?? []);
        apply(next, 'db');
        Logger.info('DB', `Catalog loaded: ${next.reduce((n, c) => n + c.tests.length, 0)} tests in ${next.length} categories.`);
      } catch (e) {
        Logger.error('DB', 'Catalog Load Error', e);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
      return indexRef.current;
    })();

    inFlightRef.current = promise;
    return promise;
  }, [apply]);

  const ensureCatalogLoaded = useCallback(async () => (hasLoadedRef.current ? indexRef.current : load()), [load]);

  // Built together with `catalog` in load(); kept in a ref so async callers get the fresh value.
  const index = useMemo(() => (catalog.length > 0 ? indexRef.current : EMPTY_CATALOG_INDEX), [catalog]);
  const flatTests = useMemo(() => catalog.flatMap((c) => c.tests), [catalog]);

  const searchTests = useCallback(
    (query: string): TestDef[] => {
      const lowerQ = query.toLowerCase().trim();
      if (!lowerQ || !hasLoaded) return [];
      const normalizedQ = normalizeSubtestName(query);
      const normalizedQTest = normalizeTestName(query);
      const wordStartRe = new RegExp('\\b' + lowerQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      const score = (name: string): number => {
        const lname = name.toLowerCase();
        if (lname.startsWith(lowerQ)) return 4;
        if (wordStartRe.test(name)) return 3;
        if (lname.includes(lowerQ)) return 2;
        if (normalizedQ && normalizeSubtestName(name).includes(normalizedQ)) return 2;
        if (normalizedQTest && normalizeTestName(name).includes(normalizedQTest)) return 2;
        return 0;
      };

      return flatTests
        .map((test) => {
          const testScore = score(test.name);
          const subtestScore = Math.max(0, ...test.subtests.map((s) => score(s.name)));
          // Subtest matches rank slightly below direct test matches
          return { test, score: testScore > 0 ? testScore : subtestScore > 0 ? subtestScore - 0.5 : 0 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.test);
    },
    [flatTests, hasLoaded],
  );

  useEffect(() => {
    // Forget the catalogue on sign-out (it contains organization-private tests),
    // and drop the demo catalogue once a real user signs in.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && sourceRef.current === 'demo')) clear();
    });
    return () => data.subscription.unsubscribe();
  }, [clear]);

  return (
    <CatalogContext.Provider value={{ catalog, index, loading, hasLoaded, ensureCatalogLoaded, reloadCatalog: load, searchTests }}>
      {children}
    </CatalogContext.Provider>
  );
};

export const useCatalog = () => {
  const context = useContext(CatalogContext);
  if (context === undefined) throw new Error('useCatalog must be used within a CatalogProvider');
  return context;
};
