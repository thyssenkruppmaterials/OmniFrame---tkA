import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import LX03DataManager from '@/components/lx03-data-manager'
import MaterialMasterDataManager from '@/components/material-master-data-manager'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import SQ01DataManager from '@/components/sq01-data-manager'
import { ThemeSwitch } from '@/components/theme-switch'

const dataTabs = [
  { id: 'overview', label: 'LX03 Data Manager' },
  { id: 'batch-tracking', label: 'GRS SQ01 Data Manager' },
  { id: 'quality-control', label: 'Material Master Data Manager' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
]

export default function DataManager() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className='space-y-4'>
            <LX03DataManager enableRealtime={true} />
          </div>
        )
      case 'batch-tracking':
        return (
          <div className='space-y-4'>
            <SQ01DataManager enableRealtime={true} />
          </div>
        )
      case 'quality-control':
        return (
          <div className='space-y-4'>
            <MaterialMasterDataManager enableRealtime={true} />
          </div>
        )
      case 'reports':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Data Reports</h3>
            <p className='text-muted-foreground'>
              Generate reports and analytics for batch data and quality metrics.
            </p>
          </div>
        )
      case 'settings':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Data Settings</h3>
            <p className='text-muted-foreground'>
              Configure batch parameters, quality thresholds, and system
              preferences.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <LX03DataManager enableRealtime={true} />
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
            <h2 className='text-2xl font-bold tracking-tight'>Data Manager</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={dataTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='data_manager'
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
