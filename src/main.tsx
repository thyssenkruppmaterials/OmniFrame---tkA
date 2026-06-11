// Created and developed by Jai Singh
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { Capacitor } from '@capacitor/core'
import { toast } from 'sonner'
import { redirectToSignIn } from '@/lib/auth/redirect-utils'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { UnifiedAuthProvider } from '@/lib/auth/unified-auth-provider'
import { initSentry } from '@/lib/observability/sentry'
import { rfPWAManager } from '@/lib/pwa/rf-pwa-manager'
import { timeclockPWAManager } from '@/lib/pwa/timeclock-pwa-manager'
import { logger } from '@/lib/utils/logger'
import { autoUpdater } from '@/lib/version/auto-updater'
import { versionChecker } from '@/lib/version/version-checker'
import { handleServerError } from '@/utils/handle-server-error'
import { FontProvider } from './context/font-context'
import { ThemeProvider } from './context/theme-context'
import './index.css'
// Generated Routes
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (import.meta.env.DEV) logger.log({ failureCount, error })

        // Reduce retries to prevent performance issues
        if (failureCount >= 1 && import.meta.env.DEV) return false
        if (failureCount > 2 && import.meta.env.PROD) return false

        return !(
          error instanceof AxiosError &&
          [401, 403, 404].includes(error.response?.status ?? 0)
        )
      },
      refetchOnWindowFocus: false, // Disable to prevent performance issues on tab switching
      refetchOnReconnect: false, // Disable to prevent cascade refetches
      staleTime: 5 * 60 * 1000, // 5 minutes - much longer stale time
      gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)

        if (error instanceof AxiosError) {
          if (error.response?.status === 304) {
            toast.error('Content not modified!')
          }
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401) {
          // Try to refresh session before logging out
          singletonAuthManager
            .refreshSession()
            .then((refreshed) => {
              if (!refreshed) {
                toast.error('Session expired!')
                setTimeout(() => {
                  singletonAuthManager.signOut()
                  redirectToSignIn()
                }, 0)
              }
            })
            .catch(() => {
              // Refresh failed, logout
              toast.error('Session expired!')
              setTimeout(() => {
                singletonAuthManager.signOut()
                redirectToSignIn()
              }, 0)
            })
        }
        if (error.response?.status === 500) {
          toast.error('Internal Server Error!')
          setTimeout(() => {
            // Defer navigation until router is ready
            if (typeof window !== 'undefined') {
              window.location.href = '/500'
            }
          }, 0)
        }
        if (error.response?.status === 403) {
          // Handle forbidden errors without navigation to prevent conflicts
          toast.error('Access forbidden!')
        }
      }
    },
  }),
})

// Create a new router instance with optimized settings
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: false, // Disable aggressive preloading to reduce performance overhead
  defaultPreloadStaleTime: 30000, // 30 seconds preload cache
  defaultPreloadDelay: 500, // Delay preloading to prevent rapid-fire requests
})

// ---------------------------------------------------------------------------
// Item 15 — Sentry init shim. No-op when VITE_SENTRY_DSN is unset, so the
// build stays clean in environments without observability wired. Must run
// before React mounts so the WorkflowErrorBoundary's
// `window.__OMNI_SENTRY_CAPTURE` lookup resolves on the first render.
// ---------------------------------------------------------------------------
initSentry()

// ---------------------------------------------------------------------------
// Initialize Auto-Update System (before React renders)
// VersionChecker polls /build-info.json for new deployments.
// AutoUpdater coordinates graceful reloads based on user activity.
// Both services self-guard against dev mode and Capacitor native.
// ---------------------------------------------------------------------------
versionChecker.start()
autoUpdater.start()

// Handle PWA route changes globally
if (typeof window !== 'undefined') {
  // Detect if running in Capacitor (native iOS/Android app)
  const isNativeApp = Capacitor.isNativePlatform()

  // If running in native app, redirect to RF Interface
  if (
    isNativeApp &&
    (window.location.pathname === '/' ||
      window.location.pathname === '/sign-in')
  ) {
    logger.log(
      '🚀 Running in Capacitor native app - redirecting to RF Interface'
    )
    window.location.href = '/rf-signin'
  }

  // Enforce PWA scope on initial load if in standalone mode
  rfPWAManager.enforceRFScope()
  timeclockPWAManager.enforceTimeclockScope()

  // Listen for navigation changes using native browser API
  let currentPath = window.location.pathname

  const handleRouteChange = () => {
    const newPath = window.location.pathname
    if (currentPath !== newPath) {
      currentPath = newPath
      rfPWAManager.handleRouteChange()
      rfPWAManager.enforceRFScope()
      timeclockPWAManager.handleRouteChange()
      timeclockPWAManager.enforceTimeclockScope()
    }
  }

  // Listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', handleRouteChange)

  // Also listen for pushstate/replacestate (programmatic navigation)
  const originalPushState = window.history.pushState
  const originalReplaceState = window.history.replaceState

  window.history.pushState = function (...args) {
    originalPushState.apply(this, args)
    setTimeout(handleRouteChange, 0)
  }

  window.history.replaceState = function (...args) {
    originalReplaceState.apply(this, args)
    setTimeout(handleRouteChange, 0)
  }
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
const root = ReactDOM.createRoot(rootElement)
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FontProvider>
          <UnifiedAuthProvider
            enableDevTools={import.meta.env.DEV}
            onAuthChange={(state) => {
              logger.log('Auth state changed:', state.isAuthenticated)
            }}
            onError={(error) => {
              logger.error('Auth error:', error)
              toast.error(error.message)
            }}
          >
            <RouterProvider router={router} />
          </UnifiedAuthProvider>
        </FontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)

// Created and developed by Jai Singh
