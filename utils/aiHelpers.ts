import { Logger } from './logger';

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
