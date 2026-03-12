import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { TabMenu } from '@/components/ui/tab-menu'
import { AvailableOvertimeView } from '@/components/available-overtime-view'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { MyProductivityOverview } from '@/components/my-productivity-overview'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const myProductivityTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'time-tracking', label: 'Time Tracking' },
  { id: 'performance', label: 'Performance' },
  { id: 'analytics', label: 'Analytics' },
]

function MyProductivity() {
  const [activeTab, setActiveTab] = useState('dashboard')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <MyProductivityOverview />
      case 'overtime':
        return <AvailableOvertimeView />
      case 'time-tracking':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Time Tracking</h3>
            <p className='text-muted-foreground'>
              Monitor time spent on tasks, projects, and activities with
              detailed time allocation insights.
            </p>
          </div>
        )
      case 'performance':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Performance Metrics</h3>
            <p className='text-muted-foreground'>
              Analyze your work performance, efficiency trends, and productivity
              patterns over time.
            </p>
          </div>
        )
      case 'analytics':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Productivity Analytics</h3>
            <p className='text-muted-foreground'>
              Deep dive into productivity analytics, trends, and insights to
              optimize your work performance.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>My Productivity Dashboard</h3>
            <p className='text-muted-foreground'>
              Overview of your personal productivity metrics, goals progress,
              and daily performance insights.
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
              My Productivity
            </h2>
            <p className='text-muted-foreground'>
              Track and optimize your personal productivity and performance.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={myProductivityTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/apps/my-productivity')({
  beforeLoad: createStandardProtectedRoute('MY_PRODUCTIVITY'),
  component: MyProductivity,
})
// Developer and Creator: Jai Singh
