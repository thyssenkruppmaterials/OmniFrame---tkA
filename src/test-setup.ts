// Created and developed by Jai Singh
/**
 * Vitest global setup file.
 *
 * jsdom ships its own `crypto` object which lacks the SubtleCrypto API
 * (`crypto.subtle`). We restore Node's built-in Web Crypto implementation
 * so that modules using AES-GCM, PBKDF2, etc. work correctly in tests.
 *
 * We also re-assign `Uint8Array` from the Node realm to avoid cross-realm
 * TypedArray issues where jsdom's Uint8Array is not recognized by Node's
 * Web Crypto API.
 */
import { webcrypto } from 'node:crypto'

// Restore Node's crypto (jsdom stubs it without SubtleCrypto)
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
})

// Created and developed by Jai Singh
