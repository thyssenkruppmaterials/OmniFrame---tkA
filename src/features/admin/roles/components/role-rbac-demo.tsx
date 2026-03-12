import { Shield, Users, Settings, Eye, Lock } from 'lucide-react'
import { useRBAC, CanAccess } from '@/hooks/use-rbac'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function RoleRBACDemo() {
  const { hasPermission } = useRBAC()

  const testPermissions = [
    { action: 'read', resource: 'users', label: 'View Users' },
    { action: 'manage', resource: 'users', label: 'Manage Users' },
    { action: 'read', resource: 'tasks', label: 'View Tasks' },
    { action: 'manage', resource: 'tasks', label: 'Manage Tasks' },
    { action: 'manage', resource: 'roles', label: 'Manage Roles' },
    { action: 'read', resource: 'settings', label: 'View Settings' },
    { action: 'update', resource: 'settings', label: 'Update Settings' },
  ]

  return (
    <Card className='w-full max-w-2xl'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Shield className='h-5 w-5' />
          RBAC Permission Demo
        </CardTitle>
        <CardDescription>
          This demo shows which sidebar menu items you can access based on your
          current role and permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Alert>
          <Eye className='h-4 w-4' />
          <AlertDescription>
            Sidebar menu items are automatically filtered based on your
            permissions. Only items you have access to will be visible in the
            navigation.
          </AlertDescription>
        </Alert>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {testPermissions.map((perm) => {
            const hasAccess = hasPermission(perm.action, perm.resource)
            return (
              <div
                key={`${perm.resource}-${perm.action}`}
                className={`rounded-lg border-2 p-3 ${
                  hasAccess
                    ? 'border-green-200 bg-green-50 dark:bg-green-950/20'
                    : 'border-red-200 bg-red-50 dark:bg-red-950/20'
                }`}
              >
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>{perm.label}</span>
                  <Badge variant={hasAccess ? 'default' : 'destructive'}>
                    {hasAccess ? 'Allowed' : 'Denied'}
                  </Badge>
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {perm.action}:{perm.resource}
                </p>
              </div>
            )
          })}
        </div>

        <div className='space-y-2'>
          <h4 className='flex items-center gap-2 font-medium'>
            <Users className='h-4 w-4' />
            Conditional Components
          </h4>

          <CanAccess action='manage' resource='users'>
            <Button variant='default' className='w-full'>
              <Users className='mr-2 h-4 w-4' />
              User Management Available
            </Button>
          </CanAccess>

          <CanAccess
            action='manage'
            resource='roles'
            fallback={
              <Button variant='destructive' disabled className='w-full'>
                <Lock className='mr-2 h-4 w-4' />
                Role Management Restricted
              </Button>
            }
          >
            <Button variant='default' className='w-full'>
              <Shield className='mr-2 h-4 w-4' />
              Role Management Available
            </Button>
          </CanAccess>

          <CanAccess action='update' resource='settings'>
            <Button variant='default' className='w-full'>
              <Settings className='mr-2 h-4 w-4' />
              Settings Management Available
            </Button>
          </CanAccess>
        </div>
      </CardContent>
    </Card>
  )
}
