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
  columns: InventoryColumnDescriptor[];
}

export interface VerificationEntry {
  sid?: string | null;
  ab?: string | null;
  domain?: string | null;
  columnOrder?: number | null;
  isInverted?: boolean | null;
  min_n?: number | null;
  max_n?: number | null;
  min_r?: string | null;
  max_r?: string | null;
  count?: number | null;
}

export interface VerificationScanResult {
  verify: VerificationEntry[];
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

export interface VerificationMismatch {
  sid: string;
  ab: string;
  domain?: string | null;
  columnOrder?: number | null;
  isInverted?: boolean | null;
  reason: string;
}

export interface InventoryChunk {
  domainHint: string;
  columns: InventoryColumnDescriptor[];
}

export interface ExtractionRoutingDecision {
  mode: 'parametric-full' | 'lookup-full-verified' | 'lookup-chunked-verified';
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

export const buildInventoryColumnKey = (column: Pick<InventoryColumnDescriptor, 'sid' | 'ab'>): string => (
  `${normalizeStableKeyPart(column.sid)}::${normalizeStableKeyPart(column.ab || 'NOABBR')}`
);

const buildTableKey = (table: Pick<ExtractionLikeTable, 'sid' | 'ab'>): string => (
  `${normalizeStableKeyPart(table.sid)}::${normalizeStableKeyPart(table.ab || 'NOABBR')}`
);

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

  if (isInverted) {
    return {
      mode: 'lookup-chunked-verified',
      inventoryColumnCount,
      isInverted: true,
      reason: 'inverted-lookup',
    };
  }

  if (inventoryColumnCount > chunkedThreshold) {
    return {
      mode: 'lookup-chunked-verified',
      inventoryColumnCount,
      isInverted: false,
      reason: 'dense-lookup',
    };
  }

  return {
    mode: 'lookup-full-verified',
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
        // Abbreviation must match if both are present
        const abMatch = !colAb || !entry.ab || normalizeStableKeyPart(colAb) === normalizeStableKeyPart(entry.ab);
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

const buildRowSignature = (row: Record<string, unknown>): string => {
  const raw = normalizeCellValue(row.r);
  const standard = normalizeCellValue(row.n);
  const percentile = normalizeCellValue(row.p);
  const zScore = normalizeCellValue(row.z);
  return `${raw}|${standard}|${percentile}|${zScore}`;
};

const countIntersection = (left: Set<string>, right: Set<string>): number => {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let count = 0;
  smaller.forEach((value) => {
    if (larger.has(value)) count += 1;
  });
  return count;
};

const extractNumericBoundaries = (rows: Record<string, unknown>[]) => {
  const nValues = rows
    .map((row) => toFiniteNumber(row.n))
    .filter((value): value is number => value !== null);

  const minN = nValues.length > 0 ? Math.min(...nValues) : null;
  const maxN = nValues.length > 0 ? Math.max(...nValues) : null;
  const rowAtMinN = minN !== null ? rows.find((row) => toFiniteNumber(row.n) === minN) : undefined;
  const rowAtMaxN = maxN !== null ? rows.find((row) => toFiniteNumber(row.n) === maxN) : undefined;

  return {
    count: rows.length,
    minN,
    maxN,
    minR: normalizeCellValue(rowAtMinN?.r),
    maxR: normalizeCellValue(rowAtMaxN?.r),
  };
};

export const compareVerificationResults = (
  extraction: ExtractionLikeResult,
  verification: VerificationScanResult,
  inventoryColumns: InventoryColumnDescriptor[],
): VerificationMismatch[] => {
  if (!Array.isArray(inventoryColumns) || inventoryColumns.length === 0) return [];
  if (!verification?.verify || !Array.isArray(verification.verify)) return [];
  if (!Array.isArray(extraction?.tables)) return [];

  const mismatches: VerificationMismatch[] = [];
  const inventoryByKey = new Map<string, InventoryColumnDescriptor>();
  inventoryColumns.forEach((column) => inventoryByKey.set(buildInventoryColumnKey(column), column));

  const verificationByKey = new Map<string, VerificationEntry[]>();
  verification.verify.forEach((entry) => {
    const sid = normalizeCellValue(entry.sid);
    const ab = normalizeCellValue(entry.ab);
    if (!ab) return;
    const inventoryMatch = inventoryColumns.find((column) => {
      const sameAb = normalizeStableKeyPart(column.ab || '') === normalizeStableKeyPart(ab);
      if (!sameAb) return false;
      if (sid) return normalizeStableKeyPart(column.sid) === normalizeStableKeyPart(sid);
      if (entry.columnOrder != null && column.columnOrder != null) {
        return Number(column.columnOrder) === Number(entry.columnOrder);
      }
      return true;
    });
    const key = inventoryMatch ? buildInventoryColumnKey(inventoryMatch) : `${normalizeStableKeyPart(sid || 'UNKNOWN')}::${normalizeStableKeyPart(ab)}`;
    if (!verificationByKey.has(key)) verificationByKey.set(key, []);
    verificationByKey.get(key)!.push(entry);
  });

  const extractionByKey = new Map<string, ExtractionLikeTable[]>();
  extraction.tables.forEach((table) => {
    const key = buildTableKey(table);
    if (!extractionByKey.has(key)) extractionByKey.set(key, []);
    extractionByKey.get(key)!.push(table);
  });

  const extractedCursorByKey = new Map<string, number>();
  const verifiedCursorByKey = new Map<string, number>();
  const extractedByInventoryIndex = new Map<number, ExtractionLikeTable>();
  const indexedColumns = inventoryColumns.map((column, index) => ({ column, index }));

  indexedColumns.forEach(({ column, index }) => {
    const key = buildInventoryColumnKey(column);
    const verified = popByOccurrence(verificationByKey, verifiedCursorByKey, key);
    const extracted = popByOccurrence(extractionByKey, extractedCursorByKey, key);

    if (extracted) extractedByInventoryIndex.set(index, extracted);

    if (!extracted || !Array.isArray(extracted.rows) || extracted.rows.length === 0) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: 'missing_table',
      });
      return;
    }

    if (!verified) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: 'missing_verification_entry',
      });
      return;
    }

    const extractedBoundaries = extractNumericBoundaries(extracted.rows);
    const verifiedCount = Number.isFinite(Number(verified.count)) ? Number(verified.count) : null;
    const verifiedMinN = Number.isFinite(Number(verified.min_n)) ? Number(verified.min_n) : null;
    const verifiedMaxN = Number.isFinite(Number(verified.max_n)) ? Number(verified.max_n) : null;
    const verifiedMinR = normalizeCellValue(verified.min_r);
    const verifiedMaxR = normalizeCellValue(verified.max_r);

    if (verifiedCount !== null && Math.abs(extractedBoundaries.count - verifiedCount) > 0) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: `row_count:${extractedBoundaries.count}:${verifiedCount}`,
      });
      return;
    }

    if (verifiedMinN !== null && extractedBoundaries.minN !== null && extractedBoundaries.minN !== verifiedMinN) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: `min_n:${extractedBoundaries.minN}:${verifiedMinN}`,
      });
      return;
    }

    if (verifiedMaxN !== null && extractedBoundaries.maxN !== null && extractedBoundaries.maxN !== verifiedMaxN) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: `max_n:${extractedBoundaries.maxN}:${verifiedMaxN}`,
      });
      return;
    }

    if (verifiedMinR && extractedBoundaries.minR && extractedBoundaries.minR !== verifiedMinR) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: `min_r:${extractedBoundaries.minR}:${verifiedMinR}`,
      });
      return;
    }

    if (verifiedMaxR && extractedBoundaries.maxR && extractedBoundaries.maxR !== verifiedMaxR) {
      mismatches.push({
        sid: column.sid,
        ab: normalizeCellValue(column.ab),
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted ?? null,
        reason: `max_r:${extractedBoundaries.maxR}:${verifiedMaxR}`,
      });
    }
  });

  const orderedColumns = [...indexedColumns].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.column.columnOrder)) ? Number(left.column.columnOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(right.column.columnOrder)) ? Number(right.column.columnOrder) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  for (let index = 1; index < orderedColumns.length; index += 1) {
    const previous = orderedColumns[index - 1];
    const current = orderedColumns[index];
    const sameDomain = normalizeStableKeyPart(previous.column.domain || '') === normalizeStableKeyPart(current.column.domain || '');
    if (!sameDomain) continue;

    const previousTable = extractedByInventoryIndex.get(previous.index);
    const currentTable = extractedByInventoryIndex.get(current.index);
    if (!previousTable?.rows || !currentTable?.rows || previousTable.rows.length === 0 || currentTable.rows.length === 0) {
      continue;
    }

    const previousSignatures = new Set(previousTable.rows.map((row) => buildRowSignature(row)));
    const currentSignatures = new Set(currentTable.rows.map((row) => buildRowSignature(row)));
    const sharedCount = countIntersection(previousSignatures, currentSignatures);
    const overlapRatio = sharedCount / Math.max(1, Math.min(previousSignatures.size, currentSignatures.size));
    if (overlapRatio < 0.9) continue;

    mismatches.push({
      sid: current.column.sid,
      ab: normalizeCellValue(current.column.ab),
      domain: current.column.domain || null,
      columnOrder: current.column.columnOrder ?? null,
      isInverted: current.column.isInverted ?? null,
      reason: `adjacent_duplicate:${normalizeCellValue(previous.column.ab)}:${sharedCount}`,
    });
  }

  return mismatches;
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
