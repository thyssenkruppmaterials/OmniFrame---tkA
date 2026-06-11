// Created and developed by Jai Singh
import { Suspense, lazy, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import ManualCountsSearch from '@/components/manual-counts-search'
import { ProfileDropdown } from '@/components/profile-dropdown'
import PutbackLogSearch from '@/components/putback-log-search'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const WarehouseMapGate = lazy(
  () => import('@/components/warehouse-map/warehouse-map-gate')
)

const CountSettings = lazy(() => import('@/components/count-settings'))

const CubiScanWorkspace = lazy(
  () => import('@/components/cubiscan/cubiscan-workspace')
)

// Phase 0b — Operation Control command center.
const OperationControlPage = lazy(
  () => import('@/features/admin/operation-control/operation-control-page')
)

// 2026-05-10 — Work Queue Management dispatcher (multi-operator
// kanban-style supervisor view). Lives between Inventory Counts and
// Operation Control. RBAC seeded by migration
// 294_seed_work_queue_management_tab.sql; the tab is also visible
// to admin/superadmin without a seed because of the existing role
// bypass in `useTabPermissions`.
const WorkQueueManagementTab = lazy(
  () => import('@/components/work-queue-management')
)

const inventoryTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'putback-log', label: 'Putback Log Search' },
  { id: 'locations', label: 'Locations' },
  { id: 'manual-counts', label: 'Inventory Counts' },
  { id: 'work-queue-management', label: 'Work Queue Management' },
  { id: 'operation-control', label: 'Operation Control' },
  { id: 'cubiscan', label: 'CubiScan' },
  { id: 'reports', label: 'Reports' },
  { id: 'count-settings', label: 'Count Settings' },
]

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  // Warm the Locations tab's heavy chunks (map shell → 3D scene → three.js
  // vendor) while the browser is idle, so opening the tab doesn't pay the
  // multi-hundred-KB download+parse on click. No-op once cached.
  useEffect(() => {
    const prefetch = () => {
      void import('@/components/warehouse-map/warehouse-map-gate').then(
        () => import('@/components/warehouse-map/scene3d')
      )
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch)
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(prefetch, 2000)
    return () => clearTimeout(t)
  }, [])

  // Memoize tab content (Phase 8.5) so heavy components like ManualCountsSearch
  // and the Operation Control surface don't rebuild on every parent render.
  const tabContent = useMemo(() => {
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
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <WarehouseMapGate />
          </Suspense>
        )
      case 'manual-counts':
        return <ManualCountsSearch enableRealtime={true} />
      case 'work-queue-management':
        // Full-bleed dispatcher canvas — opted out of the bordered
        // <Card> wrapper below so the lanes get the full tab width.
        return (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <WorkQueueManagementTab />
          </Suspense>
        )
      case 'operation-control':
        // Full-width / full-height surface (per plan 0b.10), NOT inside the
        // generic <Card> wrapper.
        return (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <OperationControlPage />
          </Suspense>
        )
      case 'cubiscan':
        return (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <CubiScanWorkspace />
          </Suspense>
        )
      case 'reports':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Inventory Reports</h3>
            <p className='text-muted-foreground'>
              Generate reports and analytics for inventory management.
            </p>
          </div>
        )
      case 'count-settings':
        return (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <CountSettings />
          </Suspense>
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
  }, [activeTab])

  const renderTabContent = () => tabContent

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

          {activeTab === 'locations' ||
          activeTab === 'cubiscan' ||
          activeTab === 'operation-control' ||
          activeTab === 'work-queue-management' ? (
            renderTabContent()
          ) : (
            <div className='bg-background rounded-lg border p-6'>
              {renderTabContent()}
            </div>
          )}
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
