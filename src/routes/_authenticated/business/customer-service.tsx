import { createFileRoute } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

function BusinessCustomerService() {
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
              Customer Service
            </h2>
            <p className='text-muted-foreground'>
              Customer support operations and service management.
            </p>
          </div>
        </div>

        <div className='flex h-96 items-center justify-center rounded-lg border'>
          <div className='space-y-4 text-center'>
            <h3 className='text-muted-foreground text-lg font-semibold'>
              Coming Soon
            </h3>
            <p className='text-muted-foreground text-sm'>
              Customer service features are under development.
            </p>
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute(
  '/_authenticated/business/customer-service'
)({
  component: BusinessCustomerService,
})
// Developer and Creator: Jai Singh
