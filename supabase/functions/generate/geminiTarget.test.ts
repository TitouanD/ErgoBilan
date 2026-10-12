import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLATFORM_MODEL,
  GEMINI_BUDGET_MS,
  agentPlatformUrl,
  attemptTimeoutMs,
  createAccessTokenSource,
  generationConfigFor,
  parseServiceAccountKey,
  resolveGeminiTarget,
  signAssertion,
} from './geminiTarget.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = {
  type: 'service_account',
  project_id: 'ergobilan-test',
  client_email: 'ergobilan-generate@ergobilan-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const RAW_KEY = JSON.stringify(KEY);

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const tokenFetch = (expiresIn = 3600) =>
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    const assertion = new URLSearchParams(String(init?.body)).get('assertion');
    return new Response(JSON.stringify({ access_token: `token-${assertion?.slice(-6)}`, expires_in: expiresIn }), { status: 200 });
  });

describe('parseServiceAccountKey', () => {
  it('accepts a service account key', () => {
    expect(parseServiceAccountKey(RAW_KEY).project_id).toBe('ergobilan-test');
  });

  it('refuses invalid JSON and other credentials', () => {
    expect(() => parseServiceAccountKey('{')).toThrow('not valid JSON');
    expect(() => parseServiceAccountKey(JSON.stringify({ ...KEY, type: 'authorized_user' }))).toThrow('not a service account key');
  });
});

describe('signAssertion', () => {
  it('signs an RS256 JWT for the cloud-platform scope, verifiable with the public key', async () => {
    const jwt = await signAssertion(parseServiceAccountKey(RAW_KEY), 1_700_000_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual({
      iss: KEY.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const valid = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
  });
});

describe('createAccessTokenSource', () => {
  it('reuses the token until shortly before expiry, then renews it', async () => {
    let now = 1_700_000_000_000;
    const fetchImpl = tokenFetch(3600);
    const token = createAccessTokenSource(parseServiceAccountKey(RAW_KEY), fetchImpl as unknown as typeof fetch, () => now);

    const first = await token();
    now += 50 * 60 * 1000;
    expect(await token()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 6 * 60 * 1000; // 4 min before expiry: renewed
    await token();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchImpl = tokenFetch();
    const token = createAccessTokenSource(parseServiceAccountKey(RAW_KEY), fetchImpl as unknown as typeof fetch);
    const [a, b] = await Promise.all([token(), token()]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects when Google refuses the key, and retries on the next call', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
      .mockImplementation(tokenFetch());
    const token = createAccessTokenSource(parseServiceAccountKey(RAW_KEY), fetchImpl as unknown as typeof fetch);
    await expect(token()).rejects.toThrow('OAuth token refused (400 invalid_grant)');
    await expect(token()).resolves.toMatch(/^token-/);
  });
});

describe('resolveGeminiTarget', () => {
  it('uses Agent Platform in the EU multi-region when GCP_SA_KEY is set, even with GEMINI_API_KEY', async () => {
    const result = resolveGeminiTarget({ GCP_SA_KEY: RAW_KEY, GEMINI_API_KEY: 'ai-studio' }, tokenFetch() as unknown as typeof fetch);
    if (!('target' in result)) throw new Error(result.error);
    expect(result.target.provider).toBe('agent-platform-eu');
    expect(result.target.model).toBe(AGENT_PLATFORM_MODEL);
    expect(result.target.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'high' } });
    expect(result.target.url).toBe(
      `https://aiplatform.eu.rep.googleapis.com/v1/projects/ergobilan-test/locations/eu/publishers/google/models/${AGENT_PLATFORM_MODEL}:generateContent`,
    );
    expect(await result.target.authHeaders()).toEqual({ Authorization: expect.stringMatching(/^Bearer token-/) });
  });

  it('never falls back to the public API when GCP_SA_KEY is set but invalid', () => {
    expect(resolveGeminiTarget({ GCP_SA_KEY: 'not json', GEMINI_API_KEY: 'ai-studio' })).toEqual({ error: 'GCP_SA_KEY is not valid JSON' });
  });

  it('falls back to the Gemini API without GCP_SA_KEY', async () => {
    const result = resolveGeminiTarget({ GEMINI_API_KEY: 'ai-studio' });
    if (!('target' in result)) throw new Error(result.error);
    expect(result.target.provider).toBe('gemini-api');
    expect(result.target.generationConfig).toEqual({});
    expect(result.target.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    expect(await result.target.authHeaders()).toEqual({ 'x-goog-api-key': 'ai-studio' });
  });

  it('is an error without any key', () => {
    expect(resolveGeminiTarget({})).toEqual({ error: 'missing GCP_SA_KEY and GEMINI_API_KEY' });
  });

  it('builds the URL of any location', () => {
    expect(agentPlatformUrl('p', 'm', 'eu')).toContain(
      'aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/publishers/google/models/m:',
    );
  });
});

describe('generationConfigFor', () => {
  const agentPlatform = { provider: 'agent-platform-eu' as const, generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } };

  it('runs the long writing tasks in medium on Agent Platform (diagnostic past 100 s in high, 2026-10-12)', () => {
    expect(generationConfigFor(agentPlatform, 'report_diagnostic')).toEqual({ thinkingConfig: { thinkingLevel: 'medium' } });
    expect(generationConfigFor(agentPlatform, 'report_reevaluation')).toEqual({ thinkingConfig: { thinkingLevel: 'medium' } });
  });

  it('keeps the target level for the other tasks and the public API config as is', () => {
    expect(generationConfigFor(agentPlatform, 'report_bio')).toEqual({ thinkingConfig: { thinkingLevel: 'high' } });
    expect(generationConfigFor(agentPlatform, 'extract_style_feedback')).toEqual({ thinkingConfig: { thinkingLevel: 'high' } });
    expect(generationConfigFor({ provider: 'gemini-api', generationConfig: {} }, 'report_diagnostic')).toEqual({});
  });
});

describe('attemptTimeoutMs', () => {
  const start = 1_000_000;

  it('gives the first attempt the per-attempt cap', () => {
    expect(attemptTimeoutMs(start, start + 1_000, 100_000)).toBe(100_000);
  });

  it('cuts a retry to what remains before Supabase answers 504 (150 s per request)', () => {
    // 429 after 60 s: a full 100 s retry would end at 160 s, past the gateway limit.
    expect(attemptTimeoutMs(start, start + 60_000, 100_000)).toBe(GEMINI_BUDGET_MS - 60_000);
    expect(GEMINI_BUDGET_MS).toBeLessThan(150_000);
  });

  it('starts no attempt when less than 30 s remain', () => {
    expect(attemptTimeoutMs(start, start + GEMINI_BUDGET_MS - 29_000, 100_000)).toBe(0);
  });
});
