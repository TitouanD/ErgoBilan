/**
 * Lightweight fuzzy-matcher for mapping extracted subtest names / column headers
 * to canonical official-subtest names.
 *
 * Scoring strategy (descending priority):
 *  1. Exact normalised match              → 1.0
 *  2. One string is prefix of the other   → 0.9
 *  3. ≥ 50% word-start overlap            → 0.5–0.7
 *  4. Simple substring inclusion          → 0.6
 *  5. Abbreviation match (initials)       → 0.55
 *  6. Levenshtein similarity              → 0–0.5
 */

export interface MatchCandidate {
  id: string;
  name: string;
  /** Similarity score: 0 (no match) – 1 (exact). */
  score: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = ai === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Normalise a string for comparison: lowercase, strip accents, replace
 * non-alphanumeric characters with spaces, collapse whitespace.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a simple abbreviation from word initials (e.g. "Mémoire de Travail" → "mdt"). */
function buildAbbreviation(normalised: string): string {
  return normalised
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('');
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Score a single candidate against a query string.
 * Returns a value in [0, 1]; values ≤ 0.25 are considered non-matches.
 */
export function scoreCandidate(query: string, candidateName: string): number {
  const nq = normalizeForMatch(query);
  const nc = normalizeForMatch(candidateName);

  if (!nq || !nc) return 0;

  if (nc === nq) return 1.0;
  if (nc.startsWith(nq) || nq.startsWith(nc)) return 0.9;

  if (nc.includes(nq) || nq.includes(nc)) return 0.6;

  // Word-start overlap
  const qWords = nq.split(/\s+/).filter(Boolean);
  const cWords = nc.split(/\s+/).filter(Boolean);
  const matchedWords = qWords.filter((w) =>
    cWords.some((cw) => cw.startsWith(w) || w.startsWith(cw)),
  );
  const overlap =
    matchedWords.length / Math.max(qWords.length, cWords.length, 1);
  if (overlap >= 0.5) return 0.5 + overlap * 0.2;

  // Abbreviation match (query abbreviation ↔ candidate abbreviation or vice-versa)
  const qAbbr = buildAbbreviation(nq);
  const cAbbr = buildAbbreviation(nc);
  if (qAbbr.length >= 2 && (cAbbr === qAbbr || nc === qAbbr || nq === cAbbr)) return 0.55;

  // Levenshtein fallback
  const maxLen = Math.max(nc.length, nq.length, 1);
  const dist = levenshtein(nc, nq);
  return Math.max(0, (1 - dist / maxLen) * 0.5);
}

/**
 * Find the best-matching candidates for a query among a list of named items.
 *
 * @param query         The extracted subtest name or column abbreviation to match.
 * @param candidates    Pool of official subtests `{ id, name }`.
 * @param maxResults    Maximum number of results to return (default 6).
 * @param minScore      Minimum score threshold (default 0.25).
 */
export function findBestMatches(
  query: string,
  candidates: ReadonlyArray<{ id: string; name: string }>,
  maxResults = 6,
  minScore = 0.25,
): MatchCandidate[] {
  return candidates
    .map((c) => ({ id: c.id, name: c.name, score: scoreCandidate(query, c.name) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Classify a score into a human-readable confidence level.
 */
export function confidenceLabel(score: number): 'high' | 'medium' | 'low' | 'none' {
  if (score >= 0.85) return 'high';
  if (score >= 0.55) return 'medium';
  if (score >= 0.25) return 'low';
  return 'none';
}
