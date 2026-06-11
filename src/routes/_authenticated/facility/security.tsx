// Created and developed by Jai Singh
import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { IconVideo, IconIdBadge2, IconSettings } from '@tabler/icons-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { Skeleton } from '@/components/ui/skeleton'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

// Lazy load tabs for better performance
const CameraSystemTab = lazy(() =>
  import('@/features/camera-system').then((module) => ({
    default: module.CameraSystemTab,
  }))
)

const VisitorLogPanel = lazy(() =>
  import('@/features/visitor-log').then((module) => ({
    default: module.VisitorLogPanel,
  }))
)

const WeatherDashboard = lazy(() =>
  import('@/features/weather').then((module) => ({
    default: module.WeatherDashboard,
  }))
)

const securityTabs = [
  { id: 'visitor-tracking', label: 'Visitor Tracking' },
  { id: 'camera-system', label: 'Camera System' },
  { id: 'badge-access', label: 'Badge Access' },
  { id: 'weather', label: 'Weather' },
  { id: 'settings', label: 'Security Settings' },
]

function FacilitySecurity() {
  const [activeTab, setActiveTab] = useTabSearchParam('visitor-tracking')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'visitor-tracking':
        return (
          <Suspense
            fallback={
              <div className='space-y-4'>
                <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6'>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className='h-[88px] w-full rounded-lg' />
                  ))}
                </div>
                <Skeleton className='h-9 w-full max-w-sm rounded-lg' />
                <Skeleton className='h-[400px] w-full rounded-lg' />
              </div>
            }
          >
            <VisitorLogPanel />
          </Suspense>
        )
      case 'camera-system':
        return (
          <Suspense
            fallback={
              <div className='space-y-4'>
                <div className='flex items-center gap-2'>
                  <IconVideo className='text-muted-foreground h-5 w-5' />
                  <h3 className='text-lg font-semibold'>Camera System</h3>
                </div>
                <div className='grid min-h-[50vh] grid-cols-1 gap-4 lg:grid-cols-4'>
                  <div className='lg:col-span-1'>
                    <Skeleton className='h-full w-full rounded-lg' />
                  </div>
                  <div className='lg:col-span-3'>
                    <Skeleton className='h-full w-full rounded-lg' />
                  </div>
                </div>
              </div>
            }
          >
            <CameraSystemTab />
          </Suspense>
        )
      case 'badge-access':
        return (
          <div className='space-y-4'>
            <div className='flex items-center gap-2'>
              <IconIdBadge2 className='text-muted-foreground h-5 w-5' />
              <h3 className='text-lg font-semibold'>Badge Access</h3>
            </div>
            <div className='bg-muted/20 flex h-64 items-center justify-center rounded-lg border border-dashed'>
              <div className='space-y-2 text-center'>
                <p className='text-muted-foreground font-medium'>Coming Soon</p>
                <p className='text-muted-foreground text-sm'>
                  Manage access badges, door access logs, and access
                  permissions.
                </p>
              </div>
            </div>
          </div>
        )
      case 'weather':
        return (
          <Suspense
            fallback={
              <div className='flex min-h-[50vh] items-center justify-center rounded-xl bg-slate-900/50'>
                <div className='flex flex-col items-center gap-3'>
                  <div className='h-8 w-8 animate-spin rounded-full border-2 border-blue-400/20 border-t-blue-400' />
                  <p className='text-sm text-white/40'>Loading weather...</p>
                </div>
              </div>
            }
          >
            <WeatherDashboard />
          </Suspense>
        )
      case 'settings':
        return (
          <div className='space-y-4'>
            <div className='flex items-center gap-2'>
              <IconSettings className='text-muted-foreground h-5 w-5' />
              <h3 className='text-lg font-semibold'>Security Settings</h3>
            </div>
            <div className='bg-muted/20 flex h-64 items-center justify-center rounded-lg border border-dashed'>
              <div className='space-y-2 text-center'>
                <p className='text-muted-foreground font-medium'>Coming Soon</p>
                <p className='text-muted-foreground text-sm'>
                  Configure security policies, alerts, and system settings.
                </p>
              </div>
            </div>
          </div>
        )
      default:
        return (
          <Suspense
            fallback={
              <div className='space-y-4'>
                <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6'>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className='h-[88px] w-full rounded-lg' />
                  ))}
                </div>
                <Skeleton className='h-9 w-full max-w-sm rounded-lg' />
                <Skeleton className='h-[400px] w-full rounded-lg' />
              </div>
            }
          >
            <VisitorLogPanel />
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
            <h2 className='text-2xl font-bold tracking-tight'>
              Facility Security
            </h2>
            <p className='text-muted-foreground'>
              Manage building security, access control, and surveillance
              systems.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={securityTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='facility_security'
            fallbackTab='visitor-tracking'
          />

          {/* Visitor tracking & camera system have their own layouts */}
          <div
            className={
              activeTab === 'camera-system' ||
              activeTab === 'visitor-tracking' ||
              activeTab === 'weather'
                ? ''
                : 'bg-background rounded-lg border p-6'
            }
          >
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/facility/security')({
  component: FacilitySecurity,
})

// Created and developed by Jai Singh
