// Created and developed by Jai Singh
/**
 * Standard Work Page
 * Enterprise-grade standard work management with modern tab navigation
 * Updated: February 8, 2026 - Complete UI redesign for enterprise-grade experience
 */
import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const StandardWorkChecklist = lazy(
  () => import('@/features/standard-work/components/standard-work-checklist')
)
const StandardWorkSettings = lazy(
  () => import('@/features/standard-work/components/standard-work-settings')
)

const ComponentLoading = ({ message }: { message: string }) => (
  <div className='flex flex-col items-center justify-center space-y-4 py-16'>
    <div className='relative'>
      <div className='bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl'>
        <Loader2 className='text-primary h-6 w-6 animate-spin' />
      </div>
    </div>
    <p className='text-muted-foreground text-sm font-medium'>{message}</p>
  </div>
)

const standardWorkTabs = [
  { id: 'checklist', label: 'Checklist Dashboard' },
  { id: 'settings', label: 'Templates & Settings' },
]

function StandardWork() {
  const [activeTab, setActiveTab] = useTabSearchParam('checklist')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'settings':
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Templates & Settings...' />
            }
          >
            <StandardWorkSettings />
          </Suspense>
        )
      default:
        return (
          <Suspense
            fallback={
              <ComponentLoading message='Loading Checklist Dashboard...' />
            }
          >
            <StandardWorkChecklist />
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
            <div className='bg-primary/10 flex h-10 w-10 items-center justify-center rounded-xl'>
              <ClipboardCheck className='text-primary h-5 w-5' />
            </div>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>
                Standard Work
              </h2>
              <p className='text-muted-foreground text-sm'>
                Manage and complete standard work checklists for operational
                consistency
              </p>
            </div>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={standardWorkTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='standard_work_apps'
            fallbackTab='checklist'
          />

          <div>{renderTabContent()}</div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/apps/standard-work')({
  beforeLoad: createStandardProtectedRoute('STANDARD_WORK'),
  component: StandardWork,
})

// Created and developed by Jai Singh
