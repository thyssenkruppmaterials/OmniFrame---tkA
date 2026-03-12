/**
 * Cache Management Component for OmniFrame
 * Provides users with tools to clear caches and resolve caching issues
 */
import React, { useState, useEffect } from 'react'
import {
  Trash2,
  RefreshCw,
  Database,
  Smartphone,
  AlertTriangle,
  CheckCircle,
  Info,
  Settings,
} from 'lucide-react'
import { toast } from 'sonner'
import { cacheManager, CacheClearResult } from '@/lib/utils/cache-manager'
import { logger } from '@/lib/utils/logger'
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
import { Progress } from '@/components/ui/progress'

export const CacheManagement: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [cacheStatus, setCacheStatus] = useState({
    localStorage: 0,
    sessionStorage: 0,
    indexedDB: 0,
    caches: 0,
    serviceWorker: false,
  })
  const [clearResult, setClearResult] = useState<CacheClearResult | null>(null)
  const [progress, setProgress] = useState(0)

  // Load cache status on component mount
  useEffect(() => {
    loadCacheStatus()
  }, [])

  const loadCacheStatus = async () => {
    try {
      const status = await cacheManager.getCacheStatus()
      setCacheStatus(status)
    } catch (error) {
      logger.error('Failed to load cache status:', error)
    }
  }

  const handleClearAllCaches = async () => {
    setIsLoading(true)
    setProgress(0)
    setClearResult(null)

    try {
      // Simulate progress for better UX
      const progressSteps = [10, 25, 40, 60, 80, 100]
      let stepIndex = 0

      const progressInterval = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setProgress(progressSteps[stepIndex])
          stepIndex++
        } else {
          clearInterval(progressInterval)
        }
      }, 300)

      const result = await cacheManager.clearAllCaches()
      setClearResult(result)

      clearInterval(progressInterval)
      setProgress(100)

      if (result.success) {
        toast.success(
          `Cache cleared successfully! ${result.clearedItems.join(', ')}`
        )
      } else {
        toast.error('Some cache clearing operations failed')
      }

      // Reload cache status
      await loadCacheStatus()
    } catch (error) {
      logger.error('Cache clearing failed:', error)
      toast.error('Failed to clear caches')
    } finally {
      setIsLoading(false)
    }
  }

  const handleForceReload = () => {
    toast.info('Forcing complete page reload...')
    cacheManager.forceReload()
  }

  const handleCheckForUpdates = async () => {
    try {
      const hasUpdate = await cacheManager.checkForPWAUpdate()
      if (hasUpdate) {
        toast.info('New PWA version available! Refreshing...')
        setTimeout(() => window.location.reload(), 2000)
      } else {
        toast.success('You have the latest version')
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      toast.error('Failed to check for updates')
    }
  }

  const getTotalCacheItems = () => {
    return (
      cacheStatus.localStorage +
      cacheStatus.sessionStorage +
      cacheStatus.indexedDB +
      cacheStatus.caches
    )
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center space-x-2'>
        <Settings className='h-5 w-5' />
        <h2 className='text-2xl font-bold'>Cache Management</h2>
      </div>

      <p className='text-muted-foreground'>
        Manage browser caches and resolve caching issues that may prevent you
        from seeing the latest version of OmniFrame.
      </p>

      {/* Cache Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <Database className='h-5 w-5' />
            <span>Cache Status</span>
          </CardTitle>
          <CardDescription>
            Current cache usage across different storage types
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
            <div className='rounded-lg border p-4 text-center'>
              <div className='text-2xl font-bold'>
                {cacheStatus.localStorage}
              </div>
              <div className='text-muted-foreground text-sm'>LocalStorage</div>
            </div>
            <div className='rounded-lg border p-4 text-center'>
              <div className='text-2xl font-bold'>
                {cacheStatus.sessionStorage}
              </div>
              <div className='text-muted-foreground text-sm'>
                SessionStorage
              </div>
            </div>
            <div className='rounded-lg border p-4 text-center'>
              <div className='text-2xl font-bold'>{cacheStatus.indexedDB}</div>
              <div className='text-muted-foreground text-sm'>IndexedDB</div>
            </div>
            <div className='rounded-lg border p-4 text-center'>
              <div className='text-2xl font-bold'>{cacheStatus.caches}</div>
              <div className='text-muted-foreground text-sm'>Cache Storage</div>
            </div>
          </div>

          <div className='flex items-center space-x-2'>
            <Smartphone className='h-4 w-4' />
            <span className='text-sm'>
              PWA Service Worker:{' '}
              {cacheStatus.serviceWorker ? 'Active' : 'Inactive'}
            </span>
            <Badge
              variant={cacheStatus.serviceWorker ? 'default' : 'secondary'}
            >
              {cacheStatus.serviceWorker ? '✓' : '✗'}
            </Badge>
          </div>

          <div className='text-muted-foreground text-center text-sm'>
            Total cached items: {getTotalCacheItems()}
          </div>
        </CardContent>
      </Card>

      {/* Clear Cache Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <Trash2 className='h-5 w-5' />
            <span>Cache Clearing Actions</span>
          </CardTitle>
          <CardDescription>
            Clear different types of caches to resolve issues with outdated
            content
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-3'>
            <Button
              onClick={handleClearAllCaches}
              disabled={isLoading}
              className='w-full'
              variant='destructive'
            >
              {isLoading ? (
                <>
                  <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
                  Clearing Caches... ({progress}%)
                </>
              ) : (
                <>
                  <Trash2 className='mr-2 h-4 w-4' />
                  Clear All Caches
                </>
              )}
            </Button>

            {isLoading && <Progress value={progress} className='w-full' />}

            <Button
              onClick={handleForceReload}
              variant='outline'
              className='w-full'
            >
              <RefreshCw className='mr-2 h-4 w-4' />
              Force Complete Reload
            </Button>

            <Button
              onClick={handleCheckForUpdates}
              variant='outline'
              className='w-full'
            >
              <Info className='mr-2 h-4 w-4' />
              Check for PWA Updates
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {clearResult && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center space-x-2'>
              {clearResult.success ? (
                <CheckCircle className='h-5 w-5 text-green-500' />
              ) : (
                <AlertTriangle className='h-5 w-5 text-red-500' />
              )}
              <span>
                {clearResult.success
                  ? 'Cache Clearing Successful'
                  : 'Cache Clearing Issues'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {clearResult.clearedItems.length > 0 && (
              <div>
                <h4 className='mb-2 font-medium'>Cleared Items:</h4>
                <ul className='list-inside list-disc space-y-1 text-sm'>
                  {clearResult.clearedItems.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {clearResult.errors.length > 0 && (
              <Alert variant='destructive'>
                <AlertTriangle className='h-4 w-4' />
                <AlertDescription>
                  <strong>Errors encountered:</strong>
                  <ul className='mt-2 list-inside list-disc'>
                    {clearResult.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <h4 className='mb-2 font-medium'>Recommendations:</h4>
              <ul className='list-inside list-disc space-y-1 text-sm'>
                {clearResult.recommendations.map((rec, index) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Troubleshooting Tips */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <AlertTriangle className='h-5 w-5' />
            <span>Troubleshooting Tips</span>
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4'>
            <div className='rounded-lg border p-4'>
              <h4 className='mb-2 font-medium'>Still seeing old content?</h4>
              <p className='text-muted-foreground mb-2 text-sm'>
                If cache clearing doesn't resolve issues, try these additional
                steps:
              </p>
              <ul className='list-inside list-disc space-y-1 text-sm'>
                <li>
                  Hard refresh: Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)
                </li>
                <li>Open in incognito/private window to test</li>
                <li>Clear browser data for this site specifically</li>
                <li>Check browser developer tools for service worker issues</li>
              </ul>
            </div>

            <div className='rounded-lg border p-4'>
              <h4 className='mb-2 font-medium'>PWA Issues?</h4>
              <p className='text-muted-foreground mb-2 text-sm'>
                If you're using the installed PWA app and seeing issues:
              </p>
              <ul className='list-inside list-disc space-y-1 text-sm'>
                <li>Uninstall and reinstall the PWA from browser menu</li>
                <li>Check for PWA updates using the button above</li>
                <li>Force refresh within the PWA app</li>
              </ul>
            </div>

            <div className='rounded-lg border p-4'>
              <h4 className='mb-2 font-medium'>Prevention</h4>
              <p className='text-muted-foreground mb-2 text-sm'>
                To minimize future caching issues:
              </p>
              <ul className='list-inside list-disc space-y-1 text-sm'>
                <li>Use the cache management tools regularly</li>
                <li>Check for updates before reporting issues</li>
                <li>Use incognito mode for testing new features</li>
                <li>Keep browser and PWA updated</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default CacheManagement
