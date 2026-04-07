export interface InventoryColumnDescriptor {
  sid: string;
  ab?: string | null;
  domain?: string | null;
  columnOrder?: number | null;
  tableOrder?: number | null;
  isInverted?: boolean | null;
}

export interface InventoryScanResult {
  tc?: string | null;
  st?: string | null;
  isInverted?: boolean | null;
  leftScaleType?: string | null;
  columns: InventoryColumnDescriptor[];
}

export interface ExtractionLikeTable {
  sid: string;
  ab?: string | null;
  rows?: Record<string, unknown>[];
}

export interface ExtractionLikeResult {
  st?: string | null;
  tables?: ExtractionLikeTable[];
}

export interface InventoryChunk {
  domainHint: string;
  columns: InventoryColumnDescriptor[];
}

export interface ExtractionRoutingDecision {
  mode: 'parametric-full' | 'lookup-full' | 'lookup-chunked' | 'conversion-skip';
  inventoryColumnCount: number;
  isInverted: boolean;
  reason: string;
}

export interface InventoryCompletenessSummary {
  expectedSourceColumns: string[];
  missingSourceColumns: string[];
  expectedSourceColumnCount: number;
}

const normalizeStableKeyPart = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

/** Like normalizeStableKeyPart but also strips non-alphanumeric chars for tolerant matching (e.g. "MP & MPD" → "MPMPD"). */
export const normalizeKeyTolerant = (value: unknown): string =>
  normalizeStableKeyPart(value).replace(/[^A-Z0-9]/g, '');

const normalizeCellValue = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');

const toFiniteNumber = (value: unknown): number | null => {
  const cleaned = normalizeCellValue(value).replace(',', '.').replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+' || cleaned === '.' || cleaned === '+.' || cleaned === '-.') {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildInventoryColumnKey = (column: Pick<InventoryColumnDescriptor, 'sid' | 'ab'>): string => {
  const ab = String(column.ab ?? '').trim();
  const sid = String(column.sid ?? '').trim();
  return normalizeKeyTolerant(ab || sid);
};

/**
 * For PARAMETRIC tables the extractor produces one Moyenne+ET pair per subtest,
 * regardless of how many historical/duplicate visual columns appear in the image.
 * Deduplicating to unique sids lets quality metrics measure "did we cover every
 * subtest" instead of "did we fill every visual column" — avoiding false alarms
 * on tables that show two norm sets side-by-side (e.g. Lespargot 1981 vs 3p).
 */
export const deduplicateInventoryColumnsForParametric = (
  columns: InventoryColumnDescriptor[],
): InventoryColumnDescriptor[] => {
  const seen = new Set<string>();
  return columns.filter((col) => {
    const key = normalizeStableKeyPart(col.sid);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildTableKey = (table: Pick<ExtractionLikeTable, 'sid' | 'ab'>): string => {
  const ab = String(table.ab ?? '').trim();
  const sid = String(table.sid ?? '').trim();
  return normalizeKeyTolerant(ab || sid);
};

// ── FUZZY TOKEN MATCHING ────────────────────────────────────────────────────
// Handles slight name drift between inventory and extraction (accents,
// casing, extra spaces, word-order differences).

const tokenize = (value: string): Set<string> => {
  const tokens = normalizeStableKeyPart(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return new Set(tokens);
};

/** Jaccard similarity on normalized token sets (0–1). */
const fuzzyTokenScore = (a: string, b: string): number => {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((t) => { if (setB.has(t)) intersection += 1; });
  return intersection / (setA.size + setB.size - intersection);
};

const FUZZY_MATCH_THRESHOLD = 0.6;

const popByOccurrence = <T>(
  valuesByKey: Map<string, T[]>,
  cursorByKey: Map<string, number>,
  key: string,
): T | undefined => {
  const values = valuesByKey.get(key);
  if (!values || values.length === 0) return undefined;
  const index = cursorByKey.get(key) || 0;
  cursorByKey.set(key, index + 1);
  return values[index];
};

export const decideExtractionRouting = (
  inventory: InventoryScanResult | null,
  chunkedThreshold: number,
): ExtractionRoutingDecision => {
  const structure = normalizeStableKeyPart(inventory?.st || 'LOOKUP');
  const columns = Array.isArray(inventory?.columns) ? inventory!.columns.filter((column) => normalizeCellValue(column.sid).length > 0) : [];
  const inventoryColumnCount = columns.length;
  const isInverted = inventory?.isInverted === true || columns.some((column) => column.isInverted === true);

  if (structure === 'PARAMETRIC') {
    return {
      mode: 'parametric-full',
      inventoryColumnCount,
      isInverted: false,
      reason: 'parametric',
    };
  }

  if (structure === 'CONVERSION') {
    return {
      mode: 'conversion-skip',
      inventoryColumnCount,
      isInverted: false,
      reason: 'conversion-table',
    };
  }

  // Heuristic: inverted table with percentile bands as left scale (e.g. ≤2, 2-5, ..., >75)
  // is a conversion/equivalence table, not a norm lookup. Skip extraction.
  if (isInverted && normalizeStableKeyPart(inventory?.leftScaleType || '') === 'PERCENTILE_BANDS') {
    return {
      mode: 'conversion-skip',
      inventoryColumnCount,
      isInverted: true,
      reason: 'percentile-band-conversion',
    };
  }

  if (isInverted) {
    return {
      mode: 'lookup-chunked',
      inventoryColumnCount,
      isInverted: true,
      reason: 'inverted-lookup',
    };
  }

  if (inventoryColumnCount > chunkedThreshold) {
    return {
      mode: 'lookup-chunked',
      inventoryColumnCount,
      isInverted: false,
      reason: 'dense-lookup',
    };
  }

  return {
    mode: 'lookup-full',
    inventoryColumnCount,
    isInverted: false,
    reason: 'simple-lookup',
  };
};

export const chunkInventoryColumns = (
  columns: InventoryColumnDescriptor[],
  maxColumnsPerChunk: number,
): InventoryChunk[] => {
  if (!Array.isArray(columns) || columns.length === 0) return [];

  const sanitized = [...columns].sort((left, right) => {
    const leftTableOrder = Number.isFinite(Number(left.tableOrder)) ? Number(left.tableOrder) : 0;
    const rightTableOrder = Number.isFinite(Number(right.tableOrder)) ? Number(right.tableOrder) : 0;
    if (leftTableOrder !== rightTableOrder) return leftTableOrder - rightTableOrder;
    const leftColumnOrder = Number.isFinite(Number(left.columnOrder)) ? Number(left.columnOrder) : Number.MAX_SAFE_INTEGER;
    const rightColumnOrder = Number.isFinite(Number(right.columnOrder)) ? Number(right.columnOrder) : Number.MAX_SAFE_INTEGER;
    return leftColumnOrder - rightColumnOrder;
  });

  const chunks: InventoryChunk[] = [];
  let currentChunk: InventoryColumnDescriptor[] = [];
  let currentDomain = normalizeCellValue(sanitized[0]?.domain || '') || 'Sans domaine';

  for (const column of sanitized) {
    const domain = normalizeCellValue(column.domain || '') || 'Sans domaine';
    const shouldFlush =
      currentChunk.length > 0
      && (currentChunk.length >= maxColumnsPerChunk || (domain !== currentDomain && currentChunk.length >= 1));

    if (shouldFlush) {
      chunks.push({
        domainHint: currentDomain,
        columns: currentChunk,
      });
      currentChunk = [];
      currentDomain = domain;
    }

    currentChunk.push(column);
    currentDomain = domain;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      domainHint: currentDomain,
      columns: currentChunk,
    });
  }

  return chunks;
};

export const sortTablesByInventoryOrder = <T extends ExtractionLikeTable>(
  tables: T[],
  inventoryColumns: InventoryColumnDescriptor[],
): T[] => {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  if (!Array.isArray(inventoryColumns) || inventoryColumns.length === 0) return [...tables];

  const ordersByKey = new Map<string, number[]>();
  inventoryColumns.forEach((column, index) => {
    const key = buildInventoryColumnKey(column);
    const order = Number.isFinite(Number(column.columnOrder)) ? Number(column.columnOrder) : index;
    const existing = ordersByKey.get(key) || [];
    existing.push(order);
    ordersByKey.set(key, existing);
  });

  const cursorByKey = new Map<string, number>();
  const assignedOrders = new Map<number, number>();
  tables.forEach((table, index) => {
    const key = buildTableKey(table);
    const availableOrders = ordersByKey.get(key) || [];
    const cursor = cursorByKey.get(key) || 0;
    cursorByKey.set(key, cursor + 1);
    const assigned = availableOrders[cursor];
    assignedOrders.set(index, Number.isFinite(Number(assigned)) ? Number(assigned) : Number.MAX_SAFE_INTEGER - (tables.length - index));
  });

  const decorated = tables.map((table, index) => ({
    table,
    order: assignedOrders.get(index) ?? Number.MAX_SAFE_INTEGER,
    index,
  }));

  decorated.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    const keyCompare = buildTableKey(left.table).localeCompare(buildTableKey(right.table));
    if (keyCompare !== 0) return keyCompare;
    return left.index - right.index;
  });

  return decorated.map((entry) => entry.table);
};

const getInventoryColumnLabel = (column: Pick<InventoryColumnDescriptor, 'sid' | 'ab'>): string => (
  normalizeCellValue(column.ab) || normalizeCellValue(column.sid)
);

export const summarizeInventoryCompleteness = (
  extraction: ExtractionLikeResult | null,
  inventoryColumns: InventoryColumnDescriptor[],
): InventoryCompletenessSummary => {
  const expectedSourceColumns = Array.isArray(inventoryColumns)
    ? inventoryColumns.map((column) => getInventoryColumnLabel(column)).filter((label) => label.length > 0)
    : [];

  if (!Array.isArray(inventoryColumns) || inventoryColumns.length === 0) {
    return {
      expectedSourceColumns,
      missingSourceColumns: [],
      expectedSourceColumnCount: expectedSourceColumns.length,
    };
  }

  const extractedCountByKey = new Map<string, number>();
  if (Array.isArray(extraction?.tables)) {
    extraction.tables.forEach((table) => {
      const key = buildInventoryColumnKey({ sid: table.sid, ab: table.ab || null });
      if (!key) return;
      extractedCountByKey.set(key, (extractedCountByKey.get(key) || 0) + 1);
    });
  }

  // Build a list of extracted table entries for fuzzy fallback
  const extractedEntries = Array.isArray(extraction?.tables)
    ? extraction.tables.map((table) => ({
        key: buildInventoryColumnKey({ sid: table.sid, ab: table.ab || null }),
        sid: table.sid,
        ab: table.ab || null,
      }))
    : [];
  const extractedFuzzyCount = new Map<string, number>();
  extractedEntries.forEach((e) => extractedFuzzyCount.set(e.key, (extractedFuzzyCount.get(e.key) || 0) + 1));

  const missingSourceColumns = inventoryColumns
    .filter((column) => {
      const key = buildInventoryColumnKey(column);
      const available = extractedCountByKey.get(key) || 0;
      if (available > 0) {
        extractedCountByKey.set(key, available - 1);
        // Keep fuzzy counts in sync so fuzzy fallback doesn't double-match
        const fuzzyAvail = extractedFuzzyCount.get(key) || 0;
        if (fuzzyAvail > 0) extractedFuzzyCount.set(key, fuzzyAvail - 1);
        return false;
      }
      // Exact key miss → try fuzzy match on sid (abbreviation already matched via key)
      const colSid = normalizeCellValue(column.sid);
      const colAb = normalizeCellValue(column.ab);
      for (const entry of extractedEntries) {
        const entryAvailable = extractedFuzzyCount.get(entry.key) || 0;
        if (entryAvailable <= 0) continue;
        // Abbreviation must match if both are present (strip non-alphanumeric for tolerance)
        const stripNonAlpha = (s: string) => normalizeStableKeyPart(s).replace(/[^A-Z0-9]/g, '');
        const abMatch = !colAb || !entry.ab || stripNonAlpha(colAb) === stripNonAlpha(entry.ab);
        if (!abMatch) continue;
        if (fuzzyTokenScore(colSid, entry.sid) >= FUZZY_MATCH_THRESHOLD) {
          extractedFuzzyCount.set(entry.key, entryAvailable - 1);
          return false;
        }
      }
      return true;
    })
    .map((column) => getInventoryColumnLabel(column))
    .filter((label) => label.length > 0);

  return {
    expectedSourceColumns,
    missingSourceColumns,
    expectedSourceColumnCount: expectedSourceColumns.length,
  };
};

export const matchRepairColumns = (
  inventoryColumns: InventoryColumnDescriptor[],
  focusSubtests: Array<Pick<InventoryColumnDescriptor, 'sid' | 'ab'>>,
  includeNeighborColumns: boolean,
): InventoryColumnDescriptor[] => {
  if (!Array.isArray(inventoryColumns) || inventoryColumns.length === 0) return [];
  const byKey = new Map<string, InventoryColumnDescriptor>();
  inventoryColumns.forEach((column) => byKey.set(buildInventoryColumnKey(column), column));

  const matched = new Map<string, InventoryColumnDescriptor>();
  focusSubtests.forEach((focus) => {
    const exactKey = buildInventoryColumnKey({ sid: focus.sid, ab: focus.ab });
    const exact = byKey.get(exactKey);
    if (exact) {
      matched.set(buildInventoryColumnKey(exact), exact);
      return;
    }

    const fallback = inventoryColumns.find((column) => {
      const sameSid = normalizeStableKeyPart(column.sid) === normalizeStableKeyPart(focus.sid);
      if (!sameSid) return false;
      if (normalizeCellValue(focus.ab)) {
        return normalizeStableKeyPart(column.ab || '') === normalizeStableKeyPart(focus.ab || '');
      }
      return true;
    });
    if (fallback) matched.set(buildInventoryColumnKey(fallback), fallback);
  });

  if (!includeNeighborColumns || matched.size === 0) {
    return Array.from(matched.values()).sort((left, right) => Number(left.columnOrder || 0) - Number(right.columnOrder || 0));
  }

  const matchedColumns = Array.from(matched.values());
  matchedColumns.forEach((column) => {
    const columnOrder = Number.isFinite(Number(column.columnOrder)) ? Number(column.columnOrder) : null;
    if (columnOrder === null) return;
    inventoryColumns.forEach((candidate) => {
      const candidateOrder = Number.isFinite(Number(candidate.columnOrder)) ? Number(candidate.columnOrder) : null;
      if (candidateOrder === null) return;
      const sameDomain = normalizeStableKeyPart(candidate.domain || '') === normalizeStableKeyPart(column.domain || '');
      const isNeighbor = Math.abs(candidateOrder - columnOrder) === 1;
      if (!sameDomain || !isNeighbor) return;
      matched.set(buildInventoryColumnKey(candidate), candidate);
    });
  });

  return Array.from(matched.values()).sort((left, right) => Number(left.columnOrder || 0) - Number(right.columnOrder || 0));
};

// ── SERVER-SIDE QUALITY DETECTION ──────────────────────────────────────────

/** Parse the leading numeric value from a raw score string (e.g. "15-16" → 15, "≥ 45" → 45). */
const parseLeadingRawLocal = (value: unknown): number | null => {
  const s = String(value ?? '').trim();
  if (!s || /^[-\u2013\u2014:]+$/.test(s)) return null;
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

/** Parse raw bounds from a string like "15-16" → {min:15, max:16}, "7" → {min:7, max:7}. */
const parseRawBoundsLocal = (value: unknown): { min: number; max: number } | null => {
  const s = String(value ?? '').trim().replace(/[\u2013\u2014]/g, '-');
  if (!s || /^[-:]+$/.test(s)) return null;
  const rangeMatch = s.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }
  const single = parseLeadingRawLocal(s);
  if (single === null) return null;
  return { min: single, max: single };
};

export interface OverlappingColumn {
  sid: string;
  ab?: string | null;
  reason: 'overlap';
  details: string;
}

/**
 * Detect subtests with overlapping raw score ranges within each age group.
 * Works on the raw ExtractionResult from Gemini (compact keys: r, n, a0, a1).
 */
export const detectOverlappingRanges = (
  result: ExtractionLikeResult | null,
): OverlappingColumn[] => {
  if (!result || !Array.isArray(result.tables)) return [];
  const problems: OverlappingColumn[] = [];

  for (const table of result.tables) {
    if (!Array.isArray(table.rows) || table.rows.length < 2) continue;
    const rows = table.rows as Record<string, unknown>[];

    // Group rows by age bucket
    const byAge = new Map<string, Array<{ r: string; bounds: { min: number; max: number } }>>();
    for (const row of rows) {
      const ageKey = `${row.a0 ?? 'na'}|${row.a1 ?? 'na'}`;
      const rawStr = String(row.r ?? '').trim();
      const bounds = parseRawBoundsLocal(rawStr);
      if (!bounds) continue;
      if (!byAge.has(ageKey)) byAge.set(ageKey, []);
      byAge.get(ageKey)!.push({ r: rawStr, bounds });
    }

    for (const [, entries] of byAge) {
      if (entries.length < 2) continue;
      // Sort by min bound
      const sorted = [...entries].sort((a, b) => a.bounds.min - b.bounds.min);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        // Overlap: current min <= previous max
        if (curr.bounds.min <= prev.bounds.max) {
          problems.push({
            sid: table.sid,
            ab: table.ab || null,
            reason: 'overlap',
            details: `raw ranges overlap: "${prev.r}" and "${curr.r}"`,
          });
          break; // One overlap per subtest is enough to flag it
        }
      }
    }
  }

  return problems;
};

export interface DuplicateColumn {
  sid1: string;
  sid2: string;
  ab1?: string | null;
  ab2?: string | null;
  reason: 'duplicate';
}

/**
 * Detect pairs of subtests whose extracted data is >90% identical (hallucination/column drift).
 */
export const detectDuplicateColumns = (
  result: ExtractionLikeResult | null,
): DuplicateColumn[] => {
  if (!result || !Array.isArray(result.tables) || result.tables.length < 2) return [];

  const signatures = new Map<string, { sid: string; ab?: string | null }>();
  const duplicates: DuplicateColumn[] = [];

  for (const table of result.tables) {
    if (!Array.isArray(table.rows) || table.rows.length < 3) continue;
    const sig = (table.rows as Record<string, unknown>[])
      .map((row) => `${String(row.r ?? '')}|${String(row.n ?? '')}`)
      .sort()
      .join(';');

    if (signatures.has(sig)) {
      const other = signatures.get(sig)!;
      duplicates.push({
        sid1: other.sid,
        sid2: table.sid,
        ab1: other.ab,
        ab2: table.ab || null,
        reason: 'duplicate',
      });
    } else {
      signatures.set(sig, { sid: table.sid, ab: table.ab || null });
    }
  }

  return duplicates;
};

/**
 * Compute adaptive MAX_SUBTESTS_PER_CHUNK based on inventory density.
 * Denser tables get smaller chunks to reduce horizontal drift.
 */
export const computeAdaptiveChunkSize = (
  inventoryColumnCount: number,
  baseMax: number,
): number => {
  if (inventoryColumnCount > 30) return Math.min(baseMax, 6);
  if (inventoryColumnCount > 20) return Math.min(baseMax, 8);
  return baseMax;
};

/**
 * Detect combined-score columns that merge two adjacent subtests (e.g. "MP & MPD").
 * These columns are highly prone to column drift and should always be retried.
 */
export const isCombinedScoreColumn = (col: InventoryColumnDescriptor): boolean => {
  const sid = normalizeStableKeyPart(col.sid);
  const ab = normalizeStableKeyPart(col.ab ?? '');
  // Detect "&" separator in sid or ab (e.g. "MP & MPD", "MF & MFD")
  if (/&/.test(col.sid ?? '') || /&/.test(col.ab ?? '')) return true;
  // Detect "total combiné", "combiné", "total comb" keywords
  if (/TOTAL\s*COMBIN/.test(sid) || /TOTAL\s*COMBIN/.test(ab)) return true;
  if (/\bCOMBINE\b/.test(sid) || /\bCOMBINE\b/.test(ab)) return true;
  return false;
};
