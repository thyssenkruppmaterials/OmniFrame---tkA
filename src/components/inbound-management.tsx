import React, { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { useTabPermissions } from '@/hooks/useTabPermissions'
import { TabMenu } from '@/components/ui/tab-menu'
import GRIPProcessingSearch from '@/components/grip-processing-search'
import InboundReports from '@/components/inbound-reports'
import InboundScanSearch from '@/components/inbound-scan-search'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import PutawayLogSearch from '@/components/putaway-log-search'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const InboundStowToCart = React.lazy(
  () => import('@/components/inbound-stow-to-cart')
)
const InboundCartManagement = React.lazy(
  () => import('@/components/inbound-cart-management')
)

const inboundTabs = [
  { id: 'inbound-scan-search', label: 'Inbound Scan Search' },
  { id: 'stow-to-cart', label: 'Stow To Cart' },
  { id: 'cart-management', label: 'Cart Management' },
  { id: 'receiving', label: 'Putaway Log Search' },
  { id: 'processing', label: 'GRIP Processing' },
  { id: 'quality-check', label: 'Supplier Check' },
  { id: 'reports', label: 'Reports' },
]

const TabFallback = () => (
  <div className='flex items-center justify-center py-12'>
    <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
  </div>
)

export default function InboundManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('inbound-scan-search')
  const { hasTabAccess } = useTabPermissions('inbound_apps')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'inbound-scan-search':
        return <InboundScanSearch enableRealtime={true} />
      case 'stow-to-cart':
        return hasTabAccess('stow-to-cart') ? (
          <Suspense fallback={<TabFallback />}>
            <InboundStowToCart />
          </Suspense>
        ) : null
      case 'cart-management':
        return hasTabAccess('cart-management') ? (
          <Suspense fallback={<TabFallback />}>
            <InboundCartManagement />
          </Suspense>
        ) : null
      case 'receiving':
        return <PutawayLogSearch enableRealtime={true} />
      case 'processing':
        return <GRIPProcessingSearch enableRealtime={true} />
      case 'quality-check':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Supplier Check</h3>
            <p className='text-muted-foreground'>
              Perform supplier quality inspections on inbound items.
            </p>
          </div>
        )
      case 'reports':
        return <InboundReports enableRealtime={false} />
      default:
        return <InboundScanSearch enableRealtime={true} />
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
            <h2 className='text-2xl font-bold tracking-tight'>Inbound Apps</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={inboundTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='inbound_apps'
            fallbackTab='inbound-scan-search'
          />

          <div>{renderTabContent()}</div>
        </div>
      </Main>
    </>
  )
}
