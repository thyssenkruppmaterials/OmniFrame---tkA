// Created and developed by Jai Singh
import { useEffect } from 'react'
import { Outlet, useNavigate } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { rfPWAManager } from '@/lib/pwa/rf-pwa-manager'
import { PresenceProvider } from '@/context/presence-context'

/**
 * Standalone RF Interface Layout
 *
 * Auth validation is handled by the route's beforeLoad guard in
 * src/routes/rf-interface.tsx — by the time this component renders,
 * the session has already been verified. This layout only needs to
 * initialise PWA features and provide the visual shell.
 *
 * **Presence (added 2026-05-07).** RF tabs are no longer kiosk-opted
 * out (only `/rf-signin/` is — see `PRESENCE_KIOSK_ROUTE_PATTERNS`).
 * They participate in the org-wide presence map via
 * `<PresenceProvider>` so they (a) appear in `<LiveOperatorStatus>`
 * Tab 2 ("In Building") on the supervisor's Inventory Counts panel,
 * and (b) carry granular `rf_activity` telemetry surfaced by
 * `useRfPresenceActivity` inside `<RFInterface>`. The provider sits
 * between `RFLayout` and `<Outlet />` so RF children can
 * `usePresence()` if needed (today none do; left in place for
 * symmetry with the regular `<AuthenticatedLayout>` path). See
 * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
 */
export function RFLayout() {
  const { authState } = useUnifiedAuth()
  const { user, session } = authState
  const navigate = useNavigate()

  useEffect(() => {
    rfPWAManager.initializeRFPWA()
    return () => {
      rfPWAManager.cleanup()
    }
  }, [])

  // Safety net: if the session is lost while the user is on the page
  // (e.g. token refresh failure, sign-out from another tab), redirect.
  useEffect(() => {
    if (!user || !session) {
      navigate({ to: '/rf-signin' })
    }
  }, [user, session, navigate])

  if (!user || !session) {
    return (
      <div
        className='bg-background flex min-h-screen items-center justify-center'
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className='text-center'>
          <div className='border-primary mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2'></div>
          <p className='text-muted-foreground'>
            Authenticating RF Intelligence...
          </p>
        </div>
      </div>
    )
  }

  return (
    <PresenceProvider>
      <div className='bg-background min-h-screen'>
        <Outlet />
      </div>
    </PresenceProvider>
  )
}

// Created and developed by Jai Singh
