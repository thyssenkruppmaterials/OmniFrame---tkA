// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { AlertCircle, TrendingUp, Package, Truck } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
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
import { Skeleton } from '@/components/ui/skeleton'

interface OutboundAnalytics {
  total_deliveries: number
  pending_count: number
  processing_count: number
  packed_count: number
  final_packed_count: number
  completion_rate: number
  top_materials: Array<{
    material: string
    count: number
    description?: string
  }>
  status_breakdown: {
    [key: string]: number
  }
  daily_throughput: Array<{ date: string; count: number }> | number
}

// Supabase Edge Function API client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const EDGE_FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1`

class FastAPIClient {
  private getAuthHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  }

  async getOutboundAnalytics(token: string): Promise<OutboundAnalytics> {
    const response = await fetch(
      `${EDGE_FUNCTION_BASE_URL}/analytics-api/api/analytics/outbound/summary`,
      {
        headers: this.getAuthHeaders(token),
      }
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()
    return result.data || result // Handle the wrapper structure
  }

  async exportOutboundData(
    _token: string,
    _format: 'csv' | 'excel' | 'json' = 'csv'
  ): Promise<Blob> {
    // For now, return a mock CSV blob since export functionality needs more implementation
    const csvData = 'delivery,status,created_at\nExample Data\n'
    return new Blob([csvData], { type: 'text/csv' })
  }
}

const fastApiClient = new FastAPIClient()

export function FastAPIAnalytics() {
  const { authState } = useUnifiedAuth()
  const session = authState.session
  const [analytics, setAnalytics] = useState<OutboundAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAnalytics reads session; adding would cause unnecessary re-fetches when loadAnalytics identity changes
  }, [session])

  const loadAnalytics = async () => {
    if (!session?.access_token) {
      setError('No authentication token available')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      logger.log(
        '🚀 Calling FastAPI Analytics with token:',
        session.access_token.slice(-10)
      )

      const data = await fastApiClient.getOutboundAnalytics(
        session.access_token
      )
      setAnalytics(data)

      logger.log('✅ FastAPI Analytics data received:', data)
    } catch (err) {
      logger.error('❌ FastAPI Analytics error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (format: 'csv' | 'excel' | 'json') => {
    if (!session?.access_token) return

    try {
      setExporting(true)
      const blob = await fastApiClient.exportOutboundData(
        session.access_token,
        format
      )

      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `outbound-analytics.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      logger.log(`✅ Exported analytics data as ${format}`)
    } catch (err) {
      logger.error('❌ Export error:', err)
      setError(
        `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className='space-y-4'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <Skeleton className='h-4 w-20' />
                <Skeleton className='h-4 w-4' />
              </CardHeader>
              <CardContent>
                <Skeleton className='mb-2 h-8 w-24' />
                <Skeleton className='h-3 w-32' />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className='border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-red-700 dark:text-red-300'>
            <AlertCircle className='h-5 w-5' />
            FastAPI Connection Test
          </CardTitle>
          <CardDescription className='text-red-600 dark:text-red-400'>
            {error}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-2 text-sm'>
            <p>
              <strong>Expected behavior:</strong>
            </p>
            <ul className='list-disc space-y-1 pl-4 text-red-600 dark:text-red-400'>
              <li>
                If you see "HTTP 401" or "Authentication required" - this means
                FastAPI is running correctly!
              </li>
              <li>
                If you see "Failed to fetch" - check that FastAPI server is
                running on port 8000
              </li>
              <li>
                Your analytics API should be accessible via Supabase Edge
                Functions
              </li>
            </ul>
          </div>
          <div className='mt-4 flex gap-2'>
            <Button onClick={loadAnalytics} variant='outline' size='sm'>
              Retry Connection
            </Button>
            <Button
              onClick={() =>
                window.open(
                  `${SUPABASE_URL}/dashboard/project/wncpqxwmbxjgxvrpcake/functions`,
                  '_blank'
                )
              }
              variant='outline'
              size='sm'
            >
              Open Edge Functions
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!analytics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Analytics Data</CardTitle>
          <CardDescription>Analytics data could not be loaded.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Success Indicator */}
      <Card className='border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-green-700 dark:text-green-300'>
            <TrendingUp className='h-5 w-5' />
            🎉 FastAPI Integration Successful!
          </CardTitle>
          <CardDescription className='text-green-600 dark:text-green-400'>
            Your React frontend is now connected to FastAPI analytics. Data
            loaded from Python/Pandas processing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex gap-2'>
            <Button
              onClick={() => handleExport('csv')}
              disabled={exporting}
              size='sm'
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button
              onClick={() => handleExport('excel')}
              disabled={exporting}
              variant='outline'
              size='sm'
            >
              Export Excel
            </Button>
            <Button
              onClick={() => handleExport('json')}
              disabled={exporting}
              variant='outline'
              size='sm'
            >
              Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Analytics Cards */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Deliveries
            </CardTitle>
            <Package className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {(analytics.total_deliveries || 0).toLocaleString()}
            </div>
            <p className='text-muted-foreground text-xs'>
              From FastAPI + Pandas analysis
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Pending Deliveries
            </CardTitle>
            <AlertCircle className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold text-orange-600'>
              {(analytics.pending_count || 0).toLocaleString()}
            </div>
            <p className='text-muted-foreground text-xs'>Awaiting processing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Shipped Deliveries
            </CardTitle>
            <Truck className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold text-green-600'>
              {(analytics.final_packed_count || 0).toLocaleString()}
            </div>
            <p className='text-muted-foreground text-xs'>
              Successfully completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Completion Rate
            </CardTitle>
            <TrendingUp className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {(analytics.completion_rate || 0).toFixed(1)}%
            </div>
            <p className='text-muted-foreground text-xs'>
              Daily throughput:{' '}
              {Array.isArray(analytics.daily_throughput)
                ? analytics.daily_throughput[
                    analytics.daily_throughput.length - 1
                  ]?.count || 0
                : analytics.daily_throughput || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Status Breakdown</CardTitle>
          <CardDescription>Distribution of delivery statuses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-wrap gap-2'>
            {Object.entries(analytics.status_breakdown || {}).map(
              ([status, count]) => (
                <Badge key={status} variant='secondary' className='px-3 py-1'>
                  {status}: {count}
                </Badge>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Materials */}
      {analytics.top_materials?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Materials</CardTitle>
            <CardDescription>
              Most frequently processed materials
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              {analytics.top_materials.slice(0, 5).map((material) => (
                <div
                  key={material.material}
                  className='flex items-center justify-between'
                >
                  <div>
                    <p className='font-medium'>{material.material}</p>
                    {material.description && (
                      <p className='text-muted-foreground text-sm'>
                        {material.description}
                      </p>
                    )}
                  </div>
                  <Badge variant='outline'>{material.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refresh Button */}
      <div className='flex justify-end'>
        <Button onClick={loadAnalytics} variant='outline'>
          Refresh Analytics
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
