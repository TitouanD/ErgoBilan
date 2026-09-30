import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptEnvelope, encryptToEnvelope, generateSymetricKey, parseEnvelope, setupPin, verifyPin } from './crypto';

beforeAll(() => {
  // crypto.ts reads window.crypto (browser); Node exposes the same WebCrypto globally.
  vi.stubGlobal('window', { crypto: globalThis.crypto });
});

describe('envelope "iv:content"', () => {
  it('round-trips a questionnaire payload', async () => {
    const key = await generateSymetricKey();
    const payload = { patient: { firstName: 'Léa', notes: 'a:b:c' }, timestamp: '2026-09-30T10:00:00.000Z' };

    const envelope = await encryptToEnvelope(payload, key);

    expect(parseEnvelope(envelope)).not.toBeNull();
    expect(await decryptEnvelope(envelope, key)).toEqual(payload);
  });

  it('rejects a malformed envelope', async () => {
    const key = await generateSymetricKey();
    expect(parseEnvelope('')).toBeNull();
    expect(parseEnvelope('abcdef')).toBeNull();
    expect(parseEnvelope('abcdef:')).toBeNull();
    await expect(decryptEnvelope('abcdef', key)).rejects.toThrow();
  });

  it('fails with the wrong key', async () => {
    const envelope = await encryptToEnvelope('secret', await generateSymetricKey());
    await expect(decryptEnvelope(envelope, await generateSymetricKey())).rejects.toThrow();
  });
});

describe('PIN validator', () => {
  it('accepts the right PIN and rejects a wrong one or a malformed validator', async () => {
    const { salt, validator } = await setupPin('1234');

    expect(await verifyPin('1234', salt, validator)).not.toBeNull();
    expect(await verifyPin('0000', salt, validator)).toBeNull();
    expect(await verifyPin('1234', salt, 'garbage')).toBeNull();
  }, 30_000);
});
