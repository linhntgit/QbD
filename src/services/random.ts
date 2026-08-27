/** Deterministic Mulberry32 generator for reproducible scientific workflows. */
export function createSeededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable non-cryptographic seed derived from a project identifier. */
export function stableSeedFromText(text: string, salt = ''): number {
  let hash = 2166136261;
  for (const char of `${salt}:${text}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}
