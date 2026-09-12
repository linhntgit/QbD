/**
 * Pure TypeScript Zero-Dependency Cryptographic SHA-256 Engine (FIPS 180-4)
 * and RFC 8785 Deterministic Canonical JSON Serializer.
 *
 * Designed for 21 CFR Part 11 / EU GMP Annex 11 GxP compliance.
 * Runs synchronously in Node.js, Vitest, Browser main thread, and Web Workers.
 */

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

/**
 * Standard FIPS 180-4 SHA-256 implementation.
 * Returns a 64-character lowercase hex string.
 */
export function sha256(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8Encode(input) : input;
  const msgLen = bytes.length;

  // Padding: message + 0x80 + zeros + 64-bit length in bits (big-endian)
  const totalLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;

  const bitLen = msgLen * 8;
  const bitLenHigh = Math.floor(bitLen / 0x100000000);
  const bitLenLow = bitLen >>> 0;

  padded[totalLen - 8] = (bitLenHigh >>> 24) & 0xff;
  padded[totalLen - 7] = (bitLenHigh >>> 16) & 0xff;
  padded[totalLen - 6] = (bitLenHigh >>> 8) & 0xff;
  padded[totalLen - 5] = bitLenHigh & 0xff;
  padded[totalLen - 4] = (bitLenLow >>> 24) & 0xff;
  padded[totalLen - 3] = (bitLenLow >>> 16) & 0xff;
  padded[totalLen - 2] = (bitLenLow >>> 8) & 0xff;
  padded[totalLen - 1] = bitLenLow & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const W = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let t = 0; t < 16; t++) {
      const idx = offset + t * 4;
      W[t] =
        (padded[idx] << 24) |
        (padded[idx + 1] << 16) |
        (padded[idx + 2] << 8) |
        padded[idx + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

/**
 * Deterministic canonical JSON serializer (RFC 8785).
 * Guarantees identical string representation and hash across object key permutations.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        return 'null';
      }
      return canonicalJsonStringify(item);
    });
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = record[key];
      if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`);
    }
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

/**
 * Calculates SHA-256 of any JavaScript data structure using canonical serialization.
 */
export function hashObject(data: unknown): string {
  return sha256(canonicalJsonStringify(data));
}

/**
 * Calculates the payload hash for a project or data snapshot.
 * Prunes volatile artifacts and signature/lock metadata to avoid circular hash dependency.
 */
export function computeProjectPayloadHash(project: unknown): string {
  if (typeof project === 'object' && project !== null) {
    const record = project as Record<string, unknown>;
    if ('factors' in record && 'cqas' in record) {
      const cloned = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
      if (cloned.analysisSettings && typeof cloned.analysisSettings === 'object') {
        delete (cloned.analysisSettings as Record<string, unknown>).neuralArtifacts;
      }
      delete cloned.electronicSignatures;
      delete cloned.isLocked;
      delete cloned.lockDetails;
      return hashObject(cloned);
    }
  }
  return hashObject(project);
}
