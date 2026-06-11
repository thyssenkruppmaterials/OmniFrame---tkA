// Created and developed by Jai Singh
/**
 * Canonical app base URL for Supabase auth redirect URLs.
 *
 * Priority:
 *   1. VITE_APP_URL env variable (should be set in production builds)
 *   2. window.location.origin (correct when served from the production domain)
 *
 * Supabase requires redirect URLs to be allow-listed in the dashboard
 * under Authentication > URL Configuration > Redirect URLs.
 */
export function getAppUrl(): string {
  const envUrl = import.meta.env.VITE_APP_URL as string | undefined
  if (envUrl) return envUrl.replace(/\/+$/, '')

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return 'http://localhost:5173'
}

// Created and developed by Jai Singh
