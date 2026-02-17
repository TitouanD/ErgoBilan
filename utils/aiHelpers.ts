import { Logger } from './logger';

// ── COMPACT KEY EXPANSION ──────────────────────────────────────────────────
// The edge function tells Gemini to use short keys to save output tokens.
// This map restores them to the full names expected by the client.

const COMPACT_ROW_KEYS: Record<string, string> = {
  l: 'label',
  m: 'mean',
  s: 'sd',
  r: 'raw_range',
  n: 'standard',
  p: 'percentile',
  z: 'z_score',
  a0: 'age_min_months',
  a1: 'age_max_months',
  r0: 'raw_min',
  r1: 'raw_max',
};

const COMPACT_TOP_KEYS: Record<string, string> = {
  tc: 'test_context',
  st: 'structure_type',
  sid: 'subtest_id',
};

/**
 * Expand compact JSON keys returned by the edge function back to the full
 * property names expected by the client-side types (AIExtractionResult, etc.).
 * Handles both compact and already-expanded keys gracefully.
 */
export const expandCompactKeys = (raw: unknown): unknown => {
  if (raw === null || raw === undefined || typeof raw !== 'object') return raw;

  if (Array.isArray(raw)) {
    return raw.map(expandCompactKeys);
  }

  const obj = raw as Record<string, unknown>;
  const expanded: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const mappedKey = COMPACT_TOP_KEYS[key] || COMPACT_ROW_KEYS[key] || key;

    if (key === 'tables' && Array.isArray(value)) {
      expanded[key] = value.map((table: unknown) => expandCompactKeys(table));
    } else if (key === 'rows' && Array.isArray(value)) {
      expanded[key] = value.map((row: unknown) => expandCompactKeys(row));
    } else if (typeof value === 'object' && value !== null) {
      expanded[mappedKey] = expandCompactKeys(value);
    } else {
      expanded[mappedKey] = value;
    }
  }

  return expanded;
};

/**
 * Convert a File (Blob) to a Base64 payload compatible with Gemini APIs.
 */
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Cleans and parses JSON returned by an LLM, including markdown code blocks.
 */
export const cleanAndParseJson = (text: string | undefined): unknown => {
    if (!text) return null;
    let clean = text.trim();

    const jsonBlockMatch = clean.match(/```json([\s\S]*?)```/);
    const genericBlockMatch = clean.match(/```([\s\S]*?)```/);

    if (jsonBlockMatch) {
        clean = jsonBlockMatch[1].trim();
    } else if (genericBlockMatch) {
        clean = genericBlockMatch[1].trim();
    }

    if (!clean.startsWith('{') && !clean.startsWith('[')) {
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        const firstBracket = clean.indexOf('[');
        const lastBracket = clean.lastIndexOf(']');

        const hasObj = firstBrace !== -1 && lastBrace !== -1;
        const hasArr = firstBracket !== -1 && lastBracket !== -1;

        if (hasObj && (!hasArr || firstBrace < firstBracket)) {
            clean = clean.substring(firstBrace, lastBrace + 1);
        } else if (hasArr) {
            clean = clean.substring(firstBracket, lastBracket + 1);
        }
    }

    try {
        // Strip ASCII control chars without using a regex pattern that trips no-control-regex.
        const sanitised = Array.from(clean)
            .filter((char) => {
                const code = char.charCodeAt(0);
                return !((code >= 0 && code <= 31) || (code >= 127 && code <= 159));
            })
            .join('');
        return JSON.parse(sanitised);
    } catch (e) {
        Logger.error('AI', 'JSON Parsing Error:', e);
        return null;
    }
};
