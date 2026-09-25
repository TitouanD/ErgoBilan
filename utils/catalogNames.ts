/**
 * catalogNames.ts — aggressive normalization of test / subtest names, used by
 * the catalogue search to match "M.A.B.C.-2", "mabc 2" and "MABC2" alike.
 */

/**
 * trim → lowercase → strip accents → strip everything non-alphanumeric.
 * Ex: "M.A.B.C.-2", "mabc 2", "MABC2", "  MABC - 2 " → "mabc2"
 */
export const normalizeTestName = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[^a-z0-9]/g, ''); // strip everything non-alphanumeric
};

const SUBTEST_STOPWORDS = new Set(['avec', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'au', 'aux', 'a', 'mabc', 'mabc2']);

const SUBTEST_TOKEN_MAP: Record<string, string> = {
  une: '1',
  un: '1',
  one: '1',
  deux: '2',
  two: '2',
  trois: '3',
  three: '3',
  meilleure: 'meilleur',
  meilleur: 'meilleur',
  prefered: 'prefere',
  preferred: 'prefere',
  preferee: 'prefere',
  prefere: 'prefere',
};

/** Tokenizer behind normalizeSubtestName (accents, stop words, number words, plurals). */
export const normalizeSubtestTokens = (name: string): string[] => {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const base = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^m[^a-z0-9]*abc[^a-z0-9]*2[^a-z0-9]*/i, '')
    .replace(/\(([^)]*(age|ans|mois)[^)]*)\)/gi, ' ')
    .replace(/\bage\s*\d.*$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!base) return [];

  const tokens = base
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => SUBTEST_TOKEN_MAP[token] || token)
    .map((token) => (token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token))
    .filter((token) => token && !SUBTEST_STOPWORDS.has(token));

  const hasNumber = tokens.some((token) => /^\d+$/.test(token));
  const hasHand = tokens.includes('main');
  const impliesPreferred = tokens.includes('meilleur') || tokens.includes('prefere');
  if (hasHand && impliesPreferred && !hasNumber) {
    tokens.push('1');
  }

  return tokens;
};

export const normalizeSubtestName = (name: string): string => {
  return normalizeSubtestTokens(name).join('');
};
