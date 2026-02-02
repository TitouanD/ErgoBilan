
/**
 * SYSTÈME DE LOGGING SIMPLIFIÉ (TEXTE BRUT)
 * Compatible avec les consoles Cloud Sandbox qui ne supportent pas le CSS (%c).
 */

// Détection d'environnement souple : 
// Active les logs si on est en localhost OU si l'URL contient ?debug=true
const isDev = true; //TODO A MODIFIER ABSOLUMENT

const SCOPES = {
    AUTH:   '🔐 [AUTH]',
    AI:     '✨ [GENAI]',
    DB:     '🗄️ [DATA]',
    CRYPTO: '🛡️ [SECURITY]',
    UI:     '🖥️ [UI]',
    SYSTEM: '⚙️ [SYSTEM]',
} as const;

type LogScope = keyof typeof SCOPES;

export const Logger = {
    info: (scope: LogScope, message: string, data?: any) => {
        if (!isDev) return;
        const prefix = SCOPES[scope] || SCOPES.SYSTEM;
        if (data !== undefined) console.info(`${prefix} ${message}`, data);
        else console.info(`${prefix} ${message}`);
    },

    debug: (scope: LogScope, message: string, data?: any) => {
        if (!isDev) return;
        const prefix = SCOPES[scope] || SCOPES.SYSTEM;
        if (data !== undefined) console.debug(`${prefix} ${message}`, data);
        else console.debug(`${prefix} ${message}`);
    },

    warn: (scope: LogScope, message: string, data?: any) => {
        if (!isDev) return;
        const prefix = SCOPES[scope] || SCOPES.SYSTEM;
        if (data !== undefined) console.warn(`${prefix} ${message}`, data);
        else console.warn(`${prefix} ${message}`);
    },

    error: (scope: LogScope, message: string, error?: any) => {
        const prefix = SCOPES[scope] || SCOPES.SYSTEM;
        // Les erreurs sont toujours affichées, même en prod
        if (error !== undefined) console.error(`${prefix} ${message}`, error);
        else console.error(`${prefix} ${message}`);
    }
};
