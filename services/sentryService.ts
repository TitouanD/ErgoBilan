/**
 * sentryService — frontend error monitoring (errors, traces, logs, replays on error).
 *
 * Health data policy: `sendDefaultPii` is off, the user is identified by its
 * Supabase id only, and every free-form field that may carry business data
 * (messages, extra, app contexts, breadcrumbs, logs, span descriptions) is
 * scrubbed before sending. SDK structural fields (stack frames, browser, os)
 * are left intact so stack traces stay usable. Replays mask all text and
 * inputs and block media. URLs lose their fragment (the family portal puts
 * its decryption key there) and the questionnaire id.
 */

import * as Sentry from '@sentry/react';
import type { Breadcrumb, BrowserOptions, ErrorEvent, Event, Log, SeverityLevel } from '@sentry/react';
import type { ComponentType } from 'react';

declare const __APP_RELEASE__: string;
declare const __APP_ENV__: string;

const env = import.meta.env;
const FRONTEND_DSN = env.VITE_SENTRY_DSN_FRONTEND || '';
const SENTRY_ENV = env.VITE_SENTRY_ENVIRONMENT || __APP_ENV__ || (env.DEV ? 'development' : 'production');
const SENTRY_RELEASE = env.VITE_SENTRY_RELEASE || __APP_RELEASE__ || undefined;
// `npm run dev` only reports when explicitly asked (VITE_SENTRY_ENABLE_IN_DEV=true in .env.local).
const IS_ENABLED = FRONTEND_DSN.length > 0 && (env.PROD || env.VITE_SENTRY_ENABLE_IN_DEV === 'true');

const parseRate = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};
const TRACES_SAMPLE_RATE = parseRate(env.VITE_SENTRY_TRACES_SAMPLE_RATE, 1.0);
const REPLAYS_SESSION_SAMPLE_RATE = parseRate(env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0);
const REPLAYS_ON_ERROR_SAMPLE_RATE = parseRate(env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE, 1.0);

// ─── Scrubbing ────────────────────────────────────────────────────────────────

const sensitiveKeyPattern = /(patient|email|phone|name|nom|prenom|address|siret|content|report|questionnaire|observation|notes?|diagnostic|payload|body|key|token|password|pin)/i;
const sensitiveValuePattern = /([A-Z][a-z]+\s[A-Z][a-z]+)|([\w.%+-]+@[\w.-]+\.[A-Za-z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)/g;
const MAX_DEPTH = 8;

const scrubString = (value: string): string => value.replace(sensitiveValuePattern, '[REDACTED]');

/** Business data only: never apply to SDK structures (frame `filename`, `os.name` would be lost). */
export const scrubData = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return '[Truncated]';
  if (typeof value === 'string') return scrubString(value);
  if (value instanceof Error) return { type: value.name, message: scrubString(value.message) };
  if (Array.isArray(value)) return value.map((entry) => scrubData(entry, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : scrubData(entry, depth + 1);
    }
    return output;
  }
  return value;
};

/** Drop the fragment (portal decryption key) and the questionnaire id from a URL. */
export const scrubUrl = (url: string): string => {
  const withoutHash = url.split('#')[0];
  return scrubString(withoutHash.replace(/([?&](?:q_id|key|token|access_token|refresh_token)=)[^&]*/gi, '$1[REDACTED]'));
};

const scrubMaybeUrl = (value: unknown): unknown => (typeof value === 'string' ? scrubUrl(value) : value);

/** Contexts set by the SDK: kept as is. Everything else comes from the app and is scrubbed. */
const SDK_CONTEXTS = new Set(['browser', 'os', 'device', 'trace', 'runtime', 'culture', 'react', 'replay', 'app', 'cloud_resource', 'profile', 'flags']);

const URL_FIELDS = new Set(['url', 'from', 'to']);

const scrubBreadcrumb = (crumb: Breadcrumb): Breadcrumb => ({
  ...crumb,
  message: crumb.message ? scrubString(crumb.message) : crumb.message,
  data: crumb.data
    ? Object.fromEntries(Object.entries(crumb.data).map(([key, value]) => [key, URL_FIELDS.has(key) ? scrubMaybeUrl(value) : scrubData(value)]))
    : crumb.data,
});

const scrubCommon = <T extends Event>(event: T): T => {
  if (event.message) event.message = scrubString(event.message);
  event.exception?.values?.forEach((entry) => {
    if (entry.value) entry.value = scrubString(entry.value);
  });
  if (event.extra) event.extra = scrubData(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    for (const [key, ctx] of Object.entries(event.contexts)) {
      if (!SDK_CONTEXTS.has(key)) event.contexts[key] = scrubData(ctx) as Record<string, unknown>;
    }
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (event.request?.query_string) delete event.request.query_string;
  if (event.request?.headers?.Referer) event.request.headers.Referer = scrubUrl(event.request.headers.Referer);
  return event;
};

type TransactionEvent = Parameters<NonNullable<BrowserOptions['beforeSendTransaction']>>[0];

const scrubTransaction = (event: TransactionEvent): TransactionEvent => {
  scrubCommon(event);
  event.spans?.forEach((span) => {
    if (span.description) span.description = scrubUrl(span.description);
    if (span.data) {
      for (const field of ['url', 'http.url', 'url.full', 'http.query', 'url.query']) {
        if (field in span.data) span.data[field] = scrubMaybeUrl(span.data[field]) as never;
      }
    }
  });
  return event;
};

const scrubLog = (log: Log): Log => ({
  ...log,
  message: typeof log.message === 'string' ? scrubString(log.message) : log.message,
  attributes: log.attributes ? (scrubData(log.attributes) as Log['attributes']) : log.attributes,
});

// ─── Init ─────────────────────────────────────────────────────────────────────

/** The family portal URL carries the decryption key: no replay recording there. */
const isPortalUrl = (): boolean => /[?&]q_id=/.test(window.location.search) || window.location.hash.includes('key=');

export const initSentry = (): void => {
  if (!IS_ENABLED) return;

  const integrations = [Sentry.browserTracingIntegration()];
  if (!isPortalUrl() && (REPLAYS_SESSION_SAMPLE_RATE > 0 || REPLAYS_ON_ERROR_SAMPLE_RATE > 0)) {
    integrations.push(Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }) as never);
  }

  Sentry.init({
    dsn: FRONTEND_DSN,
    environment: SENTRY_ENV,
    release: SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations,
    sampleRate: 1.0,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // Same origin only: the edge functions' CORS does not allow the sentry-trace / baggage headers.
    tracePropagationTargets: [/^\/(?!\/)/],
    replaysSessionSampleRate: REPLAYS_SESSION_SAMPLE_RATE,
    replaysOnErrorSampleRate: REPLAYS_ON_ERROR_SAMPLE_RATE,
    enableLogs: true,
    maxBreadcrumbs: 150,
    normalizeDepth: 8,
    beforeSend: (event: ErrorEvent) => scrubCommon(event),
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendLog: scrubLog,
  });

  // Replay events do not go through beforeSend: strip their URLs here.
  Sentry.addEventProcessor((event) => {
    const replay = event as Event & { urls?: string[] };
    if (event.type === 'replay_event' && Array.isArray(replay.urls)) replay.urls = replay.urls.map(scrubUrl);
    return event;
  });
  Sentry.setTag('app_surface', 'frontend');
};

// ─── Capture API ──────────────────────────────────────────────────────────────

type Context = Record<string, unknown>;

/**
 * Turn anything thrown or logged into an Error while keeping the details:
 * Supabase / Postgrest errors are plain objects ({ message, code, details, hint }).
 */
const normalizeError = (error: unknown): { error: Error; details?: Context } => {
  if (error instanceof Error) return { error };
  if (typeof error === 'string') return { error: new Error(error) };
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (obj.error instanceof Error) {
      const { error: inner, ...rest } = obj;
      return { error: inner as Error, details: rest };
    }
    const message = typeof obj.message === 'string' ? obj.message : typeof obj.error === 'string' ? obj.error : JSON.stringify(scrubData(obj)).slice(0, 300);
    const code = typeof obj.code === 'string' || typeof obj.code === 'number' ? `${obj.code}: ` : '';
    const normalized = new Error(`${code}${message}`);
    normalized.name = typeof obj.name === 'string' ? obj.name : 'NonErrorException';
    return { error: normalized, details: obj };
  }
  return { error: new Error(String(error)) };
};

export const captureAppException = (error: unknown, context?: Context, level: SeverityLevel = 'error'): string | undefined => {
  if (!IS_ENABLED) return undefined;
  const { error: normalized, details } = normalizeError(error);
  return Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (context?.scope) scope.setTag('log_scope', String(context.scope));
    if (context) scope.setContext('app_context', context);
    if (details) scope.setContext('error_details', details);
    return Sentry.captureException(normalized);
  });
};

export const captureAppMessage = (message: string, level: SeverityLevel = 'warning', context?: Context): void => {
  if (!IS_ENABLED) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext('app_context', context);
    Sentry.captureMessage(message, level);
  });
};

/** Breadcrumb + structured log: the trail shown before an error, searchable in Sentry Logs. */
export const recordAppLog = (level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string, data?: unknown): void => {
  if (!IS_ENABLED) return;
  const attributes = data === undefined ? undefined : (scrubData(data instanceof Error ? data : { data }) as Record<string, unknown>);
  Sentry.addBreadcrumb({ category: scope.toLowerCase(), message, level: level === 'warn' ? 'warning' : level, data: attributes });
  Sentry.logger[level](message, { scope, ...(attributes ? { details: JSON.stringify(attributes).slice(0, 2000) } : {}) });
};

export const setAppUser = (id: string | null): void => {
  if (!IS_ENABLED) return;
  Sentry.setUser(id ? { id } : null);
};

export const setAppTag = (key: string, value: string | number | boolean | null | undefined): void => {
  if (!IS_ENABLED) return;
  Sentry.setTag(key, value === null || value === undefined ? undefined : String(value));
};

export const setAppContext = (name: string, context: Context | null): void => {
  if (!IS_ENABLED) return;
  Sentry.setContext(name, context);
};

/** For `createRoot` (onUncaughtError / onCaughtError / onRecoverableError). */
export const reactRootErrorHandler = (source: string) =>
  Sentry.reactErrorHandler((error, errorInfo) => {
    if (env.DEV) console.error(`[REACT] ${source}`, error, errorInfo.componentStack);
  });

export const withSentryProfiler = <T extends ComponentType<any>>(component: T): T => {
  if (!IS_ENABLED) return component;
  return Sentry.withProfiler(component) as T;
};
