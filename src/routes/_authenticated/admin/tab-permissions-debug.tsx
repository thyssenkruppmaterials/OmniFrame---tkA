// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissionStore } from '@/stores/permissionStore'
import { useSupabaseAuth } from '@/stores/supabaseAuthStore'
import { rbacService } from '@/lib/auth/rbac-service'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

function TabPermissionsDebug() {
  const { profile } = useSupabaseAuth()
  const { tabPermissions, hasTabPermission } = usePermissionStore()
  const [testUserId, setTestUserId] = useState('testerasdasdasd@icloud.com')
  const [testPageResource, setTestPageResource] = useState('inventory_apps')
  const [testTabId, setTestTabId] = useState('overview')
  const [testResults, setTestResults] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [dbFunctionTest, setDbFunctionTest] = useState('')
  const [allUsers, setAllUsers] = useState<
    {
      id: string
      email: string
      role_id: string | null
      roles: { name: string } | null
    }[]
  >([])
  // Load users and roles on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load users
        const { data: users, error: usersError } = await supabase
          .from('user_profiles')
          .select('id, email, role_id, roles(name)')
          .limit(10)

        if (!usersError && users) {
          setAllUsers(users)
          logger.log('Loaded users:', users)
        }

        // Load current user's tab permissions
        if (profile?.id) {
          const tabPerms = await rbacService.getUserTabPermissions(profile.id)
          logger.log('Current user tab permissions:', tabPerms)
        }
      } catch (error) {
        logger.error('Error loading data:', error)
      }
    }

    loadData()
  }, [profile])

  const testDatabaseFunctions = async () => {
    if (!testUserId) return

    setIsLoading(true)
    const results: Record<string, unknown> = {}

    try {
      // Find user ID by email if needed
      let userId = testUserId
      if (testUserId.includes('@')) {
        const { data: user, error: userError } = await supabase
          .from('user_profiles')
          .select('id, email, role_id, roles(name)')
          .eq('email', testUserId)
          .single()

        if (userError) {
          results.userLookupError = userError.message
          setTestResults(results)
          setIsLoading(false)
          return
        }

        if (user) {
          userId = user.id
          results.userInfo = user
        } else {
          results.userNotFound = true
          setTestResults(results)
          setIsLoading(false)
          return
        }
      }

      // Test 1: Direct database function call - check_user_tab_permission
      try {
        const { data: checkResult, error: checkError } = await supabase.rpc(
          'check_user_tab_permission',
          {
            p_user_id: userId,
            p_page_resource: testPageResource,
            p_tab_id: testTabId,
          }
        )

        results.checkUserTabPermission = {
          result: checkResult,
          error: checkError?.message,
        }
      } catch (error) {
        results.checkUserTabPermission = {
          error:
            error instanceof Error ? error.message : 'Function call failed',
          functionMissing: true,
        }
      }

      // Test 2: Direct database function call - get_user_tab_permissions
      try {
        const { data: getUserResult, error: getUserError } = await supabase.rpc(
          'get_user_tab_permissions',
          {
            p_user_id: userId,
            p_page_resource: testPageResource,
          }
        )

        results.getUserTabPermissions = {
          result: getUserResult,
          error: getUserError?.message,
        }
      } catch (error) {
        results.getUserTabPermissions = {
          error:
            error instanceof Error ? error.message : 'Function call failed',
        }
      }

      // Test 3: RBAC Service call
      try {
        const serviceResult = await rbacService.checkTabPermission(
          userId,
          testPageResource,
          testTabId
        )
        results.rbacServiceCheck = {
          result: serviceResult,
        }
      } catch (error) {
        results.rbacServiceCheck = {
          error: error instanceof Error ? error.message : 'RBAC service failed',
        }
      }

      // Test 4: Get all tab definitions
      try {
        const { data: tabDefs, error: tabDefsError } = await supabase
          .from('tab_definitions' as 'audit_logs')
          .select('*')
          .eq('page_resource', testPageResource)

        results.tabDefinitions = {
          result: tabDefs,
          error: tabDefsError?.message,
        }
      } catch (error) {
        results.tabDefinitions = {
          error:
            error instanceof Error
              ? error.message
              : 'Tab definitions query failed',
        }
      }

      // Test 5: Get role tab permissions
      try {
        const { data: roleTabPerms, error: roleTabPermsError } = await supabase
          .from('role_tab_permissions' as 'audit_logs')
          .select(
            `
            *,
            tab_definition:tab_definitions(*),
            role:roles(*)
          `
          )
          .limit(10)

        results.roleTabPermissions = {
          result: roleTabPerms,
          error: roleTabPermsError?.message,
        }
      } catch (error) {
        results.roleTabPermissions = {
          error:
            error instanceof Error
              ? error.message
              : 'Role tab permissions query failed',
        }
      }

      logger.log('Debug test results:', results)
      setTestResults(results)
    } catch (error) {
      logger.error('Error running tests:', error)
      toast.error('Error running debug tests')
    } finally {
      setIsLoading(false)
    }
  }

  const testMigrationSQL = async () => {
    if (!import.meta.env.DEV) {
      toast.error('SQL execution is disabled in production')
      return
    }
    if (!dbFunctionTest.trim()) return

    setIsLoading(true)
    try {
      // Execute raw SQL (this might not work without service role)
      const { data, error } = await supabase.rpc(
        'exec_sql' as 'check_user_tab_permission',
        { sql: dbFunctionTest } as unknown as {
          p_user_id: string
          p_page_resource: string
          p_tab_id: string
        }
      )

      if (error) {
        toast.error(`SQL Error: ${error.message}`)
        setTestResults({ sqlError: error.message })
      } else {
        toast.success('SQL executed successfully')
        setTestResults({ sqlResult: data })
      }
    } catch (error) {
      logger.error('SQL execution error:', error)
      toast.error('Failed to execute SQL')
      setTestResults({
        sqlError: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const loadPermissionStore = async () => {
    if (!profile?.id) return

    setIsLoading(true)
    try {
      const store = usePermissionStore.getState()
      await store.loadTabPermissions(profile.id, testPageResource, false)
      toast.success('Permission store reloaded')
    } catch (error) {
      logger.error('Error loading permission store:', error)
      toast.error('Failed to reload permission store')
    } finally {
      setIsLoading(false)
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
        <div className='mb-6'>
          <h2 className='text-2xl font-bold tracking-tight'>
            Tab Permissions Debug
          </h2>
          <p className='text-muted-foreground'>
            Debug interface for testing tab permissions system
          </p>
        </div>

        <div className='grid gap-6'>
          {/* Test Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Test Configuration</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div>
                <label className='text-sm font-medium'>User Email or ID</label>
                <Input
                  value={testUserId}
                  onChange={(e) => setTestUserId(e.target.value)}
                  placeholder='user@example.com or UUID'
                />
              </div>
              <div>
                <label className='text-sm font-medium'>Page Resource</label>
                <Input
                  value={testPageResource}
                  onChange={(e) => setTestPageResource(e.target.value)}
                  placeholder='inventory_apps'
                />
              </div>
              <div>
                <label className='text-sm font-medium'>Tab ID</label>
                <Input
                  value={testTabId}
                  onChange={(e) => setTestTabId(e.target.value)}
                  placeholder='overview'
                />
              </div>
              <div className='flex gap-2'>
                <Button onClick={testDatabaseFunctions} disabled={isLoading}>
                  {isLoading ? 'Testing...' : 'Run Database Tests'}
                </Button>
                <Button
                  variant='outline'
                  onClick={loadPermissionStore}
                  disabled={isLoading}
                >
                  Reload Permission Store
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Current State */}
          <Card>
            <CardHeader>
              <CardTitle>Current State</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-2'>
                <p>
                  <strong>Current User:</strong> {profile?.email} ({profile?.id}
                  )
                </p>
                <p>
                  <strong>Current Role:</strong>{' '}
                  {(profile as unknown as { roles?: { name: string } })?.roles
                    ?.name || profile?.role_id}
                </p>
                <p>
                  <strong>Tab Permissions Loaded:</strong>{' '}
                  {tabPermissions.length}
                </p>
                <p>
                  <strong>Has Test Tab Access:</strong>
                  <Badge
                    variant={
                      hasTabPermission(testPageResource, testTabId)
                        ? 'default'
                        : 'destructive'
                    }
                  >
                    {hasTabPermission(testPageResource, testTabId)
                      ? 'Yes'
                      : 'No'}
                  </Badge>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Test Results */}
          {Object.keys(testResults).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Test Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='space-y-4'>
                  {Object.entries(testResults).map(([key, value]) => (
                    <div key={key}>
                      <h4 className='font-medium'>{key}</h4>
                      <pre className='bg-muted mt-2 overflow-x-auto rounded-lg p-3 text-sm'>
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick User List */}
          {allUsers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Available Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='space-y-2'>
                  {allUsers.map((user) => (
                    <div key={user.id} className='flex items-center gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setTestUserId(user.email)}
                      >
                        Select
                      </Button>
                      <span className='text-sm'>{user.email}</span>
                      <Badge variant='outline'>
                        {user.roles?.name || user.role_id}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Raw SQL Test - Dev Only */}
          {import.meta.env.DEV && (
            <Card>
              <CardHeader>
                <CardTitle>Direct SQL Testing (Dev Only)</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <Alert variant='destructive' className='mb-4'>
                  <AlertTriangle className='h-4 w-4' />
                  <AlertDescription>
                    <strong>Development Only:</strong> Direct SQL execution is
                    disabled in production builds. This tool is for debugging
                    tab permission migrations only.
                  </AlertDescription>
                </Alert>
                <textarea
                  value={dbFunctionTest}
                  onChange={(e) => setDbFunctionTest(e.target.value)}
                  placeholder='SELECT * FROM tab_definitions;'
                  className='h-32 w-full rounded-lg border p-3 font-mono text-sm'
                />
                <Button onClick={testMigrationSQL} disabled={isLoading}>
                  {isLoading ? 'Executing...' : 'Execute SQL'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute(
  '/_authenticated/admin/tab-permissions-debug'
)({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/tab-permissions-debug',
    resourcePermission: { action: 'manage', resource: 'permissions' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: TabPermissionsDebug,
})

// Created and developed by Jai Singh
