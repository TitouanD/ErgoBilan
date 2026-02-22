/**
 * Frontend logging policy:
 * - enabled only in local dev (`npm run dev`)
 * - disabled by default for production and preview builds
 */

const logsEnabled = import.meta.env.DEV;

const SCOPES = {
  AUTH: '[AUTH]',
  AI: '[GENAI]',
  DB: '[DATA]',
  CRYPTO: '[SECURITY]',
  UI: '[UI]',
  SYSTEM: '[SYSTEM]',
  ADMIN: '[ADMIN]',
} as const;

type LogScope = keyof typeof SCOPES;

const print = (level: 'info' | 'debug' | 'warn' | 'error', scope: LogScope, message: string, data?: unknown) => {
  if (!logsEnabled) return;
  const prefix = SCOPES[scope] || SCOPES.SYSTEM;
  if (data !== undefined) console[level](`${prefix} ${message}`, data);
  else console[level](`${prefix} ${message}`);
};

export const Logger = {
  info: (scope: LogScope, message: string, data?: unknown) => {
    print('info', scope, message, data);
  },

  debug: (scope: LogScope, message: string, data?: unknown) => {
    print('debug', scope, message, data);
  },

  warn: (scope: LogScope, message: string, data?: unknown) => {
    print('warn', scope, message, data);
  },

  error: (scope: LogScope, message: string, error?: unknown) => {
    print('error', scope, message, error);
  },
};
