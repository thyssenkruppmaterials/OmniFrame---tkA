import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import GRSDataManager from '@/components/grs-data-manager'
import GRSDeliveryStatusManager from '@/components/grs-delivery-status-manager'
import GRSGRIPProcessingSearch from '@/components/grs-grip-processing-search'
import GRSInventoryManager from '@/components/grs-inventory-manager'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

// Loading component for lazy-loaded components
const ComponentLoading = ({ message }: { message: string }) => (
  <div className='flex flex-col items-center justify-center space-y-4 py-12'>
    <Loader2 className='text-primary h-8 w-8 animate-spin' />
    <p className='text-muted-foreground text-sm'>{message}</p>
  </div>
)

const grsTabs = [
  { id: 'overview', label: 'GRS Putaway Log' },
  { id: 'tracking', label: 'GRS Core Pulls' },
  { id: 'quality', label: 'GRS Inventory' },
  { id: 'grs-grip-processing', label: 'GRS GRIP Processing' },
  { id: 'delivery-status', label: 'GRS Delivery Status' },
  { id: 'data-manager', label: 'GRS Data Manager' },
]

/**
 * GRS Management Component
 *
 * Manages GRS (General Repair Services) operations including:
 * - Putaway Log
 * - Core Pulls
 * - Inventory Management
 * - GRIP Processing
 * - Delivery Status (shares rr_all_deliveries table with Outbound, filtered for GRS data)
 * - Data Manager (shares outbound_to_data table with Outbound, filtered for GRS data)
 *
 * Created: November 9, 2025
 */
export default function GrsManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  // GRS-specific filter configuration
  // TODO: Customize these filters based on actual GRS business requirements
  const grsDeliveryFilterConfig = {
    // Example: Filter by specific shipping points for GRS
    // shippingPoints: ['GRS1', 'GRS2'],
    // plants: ['GRS'],
    // warehouseNumbers: ['GRS-WH'],
    // excludeCustomers: ['Ship in Place - LiftFan JPO Depot'],
  }

  const grsDataFilterConfig = {
    // Example: Filter by specific plants or warehouses for GRS
    // plants: ['GRS'],
    // warehouseNumbers: ['GRS-WH'],
    // storageLocations: ['GRS-SL'],
    // materialTypes: ['GRS-'],
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>GRS Putaway Log</h3>
            <p className='text-muted-foreground'>
              Track and manage incoming inventory putaway operations and
              locations.
            </p>
          </div>
        )
      case 'tracking':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>GRS Core Pulls</h3>
            <p className='text-muted-foreground'>
              Manage core inventory pulls and retrieval operations.
            </p>
          </div>
        )
      case 'quality':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading GRS Inventory...' />}
          >
            <GRSInventoryManager enableRealtime={true} />
          </Suspense>
        )
      case 'grs-grip-processing':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading GRS GRIP Processing...' />
            }
          >
            <GRSGRIPProcessingSearch enableRealtime={true} />
          </Suspense>
        )
      case 'delivery-status':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading GRS Delivery Status...' />
            }
          >
            <GRSDeliveryStatusManager
              enableRealtime={true}
              filterConfig={grsDeliveryFilterConfig}
            />
          </Suspense>
        )
      case 'data-manager':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading GRS Data Manager...' />
            }
          >
            <GRSDataManager
              enableRealtime={true}
              filterConfig={grsDataFilterConfig}
            />
          </Suspense>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>GRS Putaway Log</h3>
            <p className='text-muted-foreground'>
              Track and manage incoming inventory putaway operations and
              locations.
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
            <h2 className='text-2xl font-bold tracking-tight'>GRS Apps</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={grsTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='grs_apps'
            fallbackTab='overview'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}
