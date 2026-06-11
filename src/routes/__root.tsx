// Created and developed by Jai Singh
import { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { SearchProvider } from '@/context/search-context'
import { ToastSettingsProvider } from '@/context/toast-settings-context'
import { Toaster } from '@/components/ui/sonner'
import { AppUpdateBanner } from '@/components/app-update-banner'
import { NavigationProgress } from '@/components/navigation-progress'
import GeneralError from '@/features/errors/general-error'
import NotFoundError from '@/features/errors/not-found-error'
import { OmniBeltHost } from '@/features/omnibelt'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: () => {
    return (
      <ToastSettingsProvider>
        <SearchProvider>
          <AppUpdateBanner />
          <NavigationProgress />
          <Outlet />
          {/* P3 — OmniBelt site-wide launcher. Mounted INSIDE
              <SearchProvider> so any tool shell can read the
              command-menu context, and as a sibling of <Outlet />
              so it survives route transitions. */}
          <OmniBeltHost />
          <Toaster />
          {import.meta.env.MODE === 'development' && (
            <>
              <ReactQueryDevtools buttonPosition='bottom-left' />
              <TanStackRouterDevtools position='bottom-right' />
            </>
          )}
        </SearchProvider>
      </ToastSettingsProvider>
    )
  },
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})

// Created and developed by Jai Singh
