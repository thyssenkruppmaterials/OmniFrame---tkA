import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { samplePermissions } from '../roles/data/data'
import { permissionListSchema } from '../roles/data/schema'
import { columns } from './components/permissions-columns'
import { PermissionsDialogs } from './components/permissions-dialogs'
import { PermissionsPrimaryButtons } from './components/permissions-primary-buttons'
import { PermissionsTable } from './components/permissions-table'
import PermissionsProvider from './context/permissions-context'

export default function PermissionManagement() {
  // Parse permission list
  const permissionList = permissionListSchema.parse(samplePermissions)

  return (
    <PermissionsProvider>
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
              Permission Management
            </h2>
            <p className='text-muted-foreground'>
              Manage system permissions and access controls. Define what actions
              users can perform on specific resources.
            </p>
          </div>
          <PermissionGuard resource='permissions' action='read'>
            <PermissionsPrimaryButtons />
          </PermissionGuard>
        </div>
        <div className='-mx-4 flex-1 overflow-auto px-4 py-1 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <PermissionsTable data={permissionList} columns={columns} />
        </div>
      </Main>

      <PermissionsDialogs />
    </PermissionsProvider>
  )
}
