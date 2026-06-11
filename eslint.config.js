import globals from 'globals'
import js from '@eslint/js'
import pluginQuery from '@tanstack/eslint-plugin-query'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'src/components/ui', '.pytest_cache', 'pytest-cache-files-*', 'node_modules', 'api', 'rust-core-service', 'rust-work-service', 'rust-ai-service', 'rust-streaming-service', 'rust-dashboard-service', 'rust-mdm-service', 'supabase/functions', 'ios', 'load_test_logs', '.tmp', '.agents', '.cursor'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...pluginQuery.configs['flat/recommended'],
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-console': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Burn-down: 1274 instances as of 2026-02-15 baseline.
      // Kept as 'warn' for production source; relaxed for tests below.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Tanstack query rules tracked as warnings during stabilization.
      '@tanstack/query/no-unstable-deps': 'warn',
      '@tanstack/query/exhaustive-deps': 'warn',
    },
  },
  // ── Override: auth provider/guard files co-locate hooks with providers ──
  // This is the standard React Context pattern; fast refresh warnings are
  // expected and harmless for these files.
  {
    files: [
      'src/lib/auth/**/*.tsx',
      'src/components/auth/**/*.tsx',
      'src/**/context/**/*.tsx',
      'src/hooks/**/*.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // ── Override: relax no-explicit-any in test files ───────────────────────
  // Test files legitimately use `any` for mocks, dynamic imports, and
  // type-erased assertions. Suppressing these warnings removes ~200+
  // false-positive warnings and focuses lint signal on production code.
  {
    files: [
      'src/__tests__/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // ── Override: relax no-explicit-any in large data-service files ─────────
  // These service files interact heavily with untyped external APIs
  // (Smartsheet, SAP, LX03). Typing them properly requires upstream
  // schema work tracked in the backlog.
  {
    files: [
      'src/features/**/services/*.service.ts',
      'src/lib/api/smartsheet.ts',
      'src/lib/supabase/*.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // ── Override: relax in stores, workers, context, and hooks files ────────
  // State stores use `any` for generic event handling and zustand middleware.
  // Workers use `any` for untyped message passing.
  // Context/hooks use `any` for generic provider/consumer patterns.
  {
    files: [
      'src/stores/**/*.ts',
      'src/workers/**/*.ts',
      'src/context/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
