import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AssociatePerformanceDashboard } from '@/features/shift-productivity/associate-performance'
import { OvertimeManagementDashboard } from '@/features/shift-productivity/overtime-management'
import ShiftProductivitySettings from '@/features/shift-productivity/settings'
import { TeamPerformanceDashboard } from '@/features/shift-productivity/team-performance'
import { TimeAdjustmentApprovalsDashboard } from '@/features/shift-productivity/time-adjustment-approvals'

const shiftProductivityTabs = [
  { id: 'team-performance', label: 'Team Performance' },
  { id: 'associate-performance', label: 'Associate Performance' },
  { id: 'overtime-management', label: 'Overtime Management' },
  { id: 'time-adjustment-approvals', label: 'Time Adjustment Approvals' },
  { id: 'settings', label: 'Settings' },
]

function ShiftProductivity() {
  const [activeTab, setActiveTab] = useTabSearchParam('team-performance')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'team-performance':
        return <TeamPerformanceDashboard />
      case 'associate-performance':
        return <AssociatePerformanceDashboard />
      case 'overtime-management':
        return <OvertimeManagementDashboard />
      case 'time-adjustment-approvals':
        return <TimeAdjustmentApprovalsDashboard />
      case 'settings':
        return <ShiftProductivitySettings />
      default:
        return <TeamPerformanceDashboard />
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
              Shift Productivity
            </h2>
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

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
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
// Developer and Creator: Jai Singh
