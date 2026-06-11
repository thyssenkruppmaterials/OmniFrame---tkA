// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const maintenanceTabs = [
  { id: 'facility-ticket-tracking', label: 'Facility Ticket Tracking' },
  { id: 'building-maintenance', label: 'Building Maintenance' },
  { id: 'asset-management', label: 'Asset Management' },
  { id: 'vendor-management', label: 'Vendor Management' },
]

function FacilityMaintenance() {
  const [activeTab, setActiveTab] = useTabSearchParam(
    'facility-ticket-tracking'
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'facility-ticket-tracking':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Facility Ticket Tracking</h3>
            <p className='text-muted-foreground'>
              Track and manage facility-related tickets, work orders, and
              service requests.
            </p>
          </div>
        )
      case 'building-maintenance':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Building Maintenance</h3>
            <p className='text-muted-foreground'>
              Manage building maintenance schedules, inspections, and repair
              workflows.
            </p>
          </div>
        )
      case 'asset-management':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Asset Management</h3>
            <p className='text-muted-foreground'>
              Track facility assets, equipment lifecycle, and maintenance
              history.
            </p>
          </div>
        )
      case 'vendor-management':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Vendor Management</h3>
            <p className='text-muted-foreground'>
              Manage vendor relationships, contracts, and service agreements.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Facility Ticket Tracking</h3>
            <p className='text-muted-foreground'>
              Track and manage facility-related tickets, work orders, and
              service requests.
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
              Facility Maintenance
            </h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={maintenanceTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='facility_maintenance'
            fallbackTab='facility-ticket-tracking'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/facility/maintenance')({
  component: FacilityMaintenance,
})

// Created and developed by Jai Singh
