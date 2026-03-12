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
// Developer and Creator: Jai Singh
