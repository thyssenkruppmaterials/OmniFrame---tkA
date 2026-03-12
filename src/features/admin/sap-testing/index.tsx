import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfirmTOTab } from './components/confirm-to-tab'
// Tab Components
import { ConnectionTestTab } from './components/connection-test-tab'
import { CreateTOTab } from './components/create-to-tab'
import { GoodsReceiptTab } from './components/goods-receipt-tab'
import { OpenTOsTab } from './components/open-tos-tab'
import { WarehouseDataTab } from './components/warehouse-data-tab'

const SAP_TESTING_TABS = [
  { id: 'connection-test', label: 'Connection Test' },
  { id: 'goods-receipt', label: 'Goods Receipt (MIGO)' },
  { id: 'create-to', label: 'Create TO' },
  { id: 'confirm-to', label: 'Confirm TO' },
  { id: 'open-tos', label: 'Open TOs' },
  { id: 'warehouse-data', label: 'Warehouse Data' },
]

/**
 * SAP Testing Page - Admin-only SAP RFC integration testing and operations
 * Supports both ECC (Classic WM) and S/4 HANA (EWM) systems
 */
export function SAPTestingPage() {
  const [activeTab, setActiveTab] = useTabSearchParam('connection-test')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'connection-test':
        return <ConnectionTestTab />
      case 'goods-receipt':
        return <GoodsReceiptTab />
      case 'create-to':
        return <CreateTOTab />
      case 'confirm-to':
        return <ConfirmTOTab />
      case 'open-tos':
        return <OpenTOsTab />
      case 'warehouse-data':
        return <WarehouseDataTab />
      default:
        return <ConnectionTestTab />
    }
  }

  return (
    <>
      {/* Header */}
      <header className='bg-background sticky top-0 z-10 flex h-16 items-center gap-1 border-b px-4'>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </header>

      {/* Main Content */}
      <main className='flex-1 space-y-6 p-6'>
        <div className='space-y-2'>
          <h2 className='text-2xl font-bold tracking-tight'>SAP Testing</h2>
          <p className='text-muted-foreground'>
            SAP RFC integration testing for ECC (Classic WM) and S/4 HANA (EWM)
            systems
          </p>
        </div>

        {/* Tab Menu */}
        <div className='border-b'>
          <TabMenu
            tabs={SAP_TESTING_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='sap_testing'
            showHiddenTabs={true} // Admin page - show all tabs
          />
        </div>

        {/* Tab Content */}
        <div className='mt-6'>{renderTabContent()}</div>
      </main>
    </>
  )
}
