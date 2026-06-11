// Created and developed by Jai Singh
import { useState } from 'react'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Package,
  Truck,
  FileText,
  Warehouse,
  AlertCircle,
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
import { sapFetch } from '../utils/auth-fetch'

interface GoodsReceiptResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    material_document: string
    material_year: string
    material: string
    quantity: number
    movement_type: string
    plant: string
    storage_location: string
    po_number?: string
  }
}

const MOVEMENT_TYPES = [
  {
    value: '101',
    label: '101 - GR for Purchase Order',
    requiresPO: true,
    description: 'Goods receipt against a purchase order',
  },
  {
    value: '501',
    label: '501 - Receipt without Reference',
    requiresPO: false,
    description: 'Direct stock receipt without PO',
  },
]

export function GoodsReceiptTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<GoodsReceiptResult | null>(null)
  const [formData, setFormData] = useState({
    material: '',
    plant: '1010',
    storage_location: '',
    quantity: 1,
    movement_type: '501',
    po_number: '',
    po_item: '',
    vendor: '',
    batch: '',
    cost_center: '',
  })

  const selectedMvtType = MOVEMENT_TYPES.find(
    (m) => m.value === formData.movement_type
  )

  const createGoodsReceipt = async () => {
    // Validation
    if (!formData.material) {
      toast.error('Validation Error', {
        description: 'Please enter a Material Number',
      })
      return
    }

    if (!formData.plant) {
      toast.error('Validation Error', {
        description: 'Please enter a Plant',
      })
      return
    }

    if (!formData.storage_location) {
      toast.error('Validation Error', {
        description: 'Please enter a Storage Location',
      })
      return
    }

    if (formData.quantity <= 0) {
      toast.error('Validation Error', {
        description: 'Quantity must be greater than 0',
      })
      return
    }

    if (selectedMvtType?.requiresPO && !formData.po_number) {
      toast.error('Validation Error', {
        description: `Movement type ${formData.movement_type} requires a Purchase Order number`,
      })
      return
    }

    // Movement type 501 requires cost center
    if (formData.movement_type === '501' && !formData.cost_center) {
      toast.error('Validation Error', {
        description:
          'Movement type 501 requires a Cost Center for account assignment',
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const response = await sapFetch('/api/sap/goods-receipt', {
        method: 'POST',
        body: JSON.stringify({
          material: formData.material,
          plant: formData.plant,
          storage_location: formData.storage_location,
          quantity: formData.quantity,
          movement_type: formData.movement_type,
          po_number: formData.po_number || null,
          po_item: formData.po_item || null,
          vendor: formData.vendor || null,
          batch: formData.batch || null,
          cost_center: formData.cost_center || null,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success('Goods Receipt Posted', {
          description: `Document ${data.data?.material_document}/${data.data?.material_year} created successfully`,
        })
      } else {
        toast.error('Posting Failed', {
          description: data.error || 'Failed to post Goods Receipt',
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setResult({ success: false, error: errorMessage })
      toast.error('Request Failed', { description: errorMessage })
    } finally {
      setIsLoading(false)
    }
  }

  const clearForm = () => {
    setFormData({
      material: '',
      plant: '1010',
      storage_location: '',
      quantity: 1,
      movement_type: '501',
      po_number: '',
      po_item: '',
      vendor: '',
      batch: '',
      cost_center: '',
    })
    setResult(null)
  }

  return (
    <div className='space-y-6'>
      {/* Main Form */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' />
            Post Goods Receipt
          </CardTitle>
          <CardDescription>
            Fill in the details below and click to post a goods receipt in SAP
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Movement Type Selection */}
          <div className='space-y-3'>
            <Label className='text-base font-semibold'>Movement Type *</Label>
            <div className='grid gap-3 md:grid-cols-2'>
              {MOVEMENT_TYPES.map((mt) => (
                <div
                  key={mt.value}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      movement_type: mt.value,
                      po_number: '',
                      po_item: '',
                    })
                  }
                  className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${
                    formData.movement_type === mt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-muted-foreground/30'
                  }`}
                >
                  <div className='mb-2 flex items-center justify-between'>
                    <Badge
                      variant={
                        formData.movement_type === mt.value
                          ? 'default'
                          : 'outline'
                      }
                    >
                      {mt.value}
                    </Badge>
                    {mt.requiresPO && (
                      <Badge variant='secondary' className='text-xs'>
                        <FileText className='mr-1 h-3 w-3' />
                        Requires PO
                      </Badge>
                    )}
                  </div>
                  <p className='text-sm font-medium'>
                    {mt.label.split(' - ')[1]}
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {mt.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* PO Fields - Only show for 101 */}
          {selectedMvtType?.requiresPO && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20'>
              <div className='mb-3 flex items-center gap-2'>
                <AlertCircle className='h-4 w-4 text-amber-600' />
                <span className='text-sm font-medium text-amber-800 dark:text-amber-200'>
                  Purchase Order Reference Required
                </span>
              </div>
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label
                    htmlFor='po_number'
                    className='flex items-center gap-2'
                  >
                    <FileText className='h-4 w-4' />
                    PO Number *
                  </Label>
                  <Input
                    id='po_number'
                    value={formData.po_number}
                    onChange={(e) =>
                      setFormData({ ...formData, po_number: e.target.value })
                    }
                    placeholder='4500000001'
                    className='font-mono'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='po_item'>PO Line Item</Label>
                  <Input
                    id='po_item'
                    value={formData.po_item}
                    onChange={(e) =>
                      setFormData({ ...formData, po_item: e.target.value })
                    }
                    placeholder='00010 (optional, defaults to first item)'
                    className='font-mono'
                  />
                </div>
              </div>
            </div>
          )}

          {/* Main Fields */}
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='material'>Material Number *</Label>
              <Input
                id='material'
                value={formData.material}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    material: e.target.value.toUpperCase(),
                  })
                }
                placeholder='TESTMAT001'
                className='font-mono'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='quantity'>Quantity *</Label>
              <Input
                id='quantity'
                type='number'
                min='0.001'
                step='0.001'
                value={formData.quantity}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    quantity: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='plant' className='flex items-center gap-2'>
                <Warehouse className='h-4 w-4' />
                Plant *
              </Label>
              <Input
                id='plant'
                value={formData.plant}
                onChange={(e) =>
                  setFormData({ ...formData, plant: e.target.value })
                }
                placeholder='1010'
                className='font-mono'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='storage_location'>Storage Location *</Label>
              <Input
                id='storage_location'
                value={formData.storage_location}
                onChange={(e) =>
                  setFormData({ ...formData, storage_location: e.target.value })
                }
                placeholder='0001'
                className='font-mono'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='vendor'>Vendor (optional)</Label>
              <Input
                id='vendor'
                value={formData.vendor}
                onChange={(e) =>
                  setFormData({ ...formData, vendor: e.target.value })
                }
                placeholder='Vendor number'
                className='font-mono'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='batch'>Batch (optional)</Label>
              <Input
                id='batch'
                value={formData.batch}
                onChange={(e) =>
                  setFormData({ ...formData, batch: e.target.value })
                }
                placeholder='Batch number'
                className='font-mono'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='cost_center'>
                Cost Center{' '}
                {formData.movement_type === '501' ? '*' : '(optional)'}
              </Label>
              <Input
                id='cost_center'
                value={formData.cost_center}
                onChange={(e) =>
                  setFormData({ ...formData, cost_center: e.target.value })
                }
                placeholder={
                  formData.movement_type === '501'
                    ? '0010101101 (required for 501)'
                    : 'Cost center'
                }
                className='font-mono'
              />
              {formData.movement_type === '501' && (
                <p className='text-xs text-amber-600'>
                  Required for movement type 501
                </p>
              )}
            </div>
          </div>

          {/* Summary Preview */}
          <div className='bg-muted/50 rounded-lg p-4'>
            <p className='text-muted-foreground mb-3 text-center text-xs'>
              Preview
            </p>
            <div className='flex flex-wrap items-center justify-center gap-4'>
              <div className='text-center'>
                <Badge variant='default' className='mb-1'>
                  {formData.movement_type}
                </Badge>
                <p className='text-muted-foreground text-xs'>
                  {selectedMvtType?.label.split(' - ')[1]}
                </p>
              </div>

              {selectedMvtType?.requiresPO && formData.po_number && (
                <>
                  <span className='text-muted-foreground'>|</span>
                  <div className='text-center'>
                    <p className='font-mono text-sm font-medium'>
                      {formData.po_number}
                    </p>
                    <p className='text-muted-foreground text-xs'>PO</p>
                  </div>
                </>
              )}

              <span className='text-muted-foreground'>→</span>

              <div className='text-center'>
                <p className='font-mono font-medium'>{formData.quantity} EA</p>
                <p className='text-muted-foreground text-xs'>
                  {formData.material || '----'}
                </p>
              </div>

              <span className='text-muted-foreground'>→</span>

              <div className='text-center'>
                <p className='font-mono font-medium'>
                  {formData.plant}/{formData.storage_location || '----'}
                </p>
                <p className='text-muted-foreground text-xs'>Plant/SLoc</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className='flex flex-col gap-3 sm:flex-row'>
            <Button
              onClick={createGoodsReceipt}
              disabled={isLoading}
              className='flex-1'
              size='lg'
            >
              {isLoading ? (
                <>
                  <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                  Posting Goods Receipt...
                </>
              ) : (
                <>
                  <Truck className='mr-2 h-5 w-5' />
                  Post Goods Receipt (1-Click)
                </>
              )}
            </Button>
            <Button
              onClick={clearForm}
              variant='outline'
              size='lg'
              disabled={isLoading}
            >
              Clear Form
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result Card */}
      {result && (
        <Card
          className={
            result.success
              ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20'
              : 'border-red-500/50 bg-red-50/50 dark:bg-red-950/20'
          }
        >
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {result.success ? (
                <>
                  <CheckCircle2 className='h-6 w-6 text-green-500' />
                  Goods Receipt Posted Successfully
                </>
              ) : (
                <>
                  <XCircle className='h-6 w-6 text-red-500' />
                  Posting Failed
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success && result.data ? (
              <div className='space-y-4'>
                {/* Document Number Highlight */}
                <div className='rounded-lg border bg-white p-4 text-center dark:bg-gray-900'>
                  <p className='text-muted-foreground mb-1 text-sm'>
                    Material Document
                  </p>
                  <p className='font-mono text-3xl font-bold text-green-600 dark:text-green-400'>
                    {result.data.material_document}
                  </p>
                  <p className='text-muted-foreground font-mono text-lg'>
                    / {result.data.material_year}
                  </p>
                </div>

                {/* Details Grid */}
                <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
                  <div className='space-y-1'>
                    <Label className='text-muted-foreground text-xs'>
                      Movement Type
                    </Label>
                    <p className='font-medium'>
                      <Badge variant='secondary'>
                        {result.data.movement_type}
                      </Badge>
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-muted-foreground text-xs'>
                      Material
                    </Label>
                    <p className='font-mono font-medium'>
                      {result.data.material}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-muted-foreground text-xs'>
                      Quantity
                    </Label>
                    <p className='font-medium'>{result.data.quantity} EA</p>
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-muted-foreground text-xs'>
                      Plant
                    </Label>
                    <p className='font-mono font-medium'>{result.data.plant}</p>
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-muted-foreground text-xs'>
                      Storage Location
                    </Label>
                    <p className='font-mono font-medium'>
                      {result.data.storage_location}
                    </p>
                  </div>
                  {result.data.po_number && (
                    <div className='space-y-1'>
                      <Label className='text-muted-foreground text-xs'>
                        PO Number
                      </Label>
                      <p className='font-mono font-medium'>
                        {result.data.po_number}
                      </p>
                    </div>
                  )}
                </div>

                {result.message && (
                  <p className='pt-2 text-center text-sm text-green-600 dark:text-green-400'>
                    {result.message}
                  </p>
                )}
              </div>
            ) : (
              <div className='space-y-2'>
                <Label className='text-sm font-medium text-red-600'>
                  Error Details
                </Label>
                <p className='rounded-lg bg-red-100 p-4 font-mono text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400'>
                  {result.error || result.message || 'Unknown error occurred'}
                </p>
                <p className='text-muted-foreground mt-2 text-xs'>
                  Check SAP system logs (SM21/SLG1) for more details if the
                  error persists.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
