import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Database,
  RefreshCw,
  Zap,
  Monitor,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

/**
 * Performance Monitor Page - Admin-only performance monitoring and optimization controls
 */
export function PerformanceMonitorPage() {
  const queryClient = useQueryClient()
  const [performanceData, setPerformanceData] = useState({
    queryCount: 0,
    cacheSize: 0,
    subscriptionCount: 0,
    lastUpdate: Date.now(),
    memoryUsage: 0,
    optimizationScore: 0,
  })
  const [optimizationsEnabled, setOptimizationsEnabled] = useState(
    localStorage.getItem('performance-optimizations-enabled') !== 'false'
  )
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Monitor performance metrics with enhanced data collection
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      const cache = queryClient.getQueryCache()
      const queries = cache.getAll()
      const activeQueries = queries.filter((q) => q.state.data)
      const staleQueries = queries.filter((q) => q.isStale())

      // Calculate memory usage estimate
      const memoryEstimate = queries.reduce((total, query) => {
        return total + JSON.stringify(query.state.data || {}).length / 1024 // KB estimate
      }, 0)

      // Calculate optimization score based on cache efficiency
      const cacheHitRatio =
        queries.length > 0 ? (activeQueries.length / queries.length) * 100 : 100
      const optimizationScore = Math.min(
        100,
        Math.max(0, cacheHitRatio - staleQueries.length * 2)
      )

      setPerformanceData({
        queryCount: queries.length,
        cacheSize: activeQueries.length,
        subscriptionCount: document.querySelectorAll(
          '[data-supabase-subscription]'
        ).length,
        lastUpdate: Date.now(),
        memoryUsage: Math.round(memoryEstimate),
        optimizationScore: Math.round(optimizationScore),
      })
    }, 2000) // Update every 2 seconds

    return () => clearInterval(interval)
  }, [queryClient, autoRefresh])

  // Performance control functions
  const clearAllCaches = () => {
    queryClient.clear()
    localStorage.removeItem('permission-cache')
    localStorage.removeItem('navigation-cache')
    sessionStorage.clear()
    logger.log('All caches cleared')
  }

  const toggleOptimizations = (enabled: boolean) => {
    setOptimizationsEnabled(enabled)
    localStorage.setItem(
      'performance-optimizations-enabled',
      enabled.toString()
    )
    logger.log('Performance optimizations', enabled ? 'enabled' : 'disabled')
  }

  const forceGarbageCollection = () => {
    queryClient.getQueryCache().clear()
    // Trigger browser garbage collection if available
    if ('gc' in window && typeof window.gc === 'function') {
      window.gc()
    }
    logger.log('Forced garbage collection')
  }

  const getOptimizationStatus = () => {
    if (performanceData.optimizationScore >= 80)
      return { status: 'Excellent', color: 'text-green-600' }
    if (performanceData.optimizationScore >= 60)
      return { status: 'Good', color: 'text-blue-600' }
    if (performanceData.optimizationScore >= 40)
      return { status: 'Fair', color: 'text-yellow-600' }
    return { status: 'Poor', color: 'text-red-600' }
  }

  const optimizationStatus = getOptimizationStatus()

  return (
    <>
      {/* Header */}
      <header className='bg-background sticky top-0 z-10 flex h-16 items-center gap-1 border-b px-4'>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </header>

      {/* Main Content */}
      <main className='flex-1 space-y-6 p-6'>
        <div className='space-y-2'>
          <h2 className='text-2xl font-bold tracking-tight'>
            Performance Monitor
          </h2>
          <p className='text-muted-foreground'>
            Real-time performance monitoring and optimization controls for
            OmniFrame Logistics
          </p>
        </div>

        {/* Performance Overview */}
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Query Cache</CardTitle>
              <Database className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {performanceData.cacheSize}
              </div>
              <p className='text-muted-foreground text-xs'>
                of {performanceData.queryCount} total queries
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Real-time Subscriptions
              </CardTitle>
              <Zap className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {performanceData.subscriptionCount}
              </div>
              <Badge
                variant={
                  performanceData.subscriptionCount > 5
                    ? 'destructive'
                    : 'outline'
                }
                className='mt-1 text-xs'
              >
                {performanceData.subscriptionCount > 5 ? 'High' : 'Normal'}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Memory Usage
              </CardTitle>
              <Monitor className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {performanceData.memoryUsage}
              </div>
              <p className='text-muted-foreground text-xs'>KB (estimated)</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Optimization Score
              </CardTitle>
              {performanceData.optimizationScore >= 80 ? (
                <CheckCircle2 className='h-4 w-4 text-green-600' />
              ) : (
                <AlertCircle className='h-4 w-4 text-yellow-600' />
              )}
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {performanceData.optimizationScore}%
              </div>
              <p className={`text-xs ${optimizationStatus.color}`}>
                {optimizationStatus.status}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Performance Controls */}
        <div className='grid gap-6 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Activity className='h-5 w-5' />
                Performance Controls
              </CardTitle>
              <CardDescription>
                Monitor and control application performance settings
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <div className='flex items-center space-x-2'>
                <Switch
                  id='optimizations'
                  checked={optimizationsEnabled}
                  onCheckedChange={toggleOptimizations}
                />
                <Label htmlFor='optimizations' className='text-sm font-medium'>
                  Enable performance optimizations
                </Label>
              </div>

              <div className='flex items-center space-x-2'>
                <Switch
                  id='auto-refresh'
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                />
                <Label htmlFor='auto-refresh' className='text-sm font-medium'>
                  Auto-refresh metrics
                </Label>
              </div>

              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Cache Efficiency</Label>
                <div className='bg-secondary h-2 w-full rounded-full'>
                  <div
                    className='bg-primary h-2 rounded-full transition-all duration-300'
                    style={{ width: `${performanceData.optimizationScore}%` }}
                  />
                </div>
                <p className='text-muted-foreground text-xs'>
                  {performanceData.optimizationScore}% cache hit ratio
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Database className='h-5 w-5' />
                Cache Management
              </CardTitle>
              <CardDescription>
                Manage application caches and memory usage
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-2'>
                <Button
                  variant='outline'
                  onClick={clearAllCaches}
                  className='w-full'
                >
                  <Database className='mr-2 h-4 w-4' />
                  Clear All Caches
                </Button>
                <Button
                  variant='outline'
                  onClick={forceGarbageCollection}
                  className='w-full'
                >
                  <RefreshCw className='mr-2 h-4 w-4' />
                  Force Garbage Collection
                </Button>
                <Button
                  variant='outline'
                  onClick={() => window.location.reload()}
                  className='w-full'
                >
                  <Monitor className='mr-2 h-4 w-4' />
                  Reload Application
                </Button>
              </div>

              <div className='text-muted-foreground space-y-1 text-xs'>
                <p>
                  Last update:{' '}
                  {new Date(performanceData.lastUpdate).toLocaleTimeString()}
                </p>
                <p>
                  Status: {optimizationsEnabled ? 'Optimized' : 'Standard'} mode
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Activity className='h-5 w-5' />
              Detailed Performance Metrics
            </CardTitle>
            <CardDescription>
              Comprehensive performance analytics and system health monitoring
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Query Statistics</Label>
                <div className='space-y-1 text-sm'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>
                      Total Queries:
                    </span>
                    <span>{performanceData.queryCount}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>
                      Cached Queries:
                    </span>
                    <span>{performanceData.cacheSize}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>
                      Cache Hit Ratio:
                    </span>
                    <span>
                      {performanceData.queryCount > 0
                        ? Math.round(
                            (performanceData.cacheSize /
                              performanceData.queryCount) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <Label className='text-sm font-medium'>
                  Real-time Connections
                </Label>
                <div className='space-y-1 text-sm'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>
                      Active Subscriptions:
                    </span>
                    <Badge
                      variant={
                        performanceData.subscriptionCount > 5
                          ? 'destructive'
                          : 'outline'
                      }
                      className='text-xs'
                    >
                      {performanceData.subscriptionCount}
                    </Badge>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Status:</span>
                    <span
                      className={
                        performanceData.subscriptionCount <= 5
                          ? 'text-green-600'
                          : 'text-red-600'
                      }
                    >
                      {performanceData.subscriptionCount <= 5
                        ? 'Healthy'
                        : 'High Load'}
                    </span>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <Label className='text-sm font-medium'>
                  Memory & Optimization
                </Label>
                <div className='space-y-1 text-sm'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Memory Usage:</span>
                    <span>{performanceData.memoryUsage} KB</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>
                      Optimization Mode:
                    </span>
                    <Badge
                      variant={optimizationsEnabled ? 'default' : 'secondary'}
                      className='text-xs'
                    >
                      {optimizationsEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Performance Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <CheckCircle2 className='h-5 w-5' />
              Performance Recommendations
            </CardTitle>
            <CardDescription>
              System analysis and optimization suggestions
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-3'>
              {performanceData.subscriptionCount > 5 && (
                <div className='flex items-start gap-3 rounded-lg bg-yellow-50 p-3 dark:bg-yellow-950/20'>
                  <AlertCircle className='mt-0.5 h-5 w-5 text-yellow-600' />
                  <div>
                    <p className='font-medium text-yellow-800 dark:text-yellow-200'>
                      High Real-time Connection Count
                    </p>
                    <p className='text-sm text-yellow-700 dark:text-yellow-300'>
                      Consider reducing active subscriptions to improve
                      performance.
                    </p>
                  </div>
                </div>
              )}

              {performanceData.memoryUsage > 1000 && (
                <div className='flex items-start gap-3 rounded-lg bg-orange-50 p-3 dark:bg-orange-950/20'>
                  <AlertCircle className='mt-0.5 h-5 w-5 text-orange-600' />
                  <div>
                    <p className='font-medium text-orange-800 dark:text-orange-200'>
                      High Memory Usage
                    </p>
                    <p className='text-sm text-orange-700 dark:text-orange-300'>
                      Consider clearing caches or forcing garbage collection.
                    </p>
                  </div>
                </div>
              )}

              {performanceData.optimizationScore >= 80 && (
                <div className='flex items-start gap-3 rounded-lg bg-green-50 p-3 dark:bg-green-950/20'>
                  <CheckCircle2 className='mt-0.5 h-5 w-5 text-green-600' />
                  <div>
                    <p className='font-medium text-green-800 dark:text-green-200'>
                      Excellent Performance
                    </p>
                    <p className='text-sm text-green-700 dark:text-green-300'>
                      Application is running optimally with efficient cache
                      usage.
                    </p>
                  </div>
                </div>
              )}

              {!optimizationsEnabled && (
                <div className='flex items-start gap-3 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20'>
                  <AlertCircle className='mt-0.5 h-5 w-5 text-blue-600' />
                  <div>
                    <p className='font-medium text-blue-800 dark:text-blue-200'>
                      Optimizations Disabled
                    </p>
                    <p className='text-sm text-blue-700 dark:text-blue-300'>
                      Enable performance optimizations for better application
                      responsiveness.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
