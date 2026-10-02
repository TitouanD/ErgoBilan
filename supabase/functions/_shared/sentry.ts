/**
 * Minimal Sentry client for the edge functions (store endpoint, no SDK).
 *
 * Sends exceptions (with a parsed stack trace) and messages (handled failures,
 * e.g. a Gemini error) with the pseudonymous user id, the request method/path
 * and the trail of steps of the request (breadcrumbs). Free-form data (extra,
 * breadcrumb data, messages) is scrubbed; the request body is never sent.
 *
 * Secrets: SENTRY_DSN_BACKEND (required, otherwise nothing is sent),
 * SENTRY_ENV (default "production"), SENTRY_RELEASE (default: deployment id).
 */

type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
type TagValue = string | number | boolean | null | undefined;

export type EdgeBreadcrumb = {
  timestamp: number;
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
};

type CaptureEdgeOptions = {
  functionName: string;
  tags?: Record<string, TagValue>;
  extra?: Record<string, unknown>;
  userId?: string | null;
  request?: Request;
  breadcrumbs?: EdgeBreadcrumb[];
  fingerprint?: string[];
  level?: Level;
};

const sensitiveKeyPattern =
  /(patient|email|phone|name|nom|prenom|address|siret|content|report|questionnaire|observation|notes?|diagnostic|payload|body|response|key|token|password|pin|salt|validator)/i;
const sensitiveValuePattern = /([A-Z][a-z]+\s[A-Z][a-z]+)|([\w.%+-]+@[\w.-]+\.[A-Za-z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)/g;

const parseDsn = (dsn: string): { host: string; projectId: string; publicKey: string } | null => {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\//, '');
    const publicKey = parsed.username;
    if (!projectId || !publicKey) return null;
    return { host: parsed.host, projectId, publicKey };
  } catch {
    return null;
  }
};

const scrubString = (value: string): string => value.replace(sensitiveValuePattern, '[REDACTED]');

export const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '[Truncated]';
  if (typeof value === 'string') return scrubString(value);
  if (value instanceof Error) return { type: value.name, message: scrubString(value.message) };
  if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : scrubDeep(entry, depth + 1);
    }
    return output;
  }
  return value;
};

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const obj = error as { message: string; code?: unknown };
    return new Error(`${obj.code ? `${obj.code}: ` : ''}${obj.message}`);
  }
  return new Error(typeof error === 'string' ? error : JSON.stringify(scrubDeep(error)));
};

/** V8 stack ("at fn (file:line:col)") → Sentry frames, oldest call first. */
const parseStack = (stack: string | undefined) => {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(([, fn, file, line, col]) => ({
      function: fn || '<anonymous>',
      filename: file.replace(/^file:\/\/\/tmp\/[^/]+\/source\//, ''),
      lineno: Number(line),
      colno: Number(col),
      in_app: !/(jsr:|npm:|deno:|ext:|node:|https?:)/.test(file),
    }))
    .reverse();
  return frames.length > 0 ? { frames } : undefined;
};

const describeRequest = (req?: Request) => {
  if (!req) return undefined;
  const url = new URL(req.url);
  return {
    method: req.method,
    url: `${url.origin}${url.pathname}`,
    headers: {
      Origin: req.headers.get('origin') || '',
      'User-Agent': req.headers.get('user-agent') || '',
      'Content-Length': req.headers.get('content-length') || '',
    },
  };
};

const send = async (event: Record<string, unknown>, options: CaptureEdgeOptions): Promise<void> => {
  const dsn = Deno.env.get('SENTRY_DSN_BACKEND') || '';
  if (!dsn) return;
  const dsnParts = parseDsn(dsn);
  if (!dsnParts) return;

  const deploymentId = Deno.env.get('DENO_DEPLOYMENT_ID') || '';
  const payload = {
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    logger: options.functionName,
    server_name: Deno.env.get('SB_REGION') || undefined,
    environment: Deno.env.get('SENTRY_ENV') || 'production',
    release: Deno.env.get('SENTRY_RELEASE') || (deploymentId ? `${options.functionName}@${deploymentId}` : undefined),
    level: options.level || 'error',
    tags: {
      app_surface: 'backend',
      function_name: options.functionName,
      ...Object.fromEntries(
        Object.entries(options.tags || {})
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    },
    user: options.userId ? { id: options.userId } : undefined,
    request: describeRequest(options.request),
    contexts: { runtime: { name: 'deno', version: Deno.version?.deno } },
    extra: scrubDeep(options.extra || {}),
    breadcrumbs: options.breadcrumbs?.length
      ? {
          values: options.breadcrumbs.map((b) => ({ ...b, message: scrubString(b.message), data: b.data ? scrubDeep(b.data) : undefined })),
        }
      : undefined,
    fingerprint: options.fingerprint,
    ...event,
  };

  const endpoint = `https://${dsnParts.host}/api/${dsnParts.projectId}/store/?sentry_version=7&sentry_key=${dsnParts.publicKey}&sentry_client=ergobilan-edge/2.0`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.error('Sentry ingestion refused', res.status, await res.text());
  } catch (err) {
    console.error('Sentry ingestion failed', err instanceof Error ? err.message : err);
  }
};

export const captureEdgeException = async (error: unknown, options: CaptureEdgeOptions): Promise<void> => {
  const normalized = normalizeError(error);
  await send(
    {
      exception: {
        values: [
          {
            type: normalized.name || 'Error',
            value: scrubString(normalized.message),
            stacktrace: parseStack(normalized.stack),
            mechanism: { type: 'edge_function', handled: true },
          },
        ],
      },
    },
    options,
  );
};

/** A handled failure (no exception): e.g. Gemini error, RPC error. Defaults to level "warning". */
export const captureEdgeMessage = async (message: string, options: CaptureEdgeOptions): Promise<void> => {
  await send({ message: { formatted: scrubString(message) } }, { level: 'warning', ...options });
};

/** Per-request trail of steps, sent as breadcrumbs with any capture of the request. */
export const createTrail = () => {
  const items: EdgeBreadcrumb[] = [];
  return {
    items,
    add: (category: string, message: string, data?: Record<string, unknown>, level: Level = 'info') => {
      items.push({ timestamp: Date.now() / 1000, category, message, level, data });
    },
  };
};
