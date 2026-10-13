import { describe, expect, it } from 'vitest';
import { readEdgeErrorBody } from './billing';

describe('readEdgeErrorBody (#110)', () => {
  it("lit le code d'erreur renvoyé par l'edge billing", async () => {
    const error = { context: new Response(JSON.stringify({ error: 'PAYMENT_NOT_AVAILABLE' }), { status: 403 }) };
    expect(await readEdgeErrorBody(error)).toEqual({ error: 'PAYMENT_NOT_AVAILABLE' });
  });

  it('renvoie null sans réponse exploitable', async () => {
    expect(await readEdgeErrorBody(new Error('réseau'))).toBeNull();
    expect(await readEdgeErrorBody({ context: new Response('pas du JSON', { status: 500 }) })).toBeNull();
  });
});
