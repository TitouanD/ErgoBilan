
import { Logger } from './logger';

/**
 * Convertit un File (Blob) en chaîne Base64 compatible avec l'API Gemini (sans préfixe data:...)
 */
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // On retire l'en-tête "data:image/jpeg;base64," pour ne garder que les données
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
 * Nettoie et parse le JSON retourné par un LLM, même s'il contient des blocs Markdown ```json ... ```
 */
export const cleanAndParseJson = (text: string | undefined): unknown => {
    if (!text) return null;
    let clean = text.trim();
    
    // 1. Extraction du bloc de code si présent
    const jsonBlockMatch = clean.match(/```json([\s\S]*?)```/);
    const genericBlockMatch = clean.match(/```([\s\S]*?)```/);
    
    if (jsonBlockMatch) {
        clean = jsonBlockMatch[1].trim();
    } else if (genericBlockMatch) {
        clean = genericBlockMatch[1].trim();
    }
    
    // 2. Si toujours pas d'objet JSON pur, on cherche les accolades/crochets extrêmes
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
        // Nettoyage final des caractères invisibles ou retours chariots problématiques
        const sanitised = clean.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
        return JSON.parse(sanitised);
    } catch (e) {
        Logger.error('AI', "JSON Parsing Error:", e);
        return null;
    }
};
