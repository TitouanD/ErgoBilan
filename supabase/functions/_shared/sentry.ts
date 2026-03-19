type CaptureEdgeOptions = {
  functionName: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

const sensitiveKeyPattern = /(patient|email|phone|name|nom|prenom|address|siret|content|report|questionnaire|observation|notes?|diagnostic|payload|body|response)/i;
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

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(scrubDeep(error)));
};

export const captureEdgeException = async (error: unknown, options: CaptureEdgeOptions): Promise<void> => {
  const dsn = Deno.env.get('SENTRY_DSN_BACKEND') || '';
  const environment = Deno.env.get('SENTRY_ENV') || 'production';
  const release = Deno.env.get('SENTRY_RELEASE') || undefined;
  if (!dsn) return;

  const dsnParts = parseDsn(dsn);
  if (!dsnParts) return;

  const normalized = normalizeError(error);
  const event = {
    event_id: crypto.randomUUID().replaceAll('-', ''),
    timestamp: new Date().toISOString(),
    level: 'error',
    platform: 'javascript',
    environment,
    release,
    tags: {
      app_surface: 'backend',
      function_name: options.functionName,
      ...(options.tags || {}),
    },
    exception: {
      values: [
        {
          type: normalized.name || 'Error',
          value: normalized.message,
          stacktrace: normalized.stack ? { frames: [] } : undefined,
        },
      ],
    },
    extra: scrubDeep(options.extra || {}),
  };

  const endpoint = `https://${dsnParts.host}/api/${dsnParts.projectId}/store/?sentry_version=7&sentry_key=${dsnParts.publicKey}&sentry_client=autobilan-edge/1.0`;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // no-op
  }
};
