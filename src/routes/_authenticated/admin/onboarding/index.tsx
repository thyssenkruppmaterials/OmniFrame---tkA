// Created and developed by Jai Singh
/**
 * Employee Onboarding Route
 * /admin/onboarding
 *
 * SECURITY: Protected by route-level permission check
 * Requires 'manage' permission on 'users' resource
 */
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  OnboardingProvider,
  OnboardingWizard,
} from '@/features/admin/onboarding'

export const Route = createFileRoute('/_authenticated/admin/onboarding/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/onboarding',
    resourcePermission: { action: 'manage', resource: 'users' },
    forbiddenRedirect: '/403',
    enableDebug: true,
  }),
  component: OnboardingPage,
})

function OnboardingPage() {
  return (
    <OnboardingProvider>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <OnboardingWizard />
      </Main>
    </OnboardingProvider>
  )
}

export default OnboardingPage

// Created and developed by Jai Singh
