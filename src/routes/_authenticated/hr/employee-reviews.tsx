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
const ReviewsDashboard = lazy(
  () => import('@/features/hr/employee-reviews/components/reviews-dashboard')
)
const ActiveReviews = lazy(
  () => import('@/features/hr/employee-reviews/components/active-reviews')
)
const ReviewHistory = lazy(
  () => import('@/features/hr/employee-reviews/components/review-history')
)
const ReviewTemplates = lazy(
  () => import('@/features/hr/employee-reviews/components/review-templates')
)
const ReviewSettings = lazy(
  () => import('@/features/hr/employee-reviews/components/review-settings')
)

const reviewTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'active-reviews', label: 'Active Reviews' },
  { id: 'review-history', label: 'Review History' },
  { id: 'templates', label: 'Templates' },
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

function HREmployeeReviews() {
  const [activeTab, setActiveTab] = useTabSearchParam('dashboard')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ReviewsDashboard />
          </Suspense>
        )
      case 'active-reviews':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ActiveReviews />
          </Suspense>
        )
      case 'review-history':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ReviewHistory />
          </Suspense>
        )
      case 'templates':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ReviewTemplates />
          </Suspense>
        )
      case 'settings':
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ReviewSettings />
          </Suspense>
        )
      default:
        return (
          <Suspense fallback={<TabSkeleton />}>
            <ReviewsDashboard />
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
              Employee Reviews
            </h2>
            <p className='text-muted-foreground'>
              Manage performance reviews, evaluation cycles, and employee
              feedback.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={reviewTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='hr_employee_reviews'
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

export const Route = createFileRoute('/_authenticated/hr/employee-reviews')({
  component: HREmployeeReviews,
})
// Developer and Creator: Jai Singh
