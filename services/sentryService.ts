import * as Sentry from '@sentry/react';
import type { ComponentType } from 'react';

declare const __APP_RELEASE__: string;

const FRONTEND_DSN = import.meta.env.VITE_SENTRY_DSN_FRONTEND || '';
const SENTRY_ENV = import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production';
const SENTRY_RELEASE = import.meta.env.VITE_SENTRY_RELEASE || __APP_RELEASE__ || undefined;
const IS_ENABLED = import.meta.env.PROD && FRONTEND_DSN.length > 0;

const sensitiveKeyPattern = /(patient|email|phone|name|nom|prenom|address|siret|content|report|questionnaire|observation|notes?|diagnostic)/i;
const sensitiveValuePattern = /([A-Z][a-z]+\s[A-Z][a-z]+)|([\w.%+-]+@[\w.-]+\.[A-Za-z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)/g;

const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 5) return '[Truncated]';
  if (typeof value === 'string') return value.replace(sensitiveValuePattern, '[REDACTED]');
  if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry, depth + 1));
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input)) {
      if (sensitiveKeyPattern.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key] = scrubDeep(entry, depth + 1);
    }
    return output;
  }
  return value;
};

const scrubEvent = <T>(event: T): T => scrubDeep(event) as T;

export const initSentry = (): void => {
  if (!IS_ENABLED) return;

  Sentry.init({
    dsn: FRONTEND_DSN,
    environment: SENTRY_ENV,
    release: SENTRY_RELEASE,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    sampleRate: 1.0,
  });
};

export const sentryEnabled = (): boolean => IS_ENABLED;

export const captureAppException = (error: unknown, context?: Record<string, unknown>): void => {
  if (!IS_ENABLED) return;
  Sentry.withScope((scope) => {
    scope.setTag('app_surface', 'frontend');
    if (context) scope.setContext('app_context', scrubDeep(context) as Record<string, unknown>);
    Sentry.captureException(error);
  });
};

export const withSentryProfiler = <T extends ComponentType<any>>(component: T): T => {
  if (!IS_ENABLED) return component;
  return Sentry.withProfiler(component) as T;
};
