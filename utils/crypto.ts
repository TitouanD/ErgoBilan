
// Module de Cryptographie Avancée (Web Crypto API)

const VALIDATION_TOKEN = "AUTOBILAN_VALID_TOKEN";

// 1. Génération de la Master Key via PBKDF2
export const deriveMasterKey = async (password: string, salt: string): Promise<CryptoKey> => {
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
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, // IMPORTANT: true pour permettre l'export/wrap de clés avec cette clé
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
};

// 2. Chiffrement Symétrique (AES-GCM) pour les Données
export const encryptData = async (data: any, key: CryptoKey): Promise<{ iv: string; content: string }> => {
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

// 3. Déchiffrement
export const decryptData = async (encryptedObj: { iv: string; content: string }, key: CryptoKey): Promise<any> => {
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

export const verifyPin = async (pin: string, salt: string, validatorStr: string): Promise<CryptoKey | null> => {
    try {
        const [iv, content] = validatorStr.split(':');
        if (!iv || !content) return null;
        const key = await deriveMasterKey(pin, salt);
        const decrypted = await decryptData({ iv, content }, key);
        if (decrypted === VALIDATION_TOKEN) {
            return key;
        }
        return null;
    } catch (e) {
        return null;
    }
};

// --- GESTION DES CLÉS PARTAGÉES (URL LINK) ---

// Génère une clé AES aléatoire pour un questionnaire spécifique
export const generateQuestionnaireKey = async (): Promise<{ key: CryptoKey; keyString: string }> => {
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // Export en JWK pour pouvoir le passer dans l'URL (encodé base64url)
  const exported = await window.crypto.subtle.exportKey("jwk", key);
  // Encodage simple en base64 pour l'URL (safe car hash fragment)
  const keyString = btoa(JSON.stringify(exported));
  
  return { key, keyString };
};

// Reconstruit la clé depuis le fragment d'URL
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
  } catch (e) {
      throw new Error("Clé de questionnaire invalide ou corrompue.");
  }
};
