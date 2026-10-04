import type { GxPRole, AuditUser } from './projectGovernance';

export interface ActiveUserSession {
  name: string;
  role: GxPRole;
  department: string;
  loginTime: string;
}

const SESSION_STORAGE_KEY = 'qbd_active_user_session';
const DEFAULT_SESSION: ActiveUserSession = {
  name: 'Tran Linh Nguyen',
  role: 'Analyst',
  department: 'Phòng Bào Chế & R&D',
  loginTime: new Date().toISOString(),
};

/**
 * Retrieves the currently active user session from localStorage,
 * or returns default session.
 */
export function getActiveSession(): ActiveUserSession {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SESSION };
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === 'string' && typeof parsed.role === 'string') {
      return {
        name: parsed.name,
        role: parsed.role as GxPRole,
        department: parsed.department || DEFAULT_SESSION.department,
        loginTime: parsed.loginTime || new Date().toISOString(),
      };
    }
  } catch {
    // fallback
  }

  return { ...DEFAULT_SESSION };
}

/**
 * Persists the updated session into storage.
 */
export function setActiveSession(session: Partial<ActiveUserSession>): ActiveUserSession {
  const current = getActiveSession();
  const updated: ActiveUserSession = {
    ...current,
    ...session,
    loginTime: session.loginTime || current.loginTime,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // quota or private mode
    }
  }

  return updated;
}

/**
 * Returns an AuditUser object suitable for recording in projectGovernance audit entries.
 */
export function getAuditUserFromSession(): AuditUser {
  const session = getActiveSession();
  return {
    name: session.name,
    role: session.role,
    department: session.department,
  };
}

// --- WebCrypto Hardware / Browser-Bound Cryptographic Signatures (G3) ---

let inMemoryKeyPair: CryptoKeyPair | null = null;

/**
 * Generates or retrieves an ECDSA P-256 signing key pair bound to this browser session.
 */
export async function getSigningKeyPair(): Promise<CryptoKeyPair | null> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    return null;
  }

  if (inMemoryKeyPair) return inMemoryKeyPair;

  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true, // extractable public key, private key retained
      ['sign', 'verify']
    );
    inMemoryKeyPair = keyPair;
    return keyPair;
  } catch {
    return null;
  }
}

/**
 * Signs an input string (e.g. SHA-256 root checksum) using the browser's ECDSA private key.
 * Returns a hex-encoded digital signature string.
 */
export async function signWithWebCryptoECDSA(dataHexOrString: string): Promise<{ signatureHex: string; publicKeyHex: string } | null> {
  const keyPair = await getSigningKeyPair();
  if (!keyPair || typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    return null;
  }

  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(dataHexOrString);

    const signature = await window.crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      keyPair.privateKey,
      dataBuffer
    );

    const exportedPublic = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const pubHex = Array.from(new Uint8Array(exportedPublic))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return { signatureHex: sigHex, publicKeyHex: pubHex };
  } catch {
    return null;
  }
}
