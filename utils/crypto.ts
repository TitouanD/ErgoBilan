
// Module de Cryptographie AvancÃ©e (Web Crypto API)

const VALIDATION_TOKEN = "ERGOBILAN_VALID_TOKEN";
const CURRENT_ITERATIONS = 600_000; // OWASP 2024 recommendation for PBKDF2-SHA256
const LEGACY_ITERATIONS = 100_000; // Previous iteration count â€” used for migration only

// 1. GÃ©nÃ©ration de la Master Key via PBKDF2
export const deriveMasterKey = async (password: string, salt: string, iterations = CURRENT_ITERATIONS): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, // IMPORTANT: true pour permettre l'export/wrap de clÃ©s avec cette clÃ©
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
};

// 2. Chiffrement SymÃ©trique (AES-GCM) pour les DonnÃ©es
export const encryptData = async (data: unknown, key: CryptoKey): Promise<{ iv: string; content: string }> => {
  const enc = new TextEncoder();
  const encoded = enc.encode(JSON.stringify(data));
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // Vecteur d'initialisation unique

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoded
  );

  return {
    iv:  Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    content: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)))
  };
};

// 3. DÃ©chiffrement
export const decryptData = async (encryptedObj: { iv: string; content: string }, key: CryptoKey): Promise<unknown> => {
  const dec = new TextDecoder();
  
  // Conversion hex string -> Uint8Array pour l'IV
  const ivMatch = encryptedObj.iv.match(/.{1,2}/g);
  if (!ivMatch) throw new Error("Invalid IV");
  const iv = new Uint8Array(ivMatch.map(byte => parseInt(byte, 16)));

  // Conversion base64 -> Uint8Array pour le contenu
  const encryptedContent = Uint8Array.from(atob(encryptedObj.content), c => c.charCodeAt(0));

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encryptedContent
  );

  return JSON.parse(dec.decode(decryptedBuffer));
};

// 4. --- PIN FLOW (Security Challenge) ---

export const setupPin = async (pin: string): Promise<{ key: CryptoKey, salt: string, validator: string }> => {
    const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const key = await deriveMasterKey(pin, salt);
    const validation = await encryptData(VALIDATION_TOKEN, key);
    const validator = `${validation.iv}:${validation.content}`;
    return { key, salt, validator };
};

/** Result of PIN verification, includes migration info when upgrading from legacy PBKDF2 iterations */
export interface PinVerifyResult {
    key: CryptoKey;
    /** If set, the caller should persist this new validator to replace the legacy one */
    migratedValidator?: string;
}

export const verifyPin = async (pin: string, salt: string, validatorStr: string): Promise<PinVerifyResult | null> => {
    const [iv, content] = validatorStr.split(':');
    if (!iv || !content) return null;

    // 1. Try current iterations (600k)
    try {
        const key = await deriveMasterKey(pin, salt, CURRENT_ITERATIONS);
        const decrypted = await decryptData({ iv, content }, key);
        if (decrypted === VALIDATION_TOKEN) return { key };
    } catch {
        // Decryption failed â€” may be using legacy iteration count
    }

    // 2. Fallback to legacy iterations (100k) for accounts created before upgrade
    try {
        const legacyKey = await deriveMasterKey(pin, salt, LEGACY_ITERATIONS);
        const decrypted = await decryptData({ iv, content }, legacyKey);
        if (decrypted !== VALIDATION_TOKEN) return null;

        // Legacy key worked â†’ re-derive with current iterations and produce a new validator
        const newKey = await deriveMasterKey(pin, salt, CURRENT_ITERATIONS);
        const newValidation = await encryptData(VALIDATION_TOKEN, newKey);
        const migratedValidator = `${newValidation.iv}:${newValidation.content}`;

        return { key: newKey, migratedValidator };
    } catch {
        return null;
    }
};

// --- GESTION DES CLÃ‰S PARTAGÃ‰ES (URL LINK) ---

// GÃ©nÃ¨re une clÃ© AES alÃ©atoire pour un questionnaire spÃ©cifique
export const generateQuestionnaireKey = async (): Promise<{ key: CryptoKey; keyString: string }> => {
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // Export en JWK pour pouvoir le passer dans l'URL (encodÃ© base64url)
  const exported = await window.crypto.subtle.exportKey("jwk", key);
  // Encodage simple en base64 pour l'URL (safe car hash fragment)
  const keyString = btoa(JSON.stringify(exported));
  
  return { key, keyString };
};

// Reconstruit la clÃ© depuis le fragment d'URL
export const importQuestionnaireKey = async (keyString: string): Promise<CryptoKey> => {
  try {
      const jwk = JSON.parse(atob(keyString));
      return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );
  } catch {
      throw new Error("ClÃ© de questionnaire invalide ou corrompue.");
  }
};

// --- NOUVEAU : KEY WRAPPING (HIÃ‰RARCHIE DE CLÃ‰S) ---

// 1. GÃ©nÃ©rer une nouvelle clÃ© AES-GCM exportable (ex: OrgKey ou FileKey)
export const generateSymetricKey = async (): Promise<CryptoKey> => {
    return window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, // Exportable pour pouvoir Ãªtre chiffrÃ©e (wrapped)
        ["encrypt", "decrypt"]
    );
};

// 2. Wrap Key : Chiffre une clÃ© "enfant" avec une clÃ© "parent"
// Ex: Chiffrer OrgKey avec MasterKey(PIN)
export const wrapKey = async (keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<{ iv: string, content: string }> => {
    // On exporte d'abord la clÃ© Ã  chiffrer en format JWK (JSON)
    const exportedKey = await window.crypto.subtle.exportKey("jwk", keyToWrap);
    // On chiffre ce JSON comme une donnÃ©e normale
    return encryptData(exportedKey, wrappingKey);
};

// 3. Unwrap Key : DÃ©chiffre une clÃ© "enfant" avec une clÃ© "parent"
// Ex: DÃ©chiffrer OrgKey avec MasterKey(PIN)
export const unwrapKey = async (encryptedKey: { iv: string, content: string }, unwrappingKey: CryptoKey): Promise<CryptoKey> => {
    // On dÃ©chiffre pour rÃ©cupÃ©rer le JSON (JWK)
    const decryptedJwk = await decryptData(encryptedKey, unwrappingKey);
    // On rÃ©importe le JSON en objet CryptoKey utilisable
    return window.crypto.subtle.importKey(
        "jwk",
        decryptedJwk,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"] // Droits de la clÃ© restaurÃ©e
    );
};

