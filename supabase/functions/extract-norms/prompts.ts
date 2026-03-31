import type { InventoryColumnDescriptor, InventoryScanResult } from "./extractionUtils.ts";

// ── TYPES ──────────────────────────────────────────────────────────────────

export interface RepairFocusSubtest {
  name: string;
  abbreviation?: string | null;
  domain?: string | null;
  columnOrder?: number | null;
  isInverted?: boolean | null;
}

export interface RepairExpectedGroupCount {
  groupLabel: string;
  expectedCount: number;
}

export interface RepairRequestPayload {
  focusSubtests: RepairFocusSubtest[];
  expectedGroupCounts: RepairExpectedGroupCount[];
  includeNeighborColumns: boolean;
  existingSubtests: string[];
  dominantAgeMin?: number | null;
  dominantAgeMax?: number | null;
}

export interface InventoryResult extends InventoryScanResult {}

// ── PROMPT HELPERS ─────────────────────────────────────────────────────────

export const normalizePromptToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeInventoryToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const SCORE_SCALE_TOKENS = new Set([
  'NS',
  'NOTESTANDARD',
  'NOTESTANDARDS',
  'NOTEETALONNEE',
  'NOTEETALONNEES',
  'SCORESTANDARD',
  'SCORESSTANDARD',
  'STANDARDSCORE',
  'SCALEDSCORE',
]);

export const isLikelyScoreScaleColumn = (sid: string, ab: string): boolean => {
  const sidToken = normalizeInventoryToken(sid);
  const abToken = normalizeInventoryToken(ab);
  if (!sidToken && !abToken) return false;

  if (SCORE_SCALE_TOKENS.has(sidToken)) return true;
  if (sidToken.startsWith('NOTEETALONNEE') || sidToken.startsWith('NOTESTANDARD') || sidToken.startsWith('SCORESTANDARD')) {
    return true;
  }

  if ((abToken === 'NS' || SCORE_SCALE_TOKENS.has(abToken)) && (sidToken === 'NS' || sidToken.includes('NOTE') || sidToken.includes('SCORE'))) {
    return true;
  }

  return false;
};

const buildKnownNamesBlock = (knownSubtestNames: string[]): string => {
  if (!knownSubtestNames || knownSubtestNames.length === 0) return '';
  return `
--- KNOWN SUBTESTS FROM PREVIOUS PAGES ---
The following subtest names have already been extracted from earlier pages of the SAME test manual.
YOU MUST REUSE these exact names when you encounter the same subtests on this page (even if the table header phrasing differs slightly).
Known names: ${JSON.stringify(knownSubtestNames)}
Only create a NEW subtest name if the subtest is genuinely different from all of the above.
`;
};

const buildScoreTypeHintBlock = (scoreTypeHint: string | undefined): string => {
  if (!scoreTypeHint) return '';
  const descriptions: Record<string, string> = {
    scaled: 'Scaled scores (NS/Note Standard), range 1-19, mean 10, SD 3.',
    standard: 'Standard scores (QI/Score Standard), range 40-160, mean 100, SD 15.',
    percentile: 'Percentile ranks, range 0-100.',
    't-score': 'T-scores, range 20-80, mean 50, SD 10.',
    stanine: 'Stanine scores, range 1-9, mean 5, SD 2.',
    sten: 'Sten scores, range 1-10, mean 5.5, SD 2.',
  };
  const desc = descriptions[scoreTypeHint] ?? scoreTypeHint;
  return `
--- SCORE TYPE HINT ---
The subtests in this test are expected to use: ${scoreTypeHint.toUpperCase()} (${desc})
Use this to validate your classification. If the column values match this range, classify accordingly.
Do NOT override this hint unless the data clearly contradicts it (e.g. values far outside the expected range).
`;
};

const buildCanonicalNamesBlock = (canonicalSubtestNames: string[]): string => {
  if (!canonicalSubtestNames || canonicalSubtestNames.length === 0) return '';
  return `
--- EXPECTED SUBTESTS (CANONICAL NAMES) ---
The user has identified this image as belonging to a known test. The canonical subtest names for this test are:
${JSON.stringify(canonicalSubtestNames)}
Use your clinical knowledge to resolve abbreviations to the full French clinical name.
If a column clearly matches one of the canonical names above, use that EXACT canonical name as the "sid" value.

CRITICAL - UNIQUE NAMING PROCEDURE BY STRUCTURE:
For PARAMETRIC tables:
- Do NOT create one sid per statistical column.
- "Moyenne"/"ET"/"SD" are value columns, not subtests.
- Keep one sid per clinical subtest only.
For LOOKUP tables:
- Read every data column header abbreviation.
- Keep one unique sid per lookup column variant and store the source abbreviation in "ab".
- If two columns would collide to the same sid, add a qualifier or fallback to abbreviation.
`;
};

// ── EXTRACTION RULES ───────────────────────────────────────────────────────

const EXTRACTION_RULES = `
--- STEP 1: CLASSIFICATION (st) ---
A) "PARAMETRIC": Contains statistical constants per group (Mean/Moyenne/M AND SD/Ecart-Type/Sigma).
   The table does NOT map raw scores to percentiles directly. It gives the formula constants.
   PARAMETRIC HARD RULE: Statistical headers (Moyenne, M, ET, SD, Sigma, N, Nombre de sujets, %) are VALUES or METADATA, never subtest names (sid).
   PARAMETRIC HARD RULE: If you see statistical headers, you MUST look at the table title or surrounding context to find the CLINICAL subtest name (e.g. "Automatisation de la frappe").
B) "LOOKUP": Maps Raw Scores (ranges or single values) to Standard Scores (NS, Scaled) or Percentiles.

--- STEP 2: EXTRACTION RULES ---
1. PIVOT: If columns represent Ages/Grades and rows represent Stats (M, SD), YOU MUST PIVOT. Create ONE object per Age/Grade.
2. INVERTED / TRANSPOSED LOOKUP: Some LOOKUP tables are printed TRANSPOSED — ROWS = standard/scaled scores (e.g. NS 1-19 or "Note Standard" column on the left) and COLUMNS = subtests (or age groups).
   Detection: if the leftmost column header is "NS", "Note Standard", "Note Étalonnée", or a descending/ascending sequence of integers (1-19), the table IS inverted.
   The cell value is the raw score (single value or range). You MUST output one "sid" table entry per DATA COLUMN, with:
   - "r" = cell value (the raw score read from the cell)
   - "n" = row header (the NS/standard score from the left column) — MANDATORY, NEVER EMPTY
  - One row object per visible cell in that column.
  - IMPORTANT: Cells containing "-", "–", "—" or ":" are NOT empty placeholders. They indicate "not scorable" and MUST be output as r:"-" with the corresponding n.
   CRITICAL FOR INVERTED TABLES: Read each column independently, top to bottom. Do NOT confuse adjacent columns. Mentally trace a vertical line from the column header down to each cell to verify horizontal alignment.
   EXAMPLE (inverted LOOKUP with NS 1-19 and 2 columns AA and CC):
   {"st":"LOOKUP","tables":[
     {"sid":"AA","ab":"AA","rows":[{"r":"0","n":"1"},{"r":"1-2","n":"2"},{"r":"3","n":"3"},{"r":"-","n":"4"}]},
     {"sid":"CC","ab":"CC","rows":[{"r":"0-5","n":"1"},{"r":"6","n":"2"},{"r":"7-8","n":"3"},{"r":"9","n":"4"}]}
   ]}
   Notice: EVERY row has "n" set to the NS value from the left column. n is NEVER empty.
3. VALUES:
   - If Parametric: Extract "m" and "s".
   - If Parametric and a row/column has a class label (e.g. CE1, 6e, 2nde), also output "gl" with that original label.
   - If Lookup: Extract "r", "n", "p".
4. ACCURACY:
   - Clean units (sec, pts).
   - Keep decimals.
   - For LOOKUP, keep raw score ranges as strings (e.g. "0-5").
4b. DENSE TABLE READING STRATEGY (CRITICAL for tables with more than 8 data columns):
   - Read the table COLUMN BY COLUMN, not row by row.
  - For each column: (a) identify the column header/abbreviation, (b) scan every row from top to bottom, (c) record each visible cell with its row header (the NS/score from the leftmost column).
  - Dash-like cells ("-", "–", "—", ":") count as visible cells and must be extracted as r:"-".
  - After extracting each column, VERIFY the count of extracted values matches the number of visible cells in that column.
   - Common error on dense tables: reading a neighboring column's value instead of the target column. To prevent this, mentally trace a strict vertical line from the column header down to each cell.
   - The LAST columns (rightmost) are just as important as the first. Do NOT stop reading early.
4c. RANGE BOUNDARY CONTINUITY (CRITICAL for inverted LOOKUP):
   - Consecutive NS rows for the SAME column must have CONTIGUOUS, non-overlapping raw ranges.
   - If you read "A-Y" at NS k then "Y-Z" at NS k+1 (overlap at Y), re-read — the correct value is likely "Y+1-Z" (off-by-one boundary error).
   - After extracting all rows for a column, scan the raw ranges from NS 1 to NS 19 and verify NO boundary overlaps.
4d. RANGE vs SINGLE VALUE:
   - When a cell contains a dash-range "X-Y" (e.g. "8-9"), you MUST output BOTH bounds as a single string "8-9".
   - Common error: reading only "9" instead of "8-9". If adjacent cells in the same column have ranges, this cell likely has a range too — re-check.
4e. DASH vs ZERO DISTINCTION:
   - A dash "—" (not scorable) is fundamentally different from "0" (scorable floor).
   - At extreme NS values (1-2 or 17-19), dashes are common. Verify: if adjacent columns also show dashes at the same NS row, a dash is correct.
   - Never replace a dash with "0" or vice versa.
4f. STANDARD SCORE CAPTURE — MANDATORY FOR ALL INVERTED LOOKUP:
   - The shared left NS column (1, 2, 3, ..., 19) provides the "n" value for EVERY row of EVERY subtest column.
   - You MUST set n = the NS integer from the leftmost column for EVERY row you output. No row may have an empty n.
   - VALIDATION: After generating all rows for a column, verify that n values form a complete or near-complete sequence (1, 2, 3, ..., up to 19). If any row is missing n, you have a bug — go back and re-read the leftmost column.
4g. SPECIAL CHARACTERS:
   - Preserve ≥, ≤, >, < symbols EXACTLY as they appear in the image. Do NOT replace them with letters (e.g. do NOT write "da45" instead of "≥ 45").
   - Common prefixes: "≥" (greater or equal), "≤" (less or equal). Copy them verbatim into the r field.
5. SUBTEST NAMING:
   - DISAMBIGUATION POLICY BY STRUCTURE:
     PARAMETRIC:
       - Statistical headers ("Moyenne", "M", "ET", "SD", "Sigma", "N", "Nombre de sujets") are strictly mapped to row values (m, s) or ignored (N). They MUST NOT appear in "sid".
       - One clinical subtest = ONE sid. If a table only has stat headers, derive the sid from the table title/text above.
       - Do not output separate sid entries such as "Copie (ET)" or "Copie (MOYENNE)".
       - Each sid must represent the clinical subtest only (e.g. "Copie", "Dictée", "Répétition", "Automatisation de la frappe").
     LOOKUP:
       - ABSOLUTE RULE: each data column on the page = 1 unique sid.
       - PRE-WRITING COLUMN COUNT (MANDATORY): count the exact number of data columns before output. "tables" must match that count exactly.
       - Store the ORIGINAL column header text in "ab" for each table entry.
       - ALWAYS set sid = ab (keep the original column header). Do NOT expand, translate, or rename. Name resolution is handled client-side.
       - Do NOT add age, grade, or side qualifiers in the subtest name.
6. GROUPING:
   - For LOOKUP: Each "sid" entry groups all rows for ONE subtest. If the page covers a single age group (visible in the header), ALL rows under that subtest share the same a0/a1.
   - For PARAMETRIC: Each "sid" entry groups all age/grade rows for ONE subtest.
   COMPLETENESS CHECK (LOOKUP):
  - For inverted/transposed LOOKUP tables with NS rows (1-19 or similar), each subtest column should produce up to 19 rows.
  - If a cell is a dash-like token ("-", "–", "—", ":"), output r:"-" for that NS row (do NOT skip it).
  - Skip only truly blank/absent cells where no glyph is visible.
   - If you extracted significantly fewer rows for one column than for its neighbors, re-scan that column before finalizing.
   - The highest raw score for a subtest is typically at the highest NS (e.g. NS 19). Verify you did not stop reading a column early or confuse it with an adjacent column.
   - After generating the full output, do a final spot-check: compare the LAST two columns' max raw scores with what you see in the image. If they differ, re-read those columns.
4h. DUPLICATE RAW VALUE CHECK (CRITICAL):
   - For inverted LOOKUP: if the SAME single raw value (e.g. "0") appears at two consecutive NS rows in the same column, this is almost always an error. Re-read that cell pair carefully — one is usually a dash or a different value.
   - Exception: dash values ("-") may legitimately repeat across consecutive NS rows.
4i. COLUMN UNIQUENESS CHECK:
   - After extracting all columns, verify that no two columns have identical data arrays. If two columns produce the exact same rows (same r values for every NS), you have column drift — re-read both columns independently, paying strict attention to their physical position.

--- STEP 3: NORMALIZATION RULES (CRITICAL FOR DATABASE) ---
You must calculate specific numeric values for the database:
1. AGE NORMALIZATION (a0, a1):
   - Convert label "4;6" or "4 ans 6 mois" -> 54 months.
   - Convert range "4;0 - 4;5" -> a0: 48, a1: 53.
   - If only grade is available, convert grade to age range in months using school mapping.
   - Primary grades: CP=72-83, CE1=84-95, CE2=96-107, CM1=108-119, CM2=120-131.
   - Secondary grades: 6e=132-143, 5e=144-155, 4e=156-167, 3e=168-179, 2nde=180-191, 1ere=192-203, Terminale=204-215.
   - STRICT RULE: never interpolate missing school levels; if a class is absent in the source, keep it absent.
   - CRITICAL: labels like "6e", "4e", "2nde" are grade levels, NOT ages 6/4/2 years. Never map them to 72/48/24 months.
   - PAGE-LEVEL AGE: When the page title, header, column heading, OR FILENAME shows an age group (e.g. "Ages 10;6-10;11", or filename "10;6-10;11.jpg", "13ans.jpg", "CE1.png"), that SINGLE age group applies to EVERY row on the entire page. Set pa0/pa1 at the top level. You do NOT need to repeat a0/a1 on every row — omit a0/a1 from rows when pa0/pa1 is set.
   - FILENAME AGE: If the filename contains an age hint (e.g. "5ans6mois" = 66 months, "13ans" = 156 months, "CE1" = ~84 months, "10;6-10;11" = 126-131 months), use it for pa0/pa1 when no age is visible in the table headers.
   - For LOOKUP tables, age must NEVER be missing. Set it via pa0/pa1 (page-level) or a0/a1 (row-level for multi-age pages).
   - OUTPUT TOKEN OPTIMIZATION: Do NOT output a0/a1 on rows when pa0/pa1 is set at top level (client inherits automatically). Only output row-level a0/a1 when rows have DIFFERENT ages (e.g. PARAMETRIC tables with multiple age groups).
2. RAW SCORE FORMAT (r):
   - Keep raw scores as display strings in "r" (e.g. "15-16", "7", "<5", ">19").
   - Do NOT output r0 or r1 — the client parses raw bounds from "r" automatically.
`;

const JSON_SCHEMA = `
--- JSON OUTPUT SCHEMA (compact keys to save tokens) ---
{
  "tc": "string (Detected name of the test)",
  "st": "PARAMETRIC" | "LOOKUP",
  "pa0": number | null (page-level age_min in months — from the page header/title age group),
  "pa1": number | null (page-level age_max in months — from the page header/title age group),
  "tables": [
    {
      "sid": "string (Subtest name — FULL French clinical name, or raw abbreviation if expansion would duplicate)",
      "ab": "string (Original column abbreviation exactly as printed in the image, e.g. 'MF', 'MFDC')",
      "rows": [
        {
          "m": "string (Only if PARAMETRIC: Mean)",
          "s": "string (Only if PARAMETRIC: SD)",
          "r": "string (Only if LOOKUP: Raw Score as displayed, e.g. '0-3', '7', '<5')",
          "n": "string (Only if LOOKUP: Standard Score / Note Étalonnée)",
          "p": "string (Percentile if explicit)",
          "z": "string (Z-Score if explicit)",
          "gl": "string (Optional source class/grade label such as CE1, 6e, 2nde)",
          "a0": number (ONLY if rows have different ages — omit when pa0/pa1 covers all rows),
          "a1": number (ONLY if rows have different ages — omit when pa0/pa1 covers all rows)
        }
      ]
    }
  ]
}

KEY LEGEND: tc=test_context, st=structure_type, pa0=page_age_min_months, pa1=page_age_max_months, sid=subtest_id, ab=source_abbreviation, m=mean, s=sd, r=raw_range, n=standard, p=percentile, z=z_score, gl=group_label, a0=age_min_months, a1=age_max_months.
TOKEN SAVING: When pa0/pa1 is set, do NOT repeat a0/a1 on each row. Do NOT output r0/r1 — client computes them from "r".

OUTPUT RULES:
- Output valid JSON only.
- Do not use Markdown code blocks.
- Minify the JSON (no unnecessary whitespace).
- You MUST extract ALL subtests and ALL rows visible on the page. Do NOT stop early.
`;

// ── GEMINI RESPONSE SCHEMAS ────────────────────────────────────────────────

export const EXTRACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    tc: { type: 'STRING', description: 'Detected test name' },
    st: { type: 'STRING', enum: ['PARAMETRIC', 'LOOKUP'], description: 'Table structure type' },
    pa0: { type: 'INTEGER', nullable: true, description: 'Page-level age_min in months' },
    pa1: { type: 'INTEGER', nullable: true, description: 'Page-level age_max in months' },
    tables: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sid: { type: 'STRING', description: 'Column header abbreviation (same as ab). Do NOT expand or translate.' },
          ab: { type: 'STRING', description: 'Original column abbreviation exactly as printed' },
          rows: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                m: { type: 'STRING', description: 'Mean (PARAMETRIC)' },
                s: { type: 'STRING', description: 'SD (PARAMETRIC)' },
                r: { type: 'STRING', description: 'Raw score range (LOOKUP)' },
                n: { type: 'STRING', description: 'Standard score (LOOKUP)' },
                p: { type: 'STRING', description: 'Percentile' },
                z: { type: 'STRING', description: 'Z-score' },
                gl: { type: 'STRING', description: 'Grade/class label' },
                a0: { type: 'INTEGER', description: 'Row age_min months' },
                a1: { type: 'INTEGER', description: 'Row age_max months' },
              },
            },
          },
        },
        required: ['sid', 'rows'],
      },
    },
  },
  required: ['st', 'tables'],
};

// LOOKUP-specific schema: r and n are required on every row so Gemini never omits them.
export const LOOKUP_EXTRACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    tc: { type: 'STRING', description: 'Detected test name' },
    st: { type: 'STRING', enum: ['LOOKUP'], description: 'Table structure type' },
    pa0: { type: 'INTEGER', nullable: true, description: 'Page-level age_min in months' },
    pa1: { type: 'INTEGER', nullable: true, description: 'Page-level age_max in months' },
    tables: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sid: { type: 'STRING', description: 'Column header abbreviation (same as ab). Do NOT expand or translate.' },
          ab: { type: 'STRING', description: 'Original column abbreviation exactly as printed' },
          rows: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                r: { type: 'STRING', description: 'Raw score range as displayed (e.g. "0-3", "7", "<5")' },
                n: { type: 'STRING', description: 'Standard score / Note Etalonnee from the leftmost NS column — NEVER empty' },
                p: { type: 'STRING', description: 'Percentile' },
                z: { type: 'STRING', description: 'Z-score' },
                gl: { type: 'STRING', description: 'Grade/class label' },
                a0: { type: 'INTEGER', description: 'Row age_min months' },
                a1: { type: 'INTEGER', description: 'Row age_max months' },
              },
              required: ['r', 'n'],
            },
          },
        },
        required: ['sid', 'rows'],
      },
    },
  },
  required: ['st', 'tables'],
};

export const INVENTORY_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    tc: { type: 'STRING' },
    st: { type: 'STRING', enum: ['PARAMETRIC', 'LOOKUP'] },
    isInverted: { type: 'BOOLEAN' },
    columns: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sid: { type: 'STRING' },
          ab: { type: 'STRING' },
          domain: { type: 'STRING' },
          tableOrder: { type: 'INTEGER' },
          columnOrder: { type: 'INTEGER' },
          isInverted: { type: 'BOOLEAN' },
        },
        required: ['sid', 'ab'],
      },
    },
  },
  required: ['columns'],
};

// ── INVENTORY PARSING ──────────────────────────────────────────────────────

const sanitizeInventoryColumns = (columns: unknown): InventoryColumnDescriptor[] => {
  if (!Array.isArray(columns)) return [];

  const sanitized: Array<InventoryColumnDescriptor | null> = columns
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Record<string, unknown>;
      const sid = normalizePromptToken(value.sid);
      const ab = normalizePromptToken(value.ab);
      if (!sid || !ab) return null;
      if (isLikelyScoreScaleColumn(sid, ab)) return null;

      const domain = normalizePromptToken(value.domain);
      const columnOrderRaw = Number(value.columnOrder);
      const tableOrderRaw = Number(value.tableOrder);

      // Clamp order values — Gemini occasionally hallucinates astronomically large
      // integers (e.g. 1e120). In IEEE 754 these are finite, so Math.trunc passes
      // but the value is useless for sorting. Cap to a safe display range.
      const MAX_ORDER = 10_000;
      return {
        sid,
        ab,
        domain: domain || null,
        columnOrder: Number.isFinite(columnOrderRaw) ? Math.min(Math.trunc(columnOrderRaw), MAX_ORDER) : null,
        tableOrder: Number.isFinite(tableOrderRaw) ? Math.min(Math.trunc(tableOrderRaw), MAX_ORDER) : null,
        isInverted: value.isInverted === true,
      };
    });

  const nonNull = sanitized.filter((entry) => entry !== null) as InventoryColumnDescriptor[];

  return nonNull
    .sort((left, right) => {
      const leftTableOrder = Number.isFinite(Number(left.tableOrder)) ? Number(left.tableOrder) : 1;
      const rightTableOrder = Number.isFinite(Number(right.tableOrder)) ? Number(right.tableOrder) : 1;
      if (leftTableOrder !== rightTableOrder) return leftTableOrder - rightTableOrder;
      const leftColumnOrder = Number.isFinite(Number(left.columnOrder)) ? Number(left.columnOrder) : Number.MAX_SAFE_INTEGER;
      const rightColumnOrder = Number.isFinite(Number(right.columnOrder)) ? Number(right.columnOrder) : Number.MAX_SAFE_INTEGER;
      if (leftColumnOrder !== rightColumnOrder) return leftColumnOrder - rightColumnOrder;
      return `${left.sid}::${left.ab}`.localeCompare(`${right.sid}::${right.ab}`);
    });
};

export const parseInventoryResult = (text: string | null): InventoryResult | null => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      tc: typeof parsed.tc === 'string' ? parsed.tc : null,
      st: typeof parsed.st === 'string' ? parsed.st : null,
      isInverted: parsed.isInverted === true,
      columns: sanitizeInventoryColumns(parsed.columns),
    };
  } catch {
    return null;
  }
};

export const parseRepairRequest = (raw: unknown): RepairRequestPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const focusSubtests = Array.isArray(input.focusSubtests)
    ? input.focusSubtests
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const value = entry as Record<string, unknown>;
        const name = normalizePromptToken(value.name);
        const abbreviation = normalizePromptToken(value.abbreviation);
        const domain = normalizePromptToken(value.domain);
        const columnOrderRaw = Number(value.columnOrder);
        const columnOrder = Number.isFinite(columnOrderRaw) ? Math.trunc(columnOrderRaw) : null;
        if (!name) return null;
        return {
          name,
          abbreviation: abbreviation || null,
          domain: domain || null,
          columnOrder,
          isInverted: value.isInverted === true,
        } as RepairFocusSubtest;
      })
      .filter((entry): entry is RepairFocusSubtest => !!entry)
    : [];

  if (focusSubtests.length === 0) return null;

  const expectedGroupCounts = Array.isArray(input.expectedGroupCounts)
    ? input.expectedGroupCounts
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const value = entry as Record<string, unknown>;
        const groupLabel = normalizePromptToken(value.groupLabel);
        const expectedRaw = Number(value.expectedCount);
        const expectedCount = Number.isFinite(expectedRaw) ? Math.trunc(expectedRaw) : NaN;
        if (!groupLabel || !Number.isFinite(expectedCount) || expectedCount <= 0) return null;
        return { groupLabel, expectedCount } as RepairExpectedGroupCount;
      })
      .filter((entry): entry is RepairExpectedGroupCount => !!entry)
    : [];

  const existingSubtests = Array.isArray(input.existingSubtests)
    ? input.existingSubtests
      .map((name) => normalizePromptToken(name))
      .filter((name) => !!name)
    : [];

  const dominantAgeMinRaw = Number(input.dominantAgeMin);
  const dominantAgeMaxRaw = Number(input.dominantAgeMax);
  const dominantAgeMin = Number.isFinite(dominantAgeMinRaw) ? Math.trunc(dominantAgeMinRaw) : null;
  const dominantAgeMax = Number.isFinite(dominantAgeMaxRaw) ? Math.trunc(dominantAgeMaxRaw) : null;

  return {
    focusSubtests,
    expectedGroupCounts,
    includeNeighborColumns: input.includeNeighborColumns === true,
    existingSubtests,
    dominantAgeMin,
    dominantAgeMax,
  };
};

// ── PROMPT BUILDERS ────────────────────────────────────────────────────────

export const buildFullExtractionTask = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
TASK: Analyze the image, CLASSIFY the table structure, then EXTRACT and NORMALIZE ALL data from ALL tables on this page.

CRITICAL: This page may contain MULTIPLE tables or sections (e.g. upper table + lower table). You MUST extract data from ALL of them, not just the first one.
${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

export const buildInventoryScanTaskV2 = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
${buildCanonicalNamesBlock(canonicalSubtestNames)}
TASK: Build a PHYSICAL COLUMN INVENTORY for this page before any extraction.

Inspect ALL tables or sections on the page and return every DATA COLUMN in physical left-to-right order.

For each physical data column, return:
- "sid": FULL French clinical subtest name
- "ab": original printed abbreviation exactly as visible in the image
- "domain": visible section/domain header above that column
- "tableOrder": 1-based order of the table block on the page (top table=1, next table=2, etc.)
- "columnOrder": 1-based left-to-right order inside that table block
- "isInverted": true if the table is inverted/transposed (leftmost column is NS / Note étalonnée / a 1-19 score scale)

IMPORTANT COLUMN FILTER:
- EXCLUDE the left score scale column itself (e.g. NS / Note etalonnee / Note standard).
- INCLUDE only true subtest data columns that contain raw-score cells.

Also detect the structure type:
- "PARAMETRIC" if the table contains Mean/SD statistical constants
- "LOOKUP" if it maps raw scores to standard scores or percentiles

OUTPUT JSON ONLY:
{
  "tc": "string",
  "st": "PARAMETRIC" | "LOOKUP",
  "isInverted": true | false,
  "columns": [
    {
      "sid": "string",
      "ab": "string",
      "domain": "string",
      "tableOrder": number,
      "columnOrder": number,
      "isInverted": true | false
    }
  ]
}

RULES:
- Include ALL data columns from ALL tables on the page.
- "columns" must follow physical order as printed in the image.
- For "sid": ALWAYS set sid = ab (same value as the column header abbreviation). Do NOT expand or translate. Name resolution is handled client-side.
- Do not stop early after the first domain or first table.
- If the page is LOOKUP, the inventory must include the rightmost columns too.`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

export const buildFocusedExtractionTaskV2 = (
  payload: Record<string, unknown>,
  focusColumns: InventoryColumnDescriptor[],
  domainHint: string,
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;
  const serializedColumns = focusColumns.map((column) => ({
    sid: column.sid,
    ab: column.ab || null,
    domain: column.domain || null,
    tableOrder: column.tableOrder ?? null,
    columnOrder: column.columnOrder ?? null,
    isInverted: column.isInverted === true,
  }));

  // When canonical names are provided (test known in DB), they are authoritative.
  // Skip known-names-from-history block to avoid token bloat as page count grows.
  const knownNamesBlock = canonicalSubtestNames.length > 0
    ? ''
    : buildKnownNamesBlock(knownSubtestNames);

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${knownNamesBlock}${buildScoreTypeHintBlock(scoreTypeHint)}
FOCUS CONSTRAINT: Extract data ONLY for these specific physical columns: ${JSON.stringify(serializedColumns)}
These belong to the domain section: "${domainHint}".
IGNORE all other columns entirely. Only output data for the listed columns.

CRITICAL FOR DENSE / INVERTED LOOKUP TABLES:
- COLUMN POSITION ANCHORING: Use the "columnOrder" value to locate each column by counting from the left edge of the table. Do NOT rely solely on the header text — count columns to prevent drift on dense tables.
- Track the listed columns by their physical position, not only by name.
- Re-read the rightmost targeted columns before finalizing.
- Do NOT borrow values from adjacent columns unless the target list explicitly includes them.

TASK: Extract and normalize data for the specified columns only.
${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

export const buildRepairExtractionTaskV2 = (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload,
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const focusList = repairRequest.focusSubtests.map((entry) => ({
    sid: entry.name,
    ab: entry.abbreviation || null,
    domain: entry.domain || null,
    columnOrder: entry.columnOrder ?? null,
    isInverted: entry.isInverted === true,
  }));
  const expectedCountsBlock = repairRequest.expectedGroupCounts.length > 0
    ? `EXPECTED ROW COUNTS PER AGE/GROUP (must be respected):
${repairRequest.expectedGroupCounts.map((entry) => `- "${entry.groupLabel}" => ${entry.expectedCount} rows per targeted subtest`).join('\n')}`
    : 'EXPECTED ROW COUNTS PER AGE/GROUP: not provided.';
  const existingSubtestsBlock = repairRequest.existingSubtests.length > 0
    ? `EXISTING SUBTESTS ALREADY PRESENT ON THIS PAGE (for name consistency only): ${JSON.stringify(repairRequest.existingSubtests)}`
    : '';
  const neighborColumnsRule = repairRequest.includeNeighborColumns
    ? 'If you detect clearly missing adjacent columns tied to the same domain block, include them as additional tables to recover omissions.'
    : 'Do NOT include any non-targeted column. Restrict output strictly to targeted subtests.';
  const dominantAgeRule =
    repairRequest.dominantAgeMin != null && repairRequest.dominantAgeMax != null
      ? `DOMINANT PAGE AGE CONSTRAINT: normalize this page to ${repairRequest.dominantAgeMin}-${repairRequest.dominantAgeMax} months. Do NOT drift to a neighboring age bucket.`
      : 'DOMINANT PAGE AGE CONSTRAINT: not provided.';

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
REPAIR MODE: targeted re-extraction after quality issues.
TARGET SUBTESTS (extract these first, exhaustively): ${JSON.stringify(focusList)}
${expectedCountsBlock}
${existingSubtestsBlock}
${neighborColumnsRule}
${dominantAgeRule}

MANDATORY REPAIR RULES:
- Extract ALL rows for each targeted subtest.
- Respect expected row counts when provided. If the page has one age group header, that count applies to that group.
- Keep one unique sid per physical source column variant and keep original abbreviation in "ab".
- Reuse known/canonical names when possible. Avoid creating duplicate aliases for the same target.
- Repair only the requested physical columns unless neighbor columns are explicitly allowed.
- On inverted tables, re-check the lowest NS and highest NS cells for every targeted column.
- Output valid JSON only.

${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};
