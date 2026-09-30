const COMBINING_MARKS_BEFORE_LETTER_REGEX = /([\u0300-\u036f]+)([A-Za-zÀ-ÖØ-öø-ÿ])/g;
const REPLACEMENT_CHAR_REGEX = /\uFFFD/g;
const WHITE_SQUARE_REGEX = /\u25A1/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Named entities seen in French AI answers (accented letters, quotes, punctuation). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  deg: '°',
  euro: '€',
  oelig: 'œ',
  OElig: 'Œ',
  aelig: 'æ',
  AElig: 'Æ',
  ccedil: 'ç',
  Ccedil: 'Ç',
};
for (const [letters, accent] of [
  ['aeiou', 'grave'],
  ['aeiouy', 'acute'],
  ['aeiou', 'circ'],
  ['aeiouy', 'uml'],
] as const) {
  for (const letter of letters) {
    const lower = `${letter}${{ grave: '̀', acute: '́', circ: '̂', uml: '̈' }[accent]}`.normalize('NFC');
    NAMED_ENTITIES[`${letter}${accent}`] = lower;
    NAMED_ENTITIES[`${letter.toUpperCase()}${accent}`] = lower.toUpperCase();
  }
}

/**
 * Decodes the HTML entities of a plain-text AI answer (`&eacute;`, `&#39;`, `&#x27;`),
 * in one pass: `&amp;eacute;` gives `&eacute;`. Unknown entities are kept.
 * Plain sections are escaped again when rendered (`markdownToHtml`), so an
 * entity left here would show as is in the preview and the PDF (#74).
 */
export const decodeHtmlEntities = (text: string): string =>
  text.replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (entity, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code] ?? entity;
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });

/**
 * Decodes residual double-encoded HTML entities that can occur when
 * content was previously round-tripped through plain↔HTML format conversion.
 * e.g. `&amp;amp;#39;` → `'`, `&amp;amp;` → `&`
 */
export const decodeResidualEntities = (html: string): string => {
  if (!html) return '';
  // Iteratively decode &amp; sequences (handles multiple levels of encoding)
  let result = html;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(/&amp;/g, '&');
  }
  // Now decode common numeric/named entities that were double-encoded
  return result
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

/**
 * Repairs common Unicode glitches seen in generated report text:
 * - misordered combining accents ("◌́e" -> "é")
 * - replacement placeholders ("�", "□")
 * - stray control characters
 */
export const sanitizeReportText = (input: string | null | undefined): string => {
  if (!input) return '';

  return input
    .replace(COMBINING_MARKS_BEFORE_LETTER_REGEX, '$2$1')
    .normalize('NFC')
    .replace(REPLACEMENT_CHAR_REGEX, '')
    .replace(WHITE_SQUARE_REGEX, '')
    .replace(CONTROL_CHARS_REGEX, '');
};
