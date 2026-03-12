import { useMemo } from 'react'
import {
  Shield,
  Menu,
  Layout,
  User,
  CheckCircle,
  AlertCircle,
  Info,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import type { RoleSummaryData } from './types'

export interface RoleSummaryCardProps {
  data: RoleSummaryData
  showHeader?: boolean
  variant?: 'default' | 'compact' | 'detailed'
  className?: string
}

export function RoleSummaryCard({
  data,
  showHeader = true,
  variant = 'default',
  className = '',
}: RoleSummaryCardProps) {
  // Calculate percentages for progress bars
  const navigationPercentage = useMemo(() => {
    if (data.navigationTotalCount === 0) return 0
    return Math.round(
      (data.navigationVisibleCount / data.navigationTotalCount) * 100
    )
  }, [data.navigationVisibleCount, data.navigationTotalCount])

  const tabsPercentage = useMemo(() => {
    if (data.tabsTotalCount === 0) return 0
    return Math.round((data.tabsGrantedCount / data.tabsTotalCount) * 100)
  }, [data.tabsGrantedCount, data.tabsTotalCount])

  // Get top resources by permission count
  const topResources = useMemo(() => {
    return Object.entries(data.permissionsByResource)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
  }, [data.permissionsByResource])

  // Determine access level badge
  const accessLevel = useMemo(() => {
    const totalResourcePerms = Object.values(data.permissionsByResource).reduce(
      (a, b) => a + b,
      0
    )
    if (totalResourcePerms === 0)
      return {
        label: 'No Access',
        variant: 'destructive' as const,
        icon: AlertCircle,
      }
    if (data.permissionsCount < 5)
      return { label: 'Limited', variant: 'secondary' as const, icon: Info }
    if (data.permissionsCount < 20)
      return {
        label: 'Standard',
        variant: 'outline' as const,
        icon: CheckCircle,
      }
    return { label: 'Full Access', variant: 'default' as const, icon: Shield }
  }, [data.permissionsCount, data.permissionsByResource])

  const AccessIcon = accessLevel.icon

  if (variant === 'compact') {
    return (
      <Card className={className}>
        <CardContent className='pt-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <User className='text-muted-foreground h-4 w-4' />
              <span className='font-medium'>
                {data.displayName || data.name}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <Badge variant='outline' className='text-xs'>
                <Shield className='mr-1 h-3 w-3' />
                {data.permissionsCount}
              </Badge>
              <Badge variant='outline' className='text-xs'>
                <Menu className='mr-1 h-3 w-3' />
                {data.navigationVisibleCount}
              </Badge>
              <Badge variant='outline' className='text-xs'>
                <Layout className='mr-1 h-3 w-3' />
                {data.tabsGrantedCount}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      {showHeader && (
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-lg'>
                {data.displayName || data.name}
              </CardTitle>
              {data.description && (
                <p className='text-muted-foreground mt-1 text-sm'>
                  {data.description}
                </p>
              )}
            </div>
            <Badge
              variant={accessLevel.variant}
              className='flex items-center gap-1'
            >
              <AccessIcon className='h-3 w-3' />
              {accessLevel.label}
            </Badge>
          </div>
        </CardHeader>
      )}

      <CardContent className={showHeader ? 'pt-0' : 'pt-4'}>
        <div className='space-y-4'>
          {/* Permissions Summary */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Shield className='h-4 w-4 text-blue-500' />
                <span className='text-sm font-medium'>Permissions</span>
              </div>
              <Badge variant='secondary'>{data.permissionsCount} total</Badge>
            </div>

            {variant === 'detailed' && topResources.length > 0 && (
              <div className='space-y-1 pl-6'>
                {topResources.map(([resource, count]) => (
                  <div
                    key={resource}
                    className='flex items-center justify-between text-xs'
                  >
                    <span className='text-muted-foreground capitalize'>
                      {resource.replace('_', ' ')}
                    </span>
                    <Badge variant='outline' className='text-xs'>
                      {count}
                    </Badge>
                  </div>
                ))}
                {Object.keys(data.permissionsByResource).length > 5 && (
                  <span className='text-muted-foreground text-xs'>
                    +{Object.keys(data.permissionsByResource).length - 5} more
                    resources
                  </span>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Navigation Summary */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Menu className='h-4 w-4 text-green-500' />
                <span className='text-sm font-medium'>Navigation</span>
              </div>
              <span className='text-muted-foreground text-sm'>
                {data.navigationVisibleCount} of {data.navigationTotalCount}{' '}
                visible
              </span>
            </div>
            <Progress value={navigationPercentage} className='h-2' />
            <p className='text-muted-foreground text-right text-xs'>
              {navigationPercentage}% accessible
            </p>
          </div>

          <Separator />

          {/* Tab Permissions Summary */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Layout className='h-4 w-4 text-purple-500' />
                <span className='text-sm font-medium'>Tab Access</span>
              </div>
              <span className='text-muted-foreground text-sm'>
                {data.tabsGrantedCount} of {data.tabsTotalCount} granted
              </span>
            </div>
            <Progress value={tabsPercentage} className='h-2' />
            <p className='text-muted-foreground text-right text-xs'>
              {tabsPercentage}% accessible
            </p>
          </div>

          {variant === 'detailed' && (
            <>
              <Separator />

              {/* Quick Stats */}
              <div className='grid grid-cols-3 gap-4 text-center'>
                <div className='space-y-1'>
                  <div className='text-2xl font-bold text-blue-500'>
                    {data.permissionsCount}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    Permissions
                  </div>
                </div>
                <div className='space-y-1'>
                  <div className='text-2xl font-bold text-green-500'>
                    {data.navigationVisibleCount}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    Menu Items
                  </div>
                </div>
                <div className='space-y-1'>
                  <div className='text-2xl font-bold text-purple-500'>
                    {data.tabsGrantedCount}
                  </div>
                  <div className='text-muted-foreground text-xs'>Tabs</div>
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
