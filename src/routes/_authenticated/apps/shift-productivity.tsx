// Created and developed by Jai Singh
import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Gauge, Loader2 } from 'lucide-react'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const TeamPerformanceDashboard = lazy(() =>
  import('@/features/shift-productivity/team-performance').then((module) => ({
    default: module.TeamPerformanceDashboard,
  }))
)
const AssociatePerformanceDashboard = lazy(() =>
  import('@/features/shift-productivity/associate-performance').then(
    (module) => ({
      default: module.AssociatePerformanceDashboard,
    })
  )
)
const OvertimeManagementDashboard = lazy(() =>
  import('@/features/shift-productivity/overtime-management').then(
    (module) => ({
      default: module.OvertimeManagementDashboard,
    })
  )
)
const TimeAdjustmentApprovalsDashboard = lazy(() =>
  import('@/features/shift-productivity/time-adjustment-approvals').then(
    (module) => ({
      default: module.TimeAdjustmentApprovalsDashboard,
    })
  )
)
const ShiftProductivitySettings = lazy(
  () => import('@/features/shift-productivity/settings')
)

const shiftProductivityTabs = [
  { id: 'team-performance', label: 'Team Performance' },
  { id: 'associate-performance', label: 'Associate Performance' },
  { id: 'overtime-management', label: 'Overtime Management' },
  { id: 'time-adjustment-approvals', label: 'Time Adjustment Approvals' },
  { id: 'settings', label: 'Settings' },
]

const ComponentLoading = ({ message }: { message: string }) => (
  <div className='flex flex-col items-center justify-center gap-4 py-16'>
    <div className='bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl'>
      <Loader2 className='size-6 animate-spin' />
    </div>
    <p className='text-muted-foreground text-sm font-medium'>{message}</p>
  </div>
)

function ShiftProductivity() {
  const [activeTab, setActiveTab] = useTabSearchParam('team-performance')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'team-performance':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading team performance...' />
            }
          >
            <TeamPerformanceDashboard />
          </Suspense>
        )
      case 'associate-performance':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading associate performance...' />
            }
          >
            <AssociatePerformanceDashboard />
          </Suspense>
        )
      case 'overtime-management':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading overtime management...' />
            }
          >
            <OvertimeManagementDashboard />
          </Suspense>
        )
      case 'time-adjustment-approvals':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading time adjustment approvals...' />
            }
          >
            <TimeAdjustmentApprovalsDashboard />
          </Suspense>
        )
      case 'settings':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading settings...' />}
          >
            <ShiftProductivitySettings />
          </Suspense>
        )
      default:
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading team performance...' />
            }
          >
            <TeamPerformanceDashboard />
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
        <div className='mb-4 flex flex-wrap items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <div className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl'>
              <Gauge className='size-5' />
            </div>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>
                Shift Productivity
              </h2>
              <p className='text-muted-foreground text-sm'>
                Monitor labor performance, manage coverage, and configure the
                operating model that powers shift execution.
              </p>
            </div>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={shiftProductivityTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='shift_productivity'
            fallbackTab='team-performance'
          />

          <div>{renderTabContent()}</div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/apps/shift-productivity')(
  {
    beforeLoad: createStandardProtectedRoute('SHIFT_PRODUCTIVITY'),
    component: ShiftProductivity,
  }
)

// Created and developed by Jai Singh
