import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { execSync } from 'child_process'
import fs from 'fs'
import { VitePWA } from 'vite-plugin-pwa'

// =============================================================================
// Build Version Plugin - Enterprise Cache Busting
// Computes a deterministic build hash at compile time and writes build-info.json
// to the output directory. The SAME hash is injected into the JS bundle via
// `define`, ensuring __BUILD_HASH__ always matches the deployed build-info.json.
// =============================================================================

function getBuildHash(): {
  hash: string
  commitHash: string
  buildTime: string
} {
  let commitHash = 'unknown'
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
    }).trim()
  } catch {
    // Git not available (e.g., Docker build without .git) - use timestamp only
    // eslint-disable-next-line no-console
    console.warn('[build-version] Git not available, using timestamp-only hash')
  }

  const buildTime = new Date().toISOString()
  const hash = `${commitHash}-${Date.now().toString(36)}`
  return { hash, commitHash, buildTime }
}

// Compute hash ONCE at module scope so it's shared between the plugin and PWA config
const BUILD_META = getBuildHash()
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
).version

function buildVersionPlugin(): Plugin {
  const { hash: buildHash, commitHash, buildTime } = BUILD_META
  const packageVersion = PACKAGE_VERSION

  // Log at config time so it's visible in build output
  // eslint-disable-next-line no-console
  console.log(`[build-version] Hash: ${buildHash}`)
  // eslint-disable-next-line no-console
  console.log(`[build-version] Commit: ${commitHash}`)
  // eslint-disable-next-line no-console
  console.log(`[build-version] Version: ${packageVersion}`)

  return {
    name: 'build-version',
    config() {
      return {
        define: {
          __BUILD_HASH__: JSON.stringify(buildHash),
          __BUILD_TIME__: JSON.stringify(buildTime),
          __APP_VERSION__: JSON.stringify(packageVersion),
        },
      }
    },
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist')
      const buildInfo = {
        version: packageVersion,
        buildId: buildHash,
        buildTime,
        commitHash,
        environment: process.env.NODE_ENV || 'production',
      }
      fs.writeFileSync(
        path.join(outDir, 'build-info.json'),
        JSON.stringify(buildInfo, null, 2)
      )
      // eslint-disable-next-line no-console
      console.log(`[build-version] build-info.json written to ${outDir}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    {
      name: 'forbid-service-role-key',
      config(_, { mode }) {
        if (
          mode === 'production' &&
          process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
        ) {
          throw new Error(
            'VITE_SUPABASE_SERVICE_ROLE_KEY must not be set in production builds. ' +
              'Service-role access should only happen server-side.'
          )
        }
      },
    },
    buildVersionPlugin(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    VitePWA({
      // Manual registration - prevents auto-registering a root-scoped service
      // worker that intercepts ALL requests. The RF PWA Manager handles
      // registration only for /rf-interface/ routes.
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Explicitly exclude build-info.json from precache to ensure the
        // version checker always fetches the latest from the network.
        globIgnores: ['**/build-info.json', '**/sw.js'],
        // Navigation fallback for SPA routing
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/_/,
          /\/[^/?]+\.[^/]+$/,
          /\/build-info\.json(\?.*)?$/,
        ],
        navigationPreload: false,
        // Deterministic cache ID from git hash - NOT Date.now()
        cacheId: `omniframe-${BUILD_META.hash}`,
        skipWaiting: true,
        clientsClaim: true,
        // Force cleanup of old caches from previous builds
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // CRITICAL: build-info.json must ALWAYS go to the network.
          // This prevents the service worker from ever caching or
          // intercepting version-check requests.
          {
            urlPattern: /\/build-info\.json(\?.*)?$/,
            handler: 'NetworkOnly',
          },
          // Service worker itself should never be cached
          {
            urlPattern: /\/sw\.js(\?.*)?$/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      includeAssets: [
        'favicon.ico',
        'images/favicon.svg',
        'images/favicon_light.svg',
        'images/favicon.svg',
      ],
      manifest: {
        name: 'OmniFrame - RF Terminal',
        short_name: 'RF Terminal',
        description: 'RF Terminal Interface for warehouse operations.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/rf-interface',
        scope: '/rf-interface',
        icons: [
          {
            src: 'images/favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'images/favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'images/favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      // Externalize server-only Node modules from the browser bundle
      external: ['ioredis'],
      output: {
        manualChunks(id) {
          // ── Vendor splits (third-party node_modules) ──
          // IMPORTANT: Only split vendors that do NOT depend on React at module
          // evaluation time. Libraries like @radix-ui, recharts, framer-motion,
          // @tanstack/react-*, react-pdf, react-hook-form, and @tabler/icons-react
          // all call React APIs (forwardRef, useLayoutEffect, createContext, etc.)
          // at the top level. Isolating them in separate chunks breaks the React
          // dependency chain at runtime, causing "Cannot read properties of
          // undefined" errors in production.
          //
          // SAFE to split: pure JS libraries with zero React dependency.
          // NOT safe: anything that imports from 'react' at the module top level.
          if (id.includes('node_modules')) {
            // Supabase client stack — pure JS, no React dependency (~100+ KB)
            if (id.includes('/@supabase/')) return 'vendor-supabase'
            // Date utilities — pure JS, no React dependency (~40+ KB)
            if (id.includes('/date-fns/')) return 'vendor-date-fns'
            // D3 visualization core — pure JS, no React dependency (~200+ KB)
            // NOTE: recharts (React wrapper) is NOT split — only the d3-* deps are.
            if (id.includes('/d3-')) return 'vendor-d3'
            // PDF.js engine — pure JS, no React dependency (~250+ KB)
            // NOTE: react-pdf (React wrapper) is NOT split — only pdfjs-dist is.
            if (id.includes('/pdfjs-dist/')) return 'vendor-pdfjs'
          }

          // ── First-party feature splits (heavy feature modules) ──
          // Admin sub-features (split to keep each under 500 KB)
          // Onboarding steps are lazy-loaded via React.lazy() — do NOT override that.
          // Only group the wizard container/shared/context, let steps split naturally.
          if (id.includes('/features/admin/onboarding/components/steps/'))
            return undefined
          if (id.includes('/features/admin/onboarding/'))
            return 'feature-admin-onboarding'
          if (id.includes('/features/admin/roles/'))
            return 'feature-admin-roles'
          if (
            id.includes('/features/admin/permissions/') ||
            id.includes('/features/admin/compliance/')
          )
            return 'feature-admin-permissions'
          if (id.includes('/features/admin/security/'))
            return 'feature-admin-security'
          if (id.includes('/features/admin/system-settings/'))
            return 'feature-admin-settings'
          if (id.includes('/features/admin/work-queue/'))
            return 'feature-admin-work-queue'
          if (id.includes('/features/admin/sap-testing/'))
            return 'feature-admin-sap'
          if (id.includes('/features/admin/performance-monitor/'))
            return 'feature-admin-perf'
          if (id.includes('/features/admin/')) return 'feature-admin'
          // Shift productivity sub-features
          if (id.includes('/features/shift-productivity/team-performance/'))
            return 'feature-shift-team'
          if (
            id.includes('/features/shift-productivity/associate-performance/')
          )
            return 'feature-shift-associate'
          if (id.includes('/features/shift-productivity/'))
            return 'feature-shift-productivity'
          // Other heavy features
          if (id.includes('/features/camera-system/'))
            return 'feature-camera-system'
          if (id.includes('/features/customer-portal/'))
            return 'feature-customer-portal'
          if (id.includes('/features/hr/')) return 'feature-hr'
          if (id.includes('/features/outbound/')) return 'feature-outbound'
          if (id.includes('/features/rf-interface/'))
            return 'feature-rf-interface'

          // Everything else uses Vite/Rollup default chunking
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
  },
})
