// Created and developed by Jai Singh
import { useState } from 'react'
import {
  Loader2,
  RefreshCw,
  Warehouse,
  Package,
  Database,
  Grid,
} from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sapFetch } from '../utils/auth-fetch'

interface WarehouseInfo {
  warehouse_number: string
  description: string
  source?: string
  plant?: string
  storage_location?: string
  stock_count?: number
}

interface StockItem {
  warehouse: string
  storage_type: string
  storage_bin: string
  material: string
}

interface WarehouseResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    warehouses?: WarehouseInfo[]
    count?: number
    warehouse?: string
    storage_types?: string[]
    stock?: StockItem[]
    stock_count?: number
    tables_checked?: string[]
    notes?: string
  }
}

export function WarehouseDataTab() {
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [warehousesResult, setWarehousesResult] =
    useState<WarehouseResult | null>(null)
  const [detailsResult, setDetailsResult] = useState<WarehouseResult | null>(
    null
  )
  const [selectedWarehouse, setSelectedWarehouse] = useState('034')
  const [includeStockCount, setIncludeStockCount] = useState(true)

  const fetchWarehouses = async () => {
    setIsLoadingWarehouses(true)
    setWarehousesResult(null)

    try {
      const url = `/api/sap/warehouses?include_stock_count=${includeStockCount}`
      const response = await sapFetch(url)
      const data = await response.json()
      setWarehousesResult(data)

      if (data.success) {
        const count = data.data?.count || 0
        if (count > 0) {
          toast.success('Warehouses Retrieved', {
            description: `Found ${count} warehouses`,
          })
        } else {
          toast.info('No Warehouses Found', {
            description:
              data.message || 'No warehouse data available in this SAP system',
          })
        }
      } else {
        toast.error('Retrieval Failed', {
          description: data.error || 'Failed to retrieve warehouses',
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setWarehousesResult({
        success: false,
        error: errorMessage,
      })
      toast.error('Request Failed', {
        description: errorMessage,
      })
    } finally {
      setIsLoadingWarehouses(false)
    }
  }

  const fetchWarehouseDetails = async () => {
    if (!selectedWarehouse) {
      toast.error('Validation Error', {
        description: 'Please enter a warehouse number',
      })
      return
    }

    setIsLoadingDetails(true)
    setDetailsResult(null)

    try {
      const response = await sapFetch(
        `/api/sap/warehouse-data?warehouse=${encodeURIComponent(selectedWarehouse)}`
      )
      const data = await response.json()
      setDetailsResult(data)

      if (data.success) {
        toast.success('Data Retrieved', {
          description: `Retrieved data for warehouse ${selectedWarehouse}`,
        })
      } else {
        toast.error('Retrieval Failed', {
          description: data.error || 'Failed to retrieve warehouse data',
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setDetailsResult({
        success: false,
        error: errorMessage,
      })
      toast.error('Request Failed', {
        description: errorMessage,
      })
    } finally {
      setIsLoadingDetails(false)
    }
  }

  return (
    <div className='space-y-6'>
      <Tabs defaultValue='warehouses' className='w-full'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='warehouses'>Warehouses</TabsTrigger>
          <TabsTrigger value='details'>Warehouse Details</TabsTrigger>
        </TabsList>

        {/* Warehouses Tab */}
        <TabsContent value='warehouses' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Warehouse className='h-5 w-5' />
                Warehouse List
              </CardTitle>
              <CardDescription>
                View all warehouses configured in the SAP system
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-col gap-4 sm:flex-row sm:items-center'>
                <Button
                  onClick={fetchWarehouses}
                  disabled={isLoadingWarehouses}
                >
                  {isLoadingWarehouses ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {includeStockCount
                        ? 'Loading with Stock Counts...'
                        : 'Loading...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className='mr-2 h-4 w-4' />
                      Fetch Warehouses
                    </>
                  )}
                </Button>
                <div className='flex items-center space-x-2'>
                  <Switch
                    id='include-stock'
                    checked={includeStockCount}
                    onCheckedChange={setIncludeStockCount}
                  />
                  <Label htmlFor='include-stock' className='text-sm'>
                    Include Stock Counts
                    <span className='text-muted-foreground ml-1'>(slower)</span>
                  </Label>
                </div>
              </div>
              {includeStockCount && (
                <p className='text-muted-foreground text-xs'>
                  Stock counts show which warehouses have inventory. Warehouses
                  with stock &gt; 0 can be used for testing TO creation.
                </p>
              )}
            </CardContent>
          </Card>

          {warehousesResult?.success &&
            warehousesResult.data?.warehouses &&
            warehousesResult.data.warehouses.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Warehouses</CardTitle>
                  <CardDescription>
                    {warehousesResult.data.count} warehouses found
                    {warehousesResult.data.tables_checked && (
                      <span className='ml-2 text-xs'>
                        (from: {warehousesResult.data.tables_checked.join(', ')}
                        )
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='rounded-md border'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Warehouse Number</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className='text-right'>
                            Stock Count
                          </TableHead>
                          <TableHead className='text-right'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {warehousesResult.data.warehouses.map((wh) => (
                          <TableRow key={wh.warehouse_number}>
                            <TableCell>
                              <Badge variant='outline' className='font-mono'>
                                {wh.warehouse_number}
                              </Badge>
                            </TableCell>
                            <TableCell>{wh.description || '-'}</TableCell>
                            <TableCell>
                              <Badge variant='secondary' className='text-xs'>
                                {wh.source || 'Unknown'}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-right'>
                              {wh.stock_count !== undefined ? (
                                <Badge
                                  variant={
                                    wh.stock_count > 0 ? 'default' : 'outline'
                                  }
                                  className={
                                    wh.stock_count > 0 ? 'bg-green-600' : ''
                                  }
                                >
                                  {wh.stock_count.toLocaleString()}
                                </Badge>
                              ) : (
                                <span className='text-muted-foreground'>-</span>
                              )}
                            </TableCell>
                            <TableCell className='text-right'>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => {
                                  setSelectedWarehouse(wh.warehouse_number)
                                }}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

          {/* No warehouses found but successful response */}
          {warehousesResult?.success &&
            warehousesResult.data?.warehouses &&
            warehousesResult.data.warehouses.length === 0 && (
              <Card className='border-yellow-500/50'>
                <CardContent className='pt-6'>
                  <div className='space-y-4 text-center'>
                    <Warehouse className='mx-auto h-12 w-12 text-yellow-500' />
                    <div>
                      <h3 className='text-lg font-medium'>
                        No Warehouses Found
                      </h3>
                      <p className='text-muted-foreground mt-2 text-sm'>
                        {warehousesResult.message ||
                          warehousesResult.data?.notes ||
                          'No warehouse data available in this SAP system.'}
                      </p>
                    </div>
                    {warehousesResult.data?.tables_checked && (
                      <div className='text-muted-foreground bg-muted rounded-lg p-3 text-xs'>
                        <strong>Tables checked:</strong>{' '}
                        {warehousesResult.data.tables_checked.join(', ')}
                      </div>
                    )}
                    <p className='text-muted-foreground text-sm'>
                      This may indicate that Warehouse Management (WM) or
                      Extended Warehouse Management (EWM) is not configured on
                      this SAP system.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

          {warehousesResult && !warehousesResult.success && (
            <Card className='border-red-500/50'>
              <CardContent className='pt-6'>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium text-red-600'>
                    Error
                  </Label>
                  <p className='rounded bg-red-50 p-3 font-mono text-sm text-red-500 dark:bg-red-950/20'>
                    {warehousesResult.error || 'Failed to retrieve warehouses'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Warehouse Details Tab */}
        <TabsContent value='details' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Database className='h-5 w-5' />
                Warehouse Details
              </CardTitle>
              <CardDescription>
                View storage types and stock for a specific warehouse
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-col gap-4 md:flex-row'>
                <div className='flex-1 space-y-2'>
                  <Label htmlFor='warehouse-select'>Warehouse Number</Label>
                  <Input
                    id='warehouse-select'
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    placeholder='034'
                  />
                </div>
                <div className='flex items-end'>
                  <Button
                    onClick={fetchWarehouseDetails}
                    disabled={isLoadingDetails}
                  >
                    {isLoadingDetails ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Loading...
                      </>
                    ) : (
                      <>
                        <RefreshCw className='mr-2 h-4 w-4' />
                        Fetch Details
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {detailsResult?.success && detailsResult.data && (
            <>
              {/* Storage Types */}
              {detailsResult.data.storage_types &&
                detailsResult.data.storage_types.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className='flex items-center gap-2'>
                        <Grid className='h-5 w-5' />
                        Storage Types
                      </CardTitle>
                      <CardDescription>
                        Storage types configured for warehouse{' '}
                        {selectedWarehouse}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className='flex flex-wrap gap-2'>
                        {detailsResult.data.storage_types.map((st) => (
                          <Badge
                            key={st}
                            variant='secondary'
                            className='font-mono'
                          >
                            {st}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Stock */}
              {detailsResult.data.stock &&
                detailsResult.data.stock.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className='flex items-center gap-2'>
                        <Package className='h-5 w-5' />
                        Stock / Quants
                      </CardTitle>
                      <CardDescription>
                        {detailsResult.data.stock_count} stock items in
                        warehouse {selectedWarehouse}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className='rounded-md border'>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Storage Type</TableHead>
                              <TableHead>Storage Bin</TableHead>
                              <TableHead>Material</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detailsResult.data.stock
                              .slice(0, 50)
                              .map((item, idx) => (
                                <TableRow
                                  key={`${item.storage_type}-${item.storage_bin}-${item.material}-${idx}`}
                                >
                                  <TableCell>
                                    <Badge variant='outline'>
                                      {item.storage_type}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className='font-mono'>
                                    {item.storage_bin}
                                  </TableCell>
                                  <TableCell className='font-mono'>
                                    {item.material}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                      {(detailsResult.data.stock_count || 0) > 50 && (
                        <p className='text-muted-foreground mt-4 text-center text-sm'>
                          Showing first 50 of {detailsResult.data.stock_count}{' '}
                          stock items
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

              {/* Empty Stock */}
              {detailsResult.data.stock &&
                detailsResult.data.stock.length === 0 && (
                  <Card>
                    <CardContent className='py-10 text-center'>
                      <Package className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
                      <h3 className='text-lg font-medium'>No Stock Found</h3>
                      <p className='text-muted-foreground'>
                        No stock items found in warehouse {selectedWarehouse}
                      </p>
                    </CardContent>
                  </Card>
                )}
            </>
          )}

          {detailsResult && !detailsResult.success && (
            <Card className='border-red-500/50'>
              <CardContent className='pt-6'>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium text-red-600'>
                    Error
                  </Label>
                  <p className='rounded bg-red-50 p-3 font-mono text-sm text-red-500 dark:bg-red-950/20'>
                    {detailsResult.error || 'Failed to retrieve warehouse data'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Created and developed by Jai Singh
