import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

// Lazy load data manager component for better performance
const KittingDataManager = lazy(
  () => import('@/components/kitting-data-manager')
)
// Lazy load kanban board component for better performance
const KitKanbanBoard = lazy(() =>
  import('@/components/kitting/kit-kanban-board').then((module) => ({
    default: module.KitKanbanBoard,
  }))
)
// Lazy load build kit form component for better performance
const BuildKitForm = lazy(() => import('@/components/kitting/build-kit-form'))
// Lazy load inspect kit form component for better performance
const InspectKitForm = lazy(
  () => import('@/components/kitting/inspect-kit-form')
)
// Lazy load kit cart viewer component (Nefab PFC Trace integration)
const KitCartViewer = lazy(() => import('@/components/kit-cart-viewer'))
// Lazy load BOM settings component
const KitBomSettings = lazy(() =>
  import('@/components/kitting/kit-bom-settings').then((module) => ({
    default: module.KitBomSettings,
  }))
)

// Loading component for lazy-loaded components
const ComponentLoading = ({ message }: { message: string }) => (
  <div className='flex flex-col items-center justify-center space-y-4 py-12'>
    <Loader2 className='text-primary h-8 w-8 animate-spin' />
    <p className='text-muted-foreground text-sm'>{message}</p>
  </div>
)

const kittingTabs = [
  { id: 'kits', label: 'Kit Assembly Board' },
  { id: 'components', label: 'Build Kit' },
  { id: 'reports', label: 'Inspect Kit' },
  { id: 'kitting-data-manager', label: 'Kitting Data Manager' },
  { id: 'kit-cart-viewer', label: 'Kit Cart Viewer' },
  { id: 'settings', label: 'Settings' },
]

export default function KittingManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('kits')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'kits':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Kit Kanban Board...' />
            }
          >
            <KitKanbanBoard />
          </Suspense>
        )
      case 'components':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Build Kit Tool...' />}
          >
            <BuildKitForm />
          </Suspense>
        )
      case 'reports':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Inspect Kit Tool...' />
            }
          >
            <InspectKitForm />
          </Suspense>
        )
      case 'settings':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Kitting Settings...' />
            }
          >
            <KitBomSettings />
          </Suspense>
        )
      case 'kitting-data-manager':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Kitting Data Manager...' />
            }
          >
            <KittingDataManager />
          </Suspense>
        )
      case 'kit-cart-viewer':
        return (
          <Suspense
            fallback={<ComponentLoading message='Loading Kit Cart Viewer...' />}
          >
            <KitCartViewer enablePolling={true} pollingInterval={180000} />
          </Suspense>
        )
      default:
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Kit Kanban Board...' />
            }
          >
            <KitKanbanBoard />
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
            <h2 className='text-2xl font-bold tracking-tight'>Kitting Apps</h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={kittingTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='kitting_apps'
            fallbackTab='kits'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}
