// Created and developed by Jai Singh
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Unit tests run in jsdom (UI components need DOM APIs)
    environment: 'jsdom',
    // Restore Node's Web Crypto API (jsdom overrides it with an incomplete stub)
    setupFiles: ['./src/test-setup.ts'],
    // Align path aliases with vite.config.ts
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Unit tests only — integration tests use vitest.integration.config.ts
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

// Created and developed by Jai Singh
