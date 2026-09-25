/**
 * crypto.ts — Web Crypto helpers.
 *
 * - PIN: PBKDF2-SHA256 → AES-GCM key (`sessionKey`). A validator (the constant
 *   VALIDATION_TOKEN encrypted with that key) is stored in `practitioners` so the
 *   PIN can be checked. The key wraps the portal questionnaire keys; it does NOT
 *   encrypt local patient data yet (docs/TECH_DEBT.md P0-1).
 * - Portal: one random AES-GCM key per questionnaire, carried in the URL fragment
 *   (`#key=...`, never sent to a server).
 *
 * Serialized ciphertexts are `{ iv: hex, content: base64 }` (stored as "iv:content").
 */

const VALIDATION_TOKEN = 'ERGOBILAN_VALID_TOKEN';
/** OWASP 2023+ recommendation for PBKDF2-SHA256. */
const CURRENT_ITERATIONS = 600_000;
/** Iteration count of accounts created before the upgrade (still accepted, see verifyPin). */
const LEGACY_ITERATIONS = 100_000;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Derive the AES-GCM key of a PIN. */
export const deriveMasterKey = async (password: string, salt: string, iterations = CURRENT_ITERATIONS): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']);
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
};

/** AES-GCM encryption of any JSON-serializable value. */
export const encryptData = async (data: unknown, key: CryptoKey): Promise<{ iv: string; content: string }> => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { iv: toHex(iv), content: btoa(String.fromCharCode(...new Uint8Array(encrypted))) };
};

export const decryptData = async (encrypted: { iv: string; content: string }, key: CryptoKey): Promise<unknown> => {
  const ivBytes = encrypted.iv.match(/.{1,2}/g);
  if (!ivBytes) throw new Error('Invalid IV');
  const iv = new Uint8Array(ivBytes.map((byte) => parseInt(byte, 16)));
  const content = Uint8Array.from(atob(encrypted.content), (c) => c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, content);
  return JSON.parse(new TextDecoder().decode(decrypted));
};

// ─── PIN ─────────────────────────────────────────────────────────────────────

/** New PIN: random salt, derived key and the validator to store. */
export const setupPin = async (pin: string): Promise<{ key: CryptoKey; salt: string; validator: string }> => {
  const salt = toHex(window.crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveMasterKey(pin, salt);
  const validation = await encryptData(VALIDATION_TOKEN, key);
  return { key, salt, validator: `${validation.iv}:${validation.content}` };
};

export interface PinVerifyResult {
  /** Always the key derived with CURRENT_ITERATIONS (used to wrap portal keys). */
  key: CryptoKey;
}

/**
 * Check a PIN against the stored validator. Validators created with the legacy
 * iteration count are still accepted (they cannot be rewritten: the DB forbids
 * changing a set validator), and the current-iteration key is returned.
 */
export const verifyPin = async (pin: string, salt: string, validatorStr: string): Promise<PinVerifyResult | null> => {
  const [iv, content] = validatorStr.split(':');
  if (!iv || !content) return null;

  const matches = async (iterations: number): Promise<CryptoKey | null> => {
    try {
      const key = await deriveMasterKey(pin, salt, iterations);
      return (await decryptData({ iv, content }, key)) === VALIDATION_TOKEN ? key : null;
    } catch {
      return null;
    }
  };

  const current = await matches(CURRENT_ITERATIONS);
  if (current) return { key: current };
  if (await matches(LEGACY_ITERATIONS)) return { key: await deriveMasterKey(pin, salt, CURRENT_ITERATIONS) };
  return null;
};

// ─── Portal questionnaire keys ───────────────────────────────────────────────

/** Random AES-GCM key of a questionnaire and its URL-fragment encoding (base64 JWK). */
export const generateQuestionnaireKey = async (): Promise<{ key: CryptoKey; keyString: string }> => {
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await window.crypto.subtle.exportKey('jwk', key);
  return { key, keyString: btoa(JSON.stringify(exported)) };
};

/** Rebuild a questionnaire key from its URL-fragment encoding. */
export const importQuestionnaireKey = async (keyString: string): Promise<CryptoKey> => {
  try {
    return await window.crypto.subtle.importKey('jwk', JSON.parse(atob(keyString)), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch {
    throw new Error('Clé de questionnaire invalide ou corrompue.');
  }
};

/** Random AES-GCM key (demo mode session key). */
export const generateSymetricKey = async (): Promise<CryptoKey> =>
  window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
