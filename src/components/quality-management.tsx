// Created and developed by Jai Singh
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const qualityTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'settings', label: 'Settings' },
  { id: 'reports', label: 'Reports' },
]

export default function QualityManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key quality metrics and insights.
            </p>
          </div>
        )
      case 'inspections':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Inspections</h3>
            <p className='text-muted-foreground'>
              Manage quality inspections and inspection schedules.
            </p>
          </div>
        )
      case 'certificates':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Certificates</h3>
            <p className='text-muted-foreground'>
              Manage quality certificates and documentation.
            </p>
          </div>
        )
      case 'settings':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Settings</h3>
            <p className='text-muted-foreground'>
              Configure quality settings and preferences.
            </p>
          </div>
        )
      case 'reports':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Reports</h3>
            <p className='text-muted-foreground'>
              Generate reports and analytics for quality management.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Quality Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key quality metrics and insights.
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
            <h2 className='text-2xl font-bold tracking-tight'>Quality Apps</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={qualityTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='quality_apps'
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

// Created and developed by Jai Singh
