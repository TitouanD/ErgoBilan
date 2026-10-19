/**
 * geminiTarget — where `generate` sends its Gemini requests.
 *
 * - `agent-platform-eu` (secret GCP_SA_KEY, the JSON key of a Google Cloud service account):
 *   Gemini Enterprise Agent Platform (formerly Vertex AI), EU multi-region endpoint, so the
 *   processing stays in the EU under the Google Cloud terms. OAuth token minted from the key.
 * - `gemini-api` (secret GEMINI_API_KEY, AI Studio): public Gemini API, no EU guarantee.
 *   Fallback only, kept to roll back by removing GCP_SA_KEY.
 *
 * Both take the same request body (contents, system_instruction, generationConfig).
 * Uses only Web APIs (fetch, crypto.subtle, btoa), so it runs in Deno and under Vitest.
 */

export const AGENT_PLATFORM_MODEL = 'gemini-3.8-flash';
/**
 * Quality first. On the fictive e2e bilan (2026-10-12), per initial report: high 4.8 US cents,
 * medium 3.9, low 2.1; low misplaces details, the Flash-Lite models make clinical errors.
 * A call with reasoning can take 20 to 50 s: GEMINI_TIMEOUT_MS must leave room for it.
 */
export const AGENT_PLATFORM_THINKING_LEVEL = 'high';
/**
 * Long writing tasks in medium: on a real initial assessment (2026-10-12) the diagnostic ran
 * past 100 s in high and timed out. The bio and the style extraction stay in high.
 */
export const LONG_TASK_THINKING_LEVEL = 'medium';
const LONG_TASKS: ReadonlySet<string> = new Set(['report_diagnostic', 'report_reevaluation']);

/** generationConfig of a task: the target's, with the reasoning level of the task on Agent Platform. */
export const generationConfigFor = (target: Pick<GeminiTarget, 'provider' | 'generationConfig'>, task: string) =>
  target.provider === 'agent-platform-eu' && LONG_TASKS.has(task)
    ? { ...target.generationConfig, thinkingConfig: { thinkingLevel: LONG_TASK_THINKING_LEVEL } }
    : target.generationConfig;

/**
 * Supabase answers 504 when an edge function has not responded within 150 s (request idle
 * timeout, every plan). All the Gemini attempts of a request, retries included, share this
 * budget, counted from the request arrival; the margin covers auth, credit and finalization.
 */
export const GEMINI_BUDGET_MS = 135_000;
/**
 * No attempt is started with less time left than this: a long task (diagnostic) would not
 * finish in less, and a cut attempt is billed all the same (#109).
 */
export const MIN_ATTEMPT_MS = 60_000;

/** Timeout of the next attempt: the per-attempt cap within the remaining budget; 0 = no time left for one. */
export const attemptTimeoutMs = (requestStartedAt: number, now: number, perAttemptMs: number, budgetMs = GEMINI_BUDGET_MS): number => {
  const remaining = budgetMs - (now - requestStartedAt);
  return remaining < MIN_ATTEMPT_MS ? 0 : Math.min(perAttemptMs, remaining);
};
export const AGENT_PLATFORM_LOCATION = 'eu';
export const GEMINI_API_MODEL = 'gemini-3-flash-preview';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
/** Renew the token this long before Google's expiry. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
/** A stuck token exchange (cold start) must not eat the request budget (#109). */
export const TOKEN_TIMEOUT_MS = 10_000;

export type GeminiProvider = 'agent-platform-eu' | 'gemini-api';

export interface GeminiTarget {
  provider: GeminiProvider;
  model: string;
  url: string;
  /** Merged into the generationConfig of every request. */
  generationConfig: Record<string, unknown>;
  /** Auth headers of a request; rejects when the OAuth token cannot be obtained. */
  authHeaders: () => Promise<Record<string, string>>;
  /** Called when Gemini answers 401: the next authHeaders() gets fresh credentials. */
  onUnauthorized?: () => void;
}

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export const parseServiceAccountKey = (raw: string): ServiceAccountKey => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GCP_SA_KEY is not valid JSON');
  }
  const { type, client_email, private_key, project_id } = parsed ?? {};
  if (type !== 'service_account' || typeof client_email !== 'string' || typeof private_key !== 'string' || typeof project_id !== 'string')
    throw new Error('GCP_SA_KEY is not a service account key');
  return { client_email, private_key, project_id };
};

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

const importPrivateKey = (pem: string): Promise<CryptoKey> => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
};

/** Signed JWT assertion of the OAuth "JWT bearer" grant. */
export const signAssertion = async (key: ServiceAccountKey, nowMs: number): Promise<string> => {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
    iss: key.client_email,
    scope: TOKEN_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importPrivateKey(key.private_key),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
};

/**
 * OAuth access tokens of a service account, cached for the life of the edge instance and
 * renewed before expiry. Concurrent callers share the same pending request.
 */
export const createAccessTokenSource = (key: ServiceAccountKey, fetchImpl: typeof fetch = fetch, now: () => number = Date.now) => {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const mint = async (): Promise<string> => {
    const issuedAt = now();
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await signAssertion(key, issuedAt),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
    if (!response.ok || !data?.access_token) throw new Error(`OAuth token refused (${response.status} ${data?.error ?? ''})`.trim());
    cached = { token: data.access_token, expiresAt: issuedAt + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  };

  const get = (): Promise<string> => {
    if (cached && now() < cached.expiresAt - TOKEN_MARGIN_MS) return Promise.resolve(cached.token);
    pending ??= mint().finally(() => {
      pending = null;
    });
    return pending;
  };
  /** Drops the cached token (refused by Vertex: revoked or rotated key). */
  const invalidate = () => {
    cached = null;
  };
  return Object.assign(get, { invalidate });
};

export type GeminiAnswer = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string };
};

/**
 * Text of a Gemini answer: the text parts joined, reasoning parts (thought) skipped. An answer
 * cut by the token limit or blocked is a named failure, not an empty or invalid JSON (#109).
 */
export const readGeminiAnswer = (data: GeminiAnswer | null): { text: string; failure?: 'GEMINI_MAX_TOKENS' | 'GEMINI_BLOCKED' } => {
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  const finishReason = candidate?.finishReason;
  if (finishReason === 'MAX_TOKENS') return { text, failure: 'GEMINI_MAX_TOKENS' };
  if (data?.promptFeedback?.blockReason || (finishReason && finishReason !== 'STOP')) return { text, failure: 'GEMINI_BLOCKED' };
  return { text };
};

export const agentPlatformUrl = (projectId: string, model = AGENT_PLATFORM_MODEL, location = AGENT_PLATFORM_LOCATION) =>
  `https://aiplatform.${location}.rep.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

/**
 * Target from the edge secrets: Agent Platform EU when GCP_SA_KEY is set (an invalid key is an
 * error, never a silent fallback to the public API), else the Gemini API, else nothing.
 */
export const resolveGeminiTarget = (
  env: { GCP_SA_KEY?: string; GEMINI_API_KEY?: string },
  fetchImpl: typeof fetch = fetch,
): { target: GeminiTarget } | { error: string } => {
  if (env.GCP_SA_KEY?.trim()) {
    let key: ServiceAccountKey;
    try {
      key = parseServiceAccountKey(env.GCP_SA_KEY);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const token = createAccessTokenSource(key, fetchImpl);
    return {
      target: {
        provider: 'agent-platform-eu',
        model: AGENT_PLATFORM_MODEL,
        generationConfig: { thinkingConfig: { thinkingLevel: AGENT_PLATFORM_THINKING_LEVEL } },
        url: agentPlatformUrl(key.project_id),
        authHeaders: async () => ({ Authorization: `Bearer ${await token()}` }),
        onUnauthorized: token.invalidate,
      },
    };
  }
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (apiKey) {
    return {
      target: {
        provider: 'gemini-api',
        model: GEMINI_API_MODEL,
        generationConfig: {},
        url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_API_MODEL}:generateContent`,
        authHeaders: async () => ({ 'x-goog-api-key': apiKey }),
      },
    };
  }
  return { error: 'missing GCP_SA_KEY and GEMINI_API_KEY' };
};
