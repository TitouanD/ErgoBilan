import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  getVerifiedAccessToken: vi.fn(async () => ({ token: 'jwt', error: null })),
}));
vi.mock('./sentryService', () => ({ setAppContext: vi.fn(), recordAppLog: vi.fn() }));

import { callAIProxyTask } from './aiProxy';

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers the edge `generate` with the given responses, in order (the last one repeats). */
const edgeAnswers = (...answers: Array<() => Response>) => {
  let call = 0;
  const fetchMock = vi.fn(async () => answers[Math.min(call++, answers.length - 1)]());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Runs a call to its end, retry delays included. */
const settle = async (promise: Promise<unknown>) => {
  let outcome: { value: unknown } | { error: Error } | undefined;
  promise.then(
    (value) => (outcome = { value }),
    (error: Error) => (outcome = { error }),
  );
  while (!outcome) await vi.advanceTimersByTimeAsync(1_000);
  return outcome;
};

const request = { task: 'report_diagnostic' as const, payload: {}, generationId: 'gen-1' };

describe('callAIProxyTask : relances (#109)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ne relance pas une erreur que l'edge déclare non relançable, même en 502", async () => {
    const fetchMock = edgeAnswers(() => reply(502, { error: 'AI generation failed', code: 'GEMINI_AUTH_ERROR', retryable: false }));
    const outcome = await settle(callAIProxyTask(request));
    expect(outcome).toMatchObject({ error: expect.any(Error) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne relance pas un edge mal configuré', async () => {
    const fetchMock = edgeAnswers(() => reply(500, { error: 'SERVER_MISCONFIGURED' }));
    await settle(callAIProxyTask(request));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('relance une erreur passagère, puis rend le texte', async () => {
    const fetchMock = edgeAnswers(
      () => reply(503, { error: 'AI generation failed', code: 'GEMINI_RETRYABLE_ERROR', retryable: true }),
      () => reply(200, { text: '{"ok":true}', generationId: 'gen-1' }),
    );
    const outcome = await settle(callAIProxyTask(request));
    expect(outcome).toEqual({ value: { text: '{"ok":true}', generationId: 'gen-1' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne relance qu'une fois après un délai dépassé chez Gemini", async () => {
    const fetchMock = edgeAnswers(() => reply(504, { error: 'AI generation failed', code: 'GEMINI_TIMEOUT', retryable: true }));
    const outcome = await settle(callAIProxyTask(request));
    expect(outcome).toMatchObject({ error: expect.any(Error) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('garde trois tentatives pour les autres erreurs relançables', async () => {
    const fetchMock = edgeAnswers(() => reply(502, { error: 'AI generation failed', code: 'GEMINI_EMPTY_RESPONSE', retryable: true }));
    await settle(callAIProxyTask(request));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
