import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import ManualCountsSearch from '@/components/manual-counts-search'
import { ProfileDropdown } from '@/components/profile-dropdown'
import PutbackLogSearch from '@/components/putback-log-search'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const inventoryTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'putback-log', label: 'Putback Log Search' },
  { id: 'locations', label: 'Locations' },
  { id: 'manual-counts', label: 'Manual Counts' },
  { id: 'reports', label: 'Reports' },
]

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Inventory Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key inventory metrics and insights.
            </p>
          </div>
        )
      case 'putback-log':
        return <PutbackLogSearch enableRealtime={true} />
      case 'locations':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Warehouse Locations</h3>
            <p className='text-muted-foreground'>
              Manage warehouse locations, zones, and storage areas.
            </p>
          </div>
        )
      case 'manual-counts':
        return <ManualCountsSearch enableRealtime={true} />
      case 'reports':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Inventory Reports</h3>
            <p className='text-muted-foreground'>
              Generate reports and analytics for inventory management.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Inventory Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key inventory metrics and insights.
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
            <h2 className='text-2xl font-bold tracking-tight'>
              Inventory Management
            </h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={inventoryTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='inventory_apps'
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
