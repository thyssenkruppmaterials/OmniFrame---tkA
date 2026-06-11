// Created and developed by Jai Singh
import { useState } from 'react'
import { Loader2, RefreshCw, Package, Warehouse, Filter } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { sapFetch } from '../utils/auth-fetch'

interface TransferOrder {
  warehouse: string
  to_number: string
  status: string
}

interface OpenTOsResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    transfer_orders: TransferOrder[]
    by_warehouse: Record<string, TransferOrder[]>
    total_count: number
  }
}

export function OpenTOsTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<OpenTOsResult | null>(null)
  const [warehouseFilter, setWarehouseFilter] = useState('')

  const fetchOpenTOs = async () => {
    setIsLoading(true)
    setResult(null)

    try {
      const url = warehouseFilter
        ? `/api/sap/open-tos?warehouse=${encodeURIComponent(warehouseFilter)}`
        : '/api/sap/open-tos'

      const response = await sapFetch(url)
      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success('Data Retrieved', {
          description: `Found ${data.data?.total_count || 0} open Transfer Orders`,
        })
      } else {
        toast.error('Retrieval Failed', {
          description: data.error || 'Failed to retrieve open TOs',
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setResult({
        success: false,
        error: errorMessage,
      })
      toast.error('Request Failed', {
        description: errorMessage,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const getWarehouseSummary = () => {
    if (!result?.data?.by_warehouse) return []
    return Object.entries(result.data.by_warehouse).map(([warehouse, tos]) => ({
      warehouse,
      count: tos.length,
    }))
  }

  return (
    <div className='space-y-6'>
      {/* Filter and Refresh */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' />
            Open Transfer Orders
          </CardTitle>
          <CardDescription>
            View unconfirmed Transfer Orders across warehouses
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-col gap-4 md:flex-row'>
            <div className='flex-1 space-y-2'>
              <Label
                htmlFor='warehouse-filter'
                className='flex items-center gap-2'
              >
                <Filter className='h-4 w-4' />
                Filter by Warehouse (optional)
              </Label>
              <Input
                id='warehouse-filter'
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                placeholder='Leave empty for all warehouses'
              />
            </div>
            <div className='flex items-end'>
              <Button onClick={fetchOpenTOs} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className='mr-2 h-4 w-4' />
                    Fetch Open TOs
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {result?.success && result.data && (
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                Total Open TOs
              </CardTitle>
              <Package className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {result.data.total_count}
              </div>
              <p className='text-muted-foreground text-xs'>
                Unconfirmed transfer orders
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Warehouses</CardTitle>
              <Warehouse className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>
                {Object.keys(result.data.by_warehouse || {}).length}
              </div>
              <p className='text-muted-foreground text-xs'>With open TOs</p>
            </CardContent>
          </Card>

          {getWarehouseSummary()
            .slice(0, 2)
            .map(({ warehouse, count }) => (
              <Card key={warehouse}>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='text-sm font-medium'>
                    WH {warehouse}
                  </CardTitle>
                  <Badge variant='secondary'>{count}</Badge>
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{count}</div>
                  <p className='text-muted-foreground text-xs'>
                    Open TOs in warehouse {warehouse}
                  </p>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Transfer Orders Table */}
      {result?.success &&
        result.data &&
        result.data.transfer_orders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Transfer Order List</CardTitle>
              <CardDescription>
                {result.data.total_count} open transfer orders found
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>TO Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.transfer_orders.slice(0, 50).map((to, idx) => (
                      <TableRow key={`${to.warehouse}-${to.to_number}-${idx}`}>
                        <TableCell>
                          <Badge variant='outline'>{to.warehouse}</Badge>
                        </TableCell>
                        <TableCell className='font-mono'>
                          {to.to_number}
                        </TableCell>
                        <TableCell>
                          <Badge variant='secondary'>{to.status}</Badge>
                        </TableCell>
                        <TableCell className='text-right'>
                          <Button size='sm' variant='outline'>
                            Confirm
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.data.total_count > 50 && (
                <p className='text-muted-foreground mt-4 text-center text-sm'>
                  Showing first 50 of {result.data.total_count} transfer orders
                </p>
              )}
            </CardContent>
          </Card>
        )}

      {/* Warehouse Summary */}
      {result?.success &&
        result.data &&
        Object.keys(result.data.by_warehouse || {}).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>By Warehouse</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
                {getWarehouseSummary().map(({ warehouse, count }) => (
                  <div
                    key={warehouse}
                    className='bg-muted/50 flex items-center justify-between rounded-lg p-3'
                  >
                    <div className='flex items-center gap-2'>
                      <Warehouse className='text-muted-foreground h-4 w-4' />
                      <span className='font-medium'>Warehouse {warehouse}</span>
                    </div>
                    <Badge>{count} TOs</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Empty State */}
      {result?.success && result.data?.total_count === 0 && (
        <Card>
          <CardContent className='py-10 text-center'>
            <Package className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
            <h3 className='text-lg font-medium'>No Open Transfer Orders</h3>
            <p className='text-muted-foreground'>
              {warehouseFilter
                ? `No open TOs found in warehouse ${warehouseFilter}`
                : 'No open transfer orders found in the system'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {result && !result.success && (
        <Card className='border-red-500/50'>
          <CardContent className='pt-6'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium text-red-600'>Error</Label>
              <p className='rounded bg-red-50 p-3 font-mono text-sm text-red-500 dark:bg-red-950/20'>
                {result.error || 'Failed to retrieve open transfer orders'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
