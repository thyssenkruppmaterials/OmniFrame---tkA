// Created and developed by Jai Singh
import Cookies from 'js-cookie'
import { Outlet } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { PresenceProvider } from '@/context/presence-context'
import { useIdleRecovery } from '@/hooks/use-idle-recovery'
import { useRouteTracker } from '@/hooks/use-route-tracker'
import { useSessionTimeout } from '@/hooks/use-session-timeout'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { SessionExpiryModal } from '@/components/auth/session-expiry-modal'
import { AppBreadcrumbs } from '@/components/layout/breadcrumbs'
import { CommandPalette } from '@/components/layout/command-palette'
import { OptimizedAppSidebar } from '@/components/layout/optimized-app-sidebar'
import { NotificationsPanel } from '@/components/notifications/notifications-panel'
import SkipToMain from '@/components/skip-to-main'
import { ClaimBlockedRibbon } from '@/components/work-distribution/claim-blocked-ribbon'

interface Props {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: Props) {
  const defaultOpen = Cookies.get('sidebar_state') !== 'false'

  // Track last-visited page for post-login restoration
  useRouteTracker()

  // Initialize idle recovery system to handle tab switching gracefully
  useIdleRecovery({
    idleThreshold: 3 * 60 * 1000, // 3 minutes idle threshold
    recoveryDelay: 1000, // 1 second recovery delay
    enableRecovery: true,
  })

  // Initialize session timeout system for automatic logout
  const { showWarning, timeRemaining, extendSession, handleLogout } =
    useSessionTimeout({
      enableWarnings: true,
      onWarning: (remaining) => {
        logger.log(`Session warning: ${remaining} seconds remaining`)
      },
      onTimeout: () => {
        logger.log('Session timeout - user will be logged out')
      },
      onLogout: () => {
        logger.log('User logged out due to timeout')
      },
    })

  return (
    <ProtectedRoute>
      <PresenceProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SkipToMain />
          <OptimizedAppSidebar />
          <div
            id='content'
            className={cn(
              'ml-auto w-full max-w-full min-w-0',
              'peer-data-[state=collapsed]:w-[calc(100%-var(--sidebar-width-icon)-1rem)]',
              'peer-data-[state=expanded]:w-[calc(100%-var(--sidebar-width))]',
              'sm:transition-[width] sm:duration-200 sm:ease-linear',
              'flex h-svh flex-col overflow-x-clip',
              'group-data-[scroll-locked=1]/body:h-full',
              'has-[main.fixed-main]:group-data-[scroll-locked=1]/body:h-svh'
            )}
          >
            {/*
             * Tier 2 #2 — top action bar. Currently just hosts the
             * NotificationsPanel bell, but kept as its own row so
             * future top-right actions (search shortcut, presence
             * count, etc.) can land alongside without restructuring
             * the layout. Sits above the breadcrumbs so it's a
             * stable anchor across routes that don't render
             * breadcrumbs at all (e.g. `/`).
             */}
            <div className='flex items-center justify-end px-4 pt-2'>
              <NotificationsPanel />
            </div>
            {/*
             * T-3 (2026-05-18) admin-only persistent ribbon — surfaces when
             * `claim_next_task` returns None while real work exists for the
             * org (the zone-mutual-exclusion cascade class).
             * Gated by `inventory_apps:view`; renders nothing for
             * non-admins. See
             * `Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`.
             */}
            <ClaimBlockedRibbon />
            <AppBreadcrumbs />
            {children ? children : <Outlet />}
          </div>

          {/* Command palette (Ctrl+K / Cmd+K) */}
          <CommandPalette />

          {/* Session expiry warning modal */}
          <SessionExpiryModal
            open={showWarning}
            timeRemaining={timeRemaining ?? 0}
            onExtend={extendSession}
            onLogout={handleLogout}
          />
        </SidebarProvider>
      </PresenceProvider>
    </ProtectedRoute>
  )
}

// Created and developed by Jai Singh
