// Created and developed by Jai Singh
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
        cacheId: `onebox-ai-${BUILD_META.hash}`,
        skipWaiting: true,
        clientsClaim: true,
        // Force cleanup of old caches from previous builds
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // build-info.json: NetworkFirst with a 1-entry, 5-min cache.
          //
          // Network-first preserves the original "always try the network"
          // intent — the SW will fetch fresh on every poll. The tiny cache
          // is a fallback for the corporate-proxy scenario:
          //
          //   Warehouse RF terminals sit behind Zscaler / Symantec WSS,
          //   which intercepts /build-info.json with a CORS-blocked
          //   redirect every poll. Without a cache, the version checker
          //   sees `TypeError: Failed to fetch` and floods the console;
          //   with a cache, the SW returns the last successful payload,
          //   the version checker sees a hash that matches the running
          //   build, and there's no spurious "update available" trigger.
          //
          // Safety: the cached value is whatever the network most-recently
          // returned, so it can never be OLDER than the running build —
          // worst case it's equal (no false trigger) or newer (correct
          // trigger). The 5-min TTL keeps stale values from lingering
          // across deploys when the proxy block clears.
          //
          // See `Debug/Fix-Version-Checker-Corporate-Proxy-Noise.md`.
          {
            urlPattern: /\/build-info\.json(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'build-info-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 5 * 60,
              },
            },
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
        'images/OneBoxLogoX.png',
        'images/favicon.png',
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
            src: 'images/OneBoxLogoX.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'images/OneBoxLogoX.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'images/OneBoxLogoX.png',
            sizes: '512x512',
            type: 'image/png',
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
            // Three.js core + its pure-JS ecosystem (controls, loaders, troika
            // text, meshline, gainmap, bvh, maath…). All are plain JS with NO
            // React top-level dependency, so they are SAFE to vendor-split (the
            // React-coupled @react-three/fiber + @react-three/drei wrappers are
            // deliberately NOT matched here — they ride the default chunker with
            // the lazy feature-warehouse-3d chunk). This ~1 MB engine only loads
            // when the 3D Location Tab opens, so vendor-three is budget-exempt
            // (see scripts/check-bundle-budget.mjs LAZY_VENDOR_EXEMPT).
            if (
              id.includes('/three/') ||
              id.includes('/three-stdlib/') ||
              id.includes('/troika-three-text/') ||
              id.includes('/troika-three-utils/') ||
              id.includes('/troika-worker-utils/') ||
              id.includes('/webgl-sdf-generator/') ||
              id.includes('/bidi-js/') ||
              id.includes('/meshline/') ||
              id.includes('/@monogrid/gainmap-js/') ||
              id.includes('/three-mesh-bvh/') ||
              id.includes('/stats-gl/') ||
              id.includes('/stats.js/') ||
              id.includes('/detect-gpu/') ||
              id.includes('/camera-controls/') ||
              id.includes('/maath/')
            )
              return 'vendor-three'
          }

          // ── First-party feature splits (heavy feature modules) ──
          // Isometric 3D warehouse scene engine. Lazy-loaded by
          // warehouse-location-map; carving it into a dedicated chunk keeps the
          // three.js-using scene code out of the warehouse-map shell chunk. NOTE
          // per the manualChunks rule above we do NOT pull three/fiber/drei into
          // a vendor chunk here — fiber/drei are React-coupled. They ride the
          // default chunker; only our first-party scene3d/ source lands here.
          // Parametric geometry recipe modules (objects/recipes-*) — their own
          // chunk. They are statically imported by SceneObject so they load in
          // parallel with feature-warehouse-3d behind the same lazy boundary,
          // but splitting keeps BOTH sides of the catalog under the 500 KB
          // per-chunk gate as the object library grows.
          if (id.includes('/components/warehouse-map/scene3d/objects/recipes-'))
            return 'feature-warehouse-recipes'
          // The editor's DOM overlay panels are React.lazy()-loaded — leave
          // them to the default chunker (feature-warehouse-3d sits AT the
          // 500 KB gate; forcing them in here defeats those dynamic imports).
          // scene3d/simulation/ (live pick-scenario engine + layer + panel)
          // is likewise fully lazy and must stay out for the same reason.
          if (
            id.includes('/components/warehouse-map/scene3d/') &&
            !id.includes('/scene3d/simulation/') &&
            !/scene3d\/(RackSystemDialog|FurnitureLibraryPanel|InsightsPanel|LayersPanel|MultiSelectToolbar|ShortcutsDialog|ObjectConfigPanel|FloorPlanDialog|RackConfigPanel3D)\.tsx/.test(
              id
            )
          )
            return 'feature-warehouse-3d'
          // Supply-chain 3D globe (three/webgpu + TSL). The scene engine is
          // React.lazy()-loaded from the page shell — keep them in separate
          // chunks so the route chunk stays light and the engine (plus the
          // vendor-three graph it drags in) only downloads when the canvas
          // actually mounts.
          if (id.includes('/features/admin/supply-chain-mapping/scene/'))
            return 'feature-supply-chain-3d'
          if (id.includes('/features/admin/supply-chain-mapping/'))
            return 'feature-supply-chain'
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
          if (id.includes('/features/admin/omnibelt-dashboard/'))
            return 'feature-admin-omnibelt'
          if (id.includes('/features/admin/')) return 'feature-admin'
          // Shift productivity sub-features
          if (id.includes('/features/shift-productivity/team-performance/'))
            return 'feature-shift-team'
          if (
            id.includes('/features/shift-productivity/associate-performance/')
          )
            return 'feature-shift-associate'
          // Production-boards per-board chunks: each board's body is lazy-loaded
          // via React.lazy() in lib/boards.ts. Returning `undefined` here lets
          // Rollup auto-split each board into its own chunk; otherwise the
          // sweeping `feature-shift-productivity` rule below would collapse
          // every board back into the parent chunk and bust the bundle budget.
          if (
            id.includes(
              '/features/shift-productivity/production-boards/boards/'
            )
          )
            return undefined
          // Production-boards post composer (NEW 2026-05-17): the four boards
          // each `React.lazy()` import `post-composer-dialog.tsx`, but the
          // sweeping `feature-shift-productivity` rule below would otherwise
          // pull the composer + its sub-tree (attachments uploader, dnd-kit
          // wiring, per-kind sections, preview) into the parent chunk and
          // bust the 500 KB budget. Pin them to a named chunk so they form
          // one async-loaded ~100 KB bundle that's only fetched when a
          // curator clicks "New post" / the pencil.
          if (
            id.includes(
              '/features/shift-productivity/production-boards/components/post-composer-dialog'
            ) ||
            id.includes(
              '/features/shift-productivity/production-boards/components/composer/'
            )
          )
            return 'feature-production-boards-composer'
          // Production-boards bento grid (NEW 2026-05-17): the four
          // secondary boards lazy-import `<BentoBoardShell>` which pulls
          // in the bento grid + 5 variant cards + framer-motion gallery
          // crossfade. Carve into its own async chunk so the boards
          // tab itself stays light and `feature-shift-productivity`
          // doesn't grow past the 500 KB budget. Only fetched on first
          // navigation to one of the four content boards.
          if (
            id.includes(
              '/features/shift-productivity/production-boards/components/bento/'
            )
          )
            return 'feature-production-boards-bento'
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
          // OmniBelt site-wide chrome (P3) — host + default `skystrip`
          // skin + Panel + shared tool registry. Lives on every
          // authenticated page so a dedicated chunk avoids re-walking the
          // dep graph on each route entry. Per the documented manualChunks
          // rule above, we deliberately do NOT include react / radix /
          // tanstack / framer-motion / tabler-icons-react here — those
          // continue through the default chunker so the React top-level
          // dep chain stays intact.
          //
          // The `skystrip` skin is the store default
          // (`DEFAULT_PERSISTED_STATE.skin`) and is statically imported by
          // `OmniBeltHost.tsx` for a zero-latency first paint, so it
          // belongs IN this always-resident slice — a separate chunk would
          // just add a parallel request for bytes that always load anyway.
          // Only `orb` (and `pill`, via the default chunker) stay
          // lazy-loaded as their own chunk, fetched on first skin switch.
          if (id.includes('/features/omnibelt/skins/orb/'))
            return 'feature-omnibelt-skin-orb'
          if (id.includes('/features/omnibelt/')) {
            // Tool shells lazy-load on first open — keep them out of
            // the host chunk so the bundle budget tracks the always-
            // resident slice only.
            if (id.includes('/features/omnibelt/tools/shells/'))
              return undefined
            return 'feature-omnibelt'
          }

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

// Created and developed by Jai Singh
