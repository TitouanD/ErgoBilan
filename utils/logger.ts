/**
 * Frontend logging policy:
 * - console output only in local dev (`npm run dev`)
 * - every level is also recorded in Sentry (breadcrumb + structured log) when it is enabled,
 *   so an error arrives with the trail of what happened before it
 * - `error` additionally creates a Sentry issue
 */

import { captureAppException, recordAppLog } from '../services/sentryService';

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
  recordAppLog(level, scope, message, data);
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

  error: (scope: LogScope, message: string, error?: unknown, context?: Record<string, unknown>) => {
    print('error', scope, message, error);
    captureAppException(error ?? new Error(message), {
      scope,
      message,
      source: 'Logger.error',
      ...context,
    });
  },

  /** A handled failure worth an issue, without being an error (e.g. an AI call that failed then was reported to the user). */
  capture: (scope: LogScope, message: string, error?: unknown, context?: Record<string, unknown>) => {
    print('warn', scope, message, error);
    captureAppException(error ?? new Error(message), { scope, message, source: 'Logger.capture', ...context }, 'warning');
  },
};
