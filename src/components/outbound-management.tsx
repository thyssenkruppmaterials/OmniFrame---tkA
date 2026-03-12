import { Suspense, lazy, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { deliveryStatusService } from '@/lib/supabase/delivery-status.service'
import { OutboundTODataService } from '@/lib/supabase/outbound-to-data.service'
import { logger } from '@/lib/utils/logger'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

// Lazy load heavy components to improve tab switching performance
const PackToolForm = lazy(
  () => import('@/features/outbound/pack-tool/pack-tool-form')
)
const PutbackToolForm = lazy(
  () => import('@/features/outbound/putback-tool/putback-tool-form')
)
const FinalPackToolForm = lazy(
  () => import('@/features/outbound/final-pack-tool/final-pack-tool-form')
)
const ShippersToolForm = lazy(
  () => import('@/features/outbound/shippers-tool/shippers-tool-form')
)
const DeliveryStatusManager = lazy(
  () => import('@/components/delivery-status-manager')
)
const OutboundDataManager = lazy(
  () => import('@/components/outbound-data-manager')
)

// Loading component for lazy-loaded components
const ComponentLoading = ({ message }: { message: string }) => (
  <div className='flex flex-col items-center justify-center space-y-4 py-12'>
    <Loader2 className='text-primary h-8 w-8 animate-spin' />
    <p className='text-muted-foreground text-sm'>{message}</p>
  </div>
)

const outboundTabs = [
  { id: 'pack-tool', label: 'Pack Tool' },
  { id: 'putback-tool', label: 'Putback Tool' },
  { id: 'shippers-tool', label: 'Shippers Tool' },
  { id: 'final-pack-tool', label: 'Final Pack Tool' },
  { id: 'delivery-status', label: 'Delivery Status' },
  { id: 'data-manager', label: 'Data Manager' },
]

export default function OutboundManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('pack-tool')
  const queryClient = useQueryClient()
  const { authState } = useUnifiedAuth()
  const profile = authState.profile
  const service = OutboundTODataService.getInstance()
  const deliveryService = deliveryStatusService

  // Prefetch data for performance when component mounts
  useEffect(() => {
    if (!profile?.organization_id) return

    // Prefetch data manager and delivery status queries when the component loads
    // This ensures instant loading when user switches to these tabs
    const prefetchQueries = async () => {
      try {
        // Prefetch data manager queries
        await queryClient.prefetchQuery({
          queryKey: ['outbound-data', '', profile.organization_id],
          queryFn: () => service.fetchOutboundData(),
          staleTime: 5 * 60 * 1000,
        })

        await queryClient.prefetchQuery({
          queryKey: ['outbound-data-stats', profile.organization_id],
          queryFn: () => service.getStatistics(),
          staleTime: 10 * 60 * 1000,
        })

        // Prefetch delivery status queries (default: openOnly=true, includeDeleted=false)
        await queryClient.prefetchQuery({
          queryKey: [
            'delivery-status',
            '',
            true,
            false,
            profile.organization_id,
          ],
          queryFn: () =>
            deliveryService.fetchDeliveryStatusData(100000, 0, true, false),
          staleTime: 5 * 60 * 1000,
        })

        await queryClient.prefetchQuery({
          queryKey: ['delivery-status-stats', profile.organization_id],
          queryFn: () => deliveryService.getStatistics(),
          staleTime: 10 * 60 * 1000,
        })
      } catch (error) {
        // Silently fail prefetching - it's an optimization, not critical
        logger.debug('Prefetch failed:', error)
      }
    }

    // Delay prefetching slightly to not interfere with initial page load
    const timeoutId = setTimeout(prefetchQueries, 1000)

    return () => clearTimeout(timeoutId)
  }, [profile?.organization_id, queryClient, service, deliveryService])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'pack-tool':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Pack Tool...' />}
          >
            <PackToolForm />
          </Suspense>
        )
      case 'putback-tool':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Putback Tool...' />}
          >
            <PutbackToolForm />
          </Suspense>
        )
      case 'shippers-tool':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Shippers Tool...' />}
          >
            <ShippersToolForm />
          </Suspense>
        )
      case 'final-pack-tool':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Final Pack Tool...' />}
          >
            <FinalPackToolForm />
          </Suspense>
        )
      case 'delivery-status':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Delivery Status...' />}
          >
            <DeliveryStatusManager />
          </Suspense>
        )
      case 'data-manager':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Data Manager...' />}
          >
            <OutboundDataManager />
          </Suspense>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Pack Tool</h3>
            <p className='text-muted-foreground'>
              Manage packing operations and prepare shipments for delivery.
            </p>
          </div>
        )
    }
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Outbound Apps</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={outboundTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='outbound_apps'
            fallbackTab='pack-tool'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}
