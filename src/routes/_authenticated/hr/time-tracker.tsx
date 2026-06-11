// Created and developed by Jai Singh
import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { Skeleton } from '@/components/ui/skeleton'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

// Lazy load tab components
const TimecardDashboard = lazy(
  () => import('@/features/hr/time-tracker/components/timecard-dashboard')
)
const TimecardManagement = lazy(
  () => import('@/features/hr/time-tracker/components/timecard-management')
)
const ClockEntries = lazy(
  () => import('@/features/hr/time-tracker/components/clock-entries')
)
const TimeReports = lazy(
  () => import('@/features/hr/time-tracker/components/time-reports')
)
const TimeTrackerSettings = lazy(
  () => import('@/features/hr/time-tracker/components/time-tracker-settings')
)

const timeTrackerTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'timecard-management', label: 'Timecard Management' },
  { id: 'clock-entries', label: 'Clock Entries' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
]

function TabSkeleton() {
  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className='h-[100px] w-full rounded-lg' />
        ))}
      </div>
      <Skeleton className='h-[400px] w-full rounded-lg' />
    </div>
  )
}

function HRTimeTracker() {
  const [activeTab, setActiveTab] = useTabSearchParam('dashboard')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <TimecardDashboard />
          </Suspense>
        )
      case 'timecard-management':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <TimecardManagement />
          </Suspense>
        )
      case 'clock-entries':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ClockEntries />
          </Suspense>
        )
      case 'reports':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <TimeReports />
          </Suspense>
        )
      case 'settings':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <TimeTrackerSettings />
          </Suspense>
        )
      default:
        return (
          <Suspense fallback={<TabSkeleton />}>
            <TimecardDashboard />
          </Suspense>
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
            <h2 className='text-2xl font-bold tracking-tight'>Time Tracker</h2>
            <p className='text-muted-foreground'>
              Manage employee time tracking, timecards, and attendance records.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={timeTrackerTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='hr_time_tracker'
            fallbackTab='dashboard'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/hr/time-tracker')({
  component: HRTimeTracker,
})

// Created and developed by Jai Singh
