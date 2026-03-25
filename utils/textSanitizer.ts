const COMBINING_MARKS_BEFORE_LETTER_REGEX = /([\u0300-\u036f]+)([A-Za-zÀ-ÖØ-öø-ÿ])/g;
const REPLACEMENT_CHAR_REGEX = /\uFFFD/g;
const WHITE_SQUARE_REGEX = /\u25A1/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

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
