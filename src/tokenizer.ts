// src/tokenizer.ts
//
// The cl100k_base encoding table is ~1.5 MB of JSON data. Using a dynamic
// import() defers loading to the first tokenizer call, keeping the main
// bundle small (~512 KB vs ~1.7 MB) and preventing Logseq startup blocking.

import { Tiktoken } from "js-tiktoken/lite";

let _instance: Tiktoken | null = null;
let _initPromise: Promise<Tiktoken> | null = null;

/**
 * Lazily initialize the tokenizer. Uses dynamic import() so the ~1.5 MB
 * cl100k_base encoding table is loaded on demand, not at bundle parse time.
 * Falls back to synchronous initialization if the dynamic import fails
 * (e.g., in test environments where dynamic import may not work).
 */
function getInstance(): Tiktoken {
  if (_instance) return _instance;

  // Synchronous fallback: import the encoding data directly.
  // In the Vite production build, the dynamic import() in ensureInitialized()
  // should be called first. This fallback handles test environments and
  // edge cases where the async path wasn't awaited.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cl100k_base = require("js-tiktoken/ranks/cl100k_base");
    _instance = new Tiktoken(cl100k_base.default ?? cl100k_base);
    return _instance;
  } catch {
    throw new Error(
      'Failed to initialize cl100k_base tokenizer. Call ensureInitialized() first in production.'
    );
  }
}

/**
 * Pre-initialize the tokenizer asynchronously via dynamic import.
 * Call this during app startup to load the encoding table without blocking.
 * If not called, getInstance() falls back to synchronous require().
 */
export async function ensureInitialized(): Promise<void> {
  if (_instance) return;
  if (_initPromise) { await _initPromise; return; }
  _initPromise = (async () => {
    try {
      const mod = await import("js-tiktoken/ranks/cl100k_base");
      _instance = new Tiktoken(mod.default ?? mod);
      return _instance;
    } catch {
      // Fall back to synchronous initialization
      _instance = getInstance();
      return _instance;
    }
  })();
  await _initPromise;
}

/** Return the exact cl100k_base token count for the given string. */
export function countTokens(text: string): number {
  return getInstance().encode(text).length;
}

/** Encode a string into cl100k_base token IDs. */
export function encode(text: string): number[] {
  return getInstance().encode(text);
}

/** Decode token IDs back to a string. */
export function decode(tokens: number[]): string {
  return getInstance().decode(tokens);
}
