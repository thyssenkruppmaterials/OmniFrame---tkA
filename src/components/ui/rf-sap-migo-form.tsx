// Created and developed by Jai Singh
'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  RotateCcw,
  Truck,
  Warehouse,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import { sapFetch } from '@/features/admin/sap-testing/utils/auth-fetch'
import { RFScreenHeader } from '@/features/rf-interface/_shell'

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

interface MovementType {
  value: string
  label: string
  shortLabel: string
  requiresPO: boolean
  description: string
}

const MOVEMENT_TYPES: MovementType[] = [
  {
    value: '101',
    label: '101 - GR for Purchase Order',
    shortLabel: '101 - PO',
    requiresPO: true,
    description: 'Goods receipt against a purchase order',
  },
  {
    value: '501',
    label: '501 - Receipt without Reference',
    shortLabel: '501 - Direct',
    requiresPO: false,
    description: 'Direct stock receipt without PO',
  },
]

interface RFSAPMigoFormProps {
  onBack?: () => void
}

const RFSAPMigoForm: React.FC<RFSAPMigoFormProps> = ({ onBack }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<GoodsReceiptResult | null>(null)
  const [formData, setFormData] = useState({
    material: '',
    plant: '1010',
    storage_location: '',
    quantity: '1',
    movement_type: '501',
    po_number: '',
    po_item: '',
    batch: '',
    cost_center: '',
  })

  // Field refs for auto-advance
  const materialRef = useRef<HTMLInputElement>(null)
  const plantRef = useRef<HTMLInputElement>(null)
  const storageLocationRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const poNumberRef = useRef<HTMLInputElement>(null)
  const poItemRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<HTMLInputElement>(null)
  const costCenterRef = useRef<HTMLInputElement>(null)

  const selectedMvtType = MOVEMENT_TYPES.find(
    (m) => m.value === formData.movement_type
  )

  // Auto-focus material field on mount
  useEffect(() => {
    setTimeout(() => {
      materialRef.current?.focus()
    }, 100)
  }, [])

  // Auto-advance timer
  const autoAdvanceDelay = 800
  const [timers, setTimers] = useState(new Map<string, NodeJS.Timeout>())

  // Clear timer helper
  const clearTimer = (field: string) => {
    const timer = timers.get(field)
    if (timer) {
      clearTimeout(timer)
      setTimers((prev) => {
        const newTimers = new Map(prev)
        newTimers.delete(field)
        return newTimers
      })
    }
  }

  // Field completion detection
  const isFieldComplete = (value: string, field: string): boolean => {
    const trimmed = value.trim()
    switch (field) {
      case 'material':
        return trimmed.length >= 3
      case 'plant':
        return trimmed.length >= 2
      case 'storage_location':
        return trimmed.length >= 2
      case 'quantity':
        return (
          trimmed.length > 0 &&
          !isNaN(parseFloat(trimmed)) &&
          parseFloat(trimmed) > 0
        )
      case 'po_number':
        return trimmed.length >= 6
      case 'po_item':
        return trimmed.length >= 2
      case 'batch':
        return trimmed.length >= 2
      case 'cost_center':
        return trimmed.length >= 4
      default:
        return false
    }
  }

  // Handle field change with auto-advance
  const handleFieldChange = (field: string, value: string) => {
    clearTimer(field)

    const updatedValue = field === 'material' ? value.toUpperCase() : value
    setFormData((prev) => ({ ...prev, [field]: updatedValue }))

    // Set auto-advance timer
    if (isFieldComplete(updatedValue, field)) {
      const timer = setTimeout(() => {
        moveToNextField(field)
      }, autoAdvanceDelay)
      setTimers((prev) => new Map(prev).set(field, timer))
    }
  }

  // Move to next field
  const moveToNextField = (currentField: string) => {
    const requiresPO = selectedMvtType?.requiresPO
    const requires501CostCenter = formData.movement_type === '501'

    const fieldOrder = requiresPO
      ? [
          'material',
          'plant',
          'storage_location',
          'quantity',
          'po_number',
          'po_item',
          'batch',
        ]
      : requires501CostCenter
        ? [
            'material',
            'plant',
            'storage_location',
            'quantity',
            'batch',
            'cost_center',
          ]
        : ['material', 'plant', 'storage_location', 'quantity', 'batch']

    const refMap: Record<string, React.RefObject<HTMLInputElement | null>> = {
      material: materialRef,
      plant: plantRef,
      storage_location: storageLocationRef,
      quantity: quantityRef,
      po_number: poNumberRef,
      po_item: poItemRef,
      batch: batchRef,
      cost_center: costCenterRef,
    }

    const currentIndex = fieldOrder.indexOf(currentField)
    if (currentIndex < fieldOrder.length - 1) {
      const nextField = fieldOrder[currentIndex + 1]
      refMap[nextField]?.current?.focus()
    }
  }

  // Handle key press for manual advance
  const handleKeyPress = (e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimer(field)
      moveToNextField(field)
    }
  }

  // Create goods receipt
  const createGoodsReceipt = async () => {
    // Validation
    if (!formData.material.trim()) {
      toast.error('Please enter a Material Number')
      materialRef.current?.focus()
      return
    }

    if (!formData.plant.trim()) {
      toast.error('Please enter a Plant')
      plantRef.current?.focus()
      return
    }

    if (!formData.storage_location.trim()) {
      toast.error('Please enter a Storage Location')
      storageLocationRef.current?.focus()
      return
    }

    const qty = parseFloat(formData.quantity)
    if (isNaN(qty) || qty <= 0) {
      toast.error('Quantity must be greater than 0')
      quantityRef.current?.focus()
      return
    }

    if (selectedMvtType?.requiresPO && !formData.po_number.trim()) {
      toast.error(
        `Movement type ${formData.movement_type} requires a PO number`
      )
      poNumberRef.current?.focus()
      return
    }

    if (formData.movement_type === '501' && !formData.cost_center.trim()) {
      toast.error('Movement type 501 requires a Cost Center')
      costCenterRef.current?.focus()
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const response = await sapFetch('/api/sap/goods-receipt', {
        method: 'POST',
        body: JSON.stringify({
          material: formData.material.trim(),
          plant: formData.plant.trim(),
          storage_location: formData.storage_location.trim(),
          quantity: qty,
          movement_type: formData.movement_type,
          po_number: formData.po_number.trim() || null,
          po_item: formData.po_item.trim() || null,
          batch: formData.batch.trim() || null,
          cost_center: formData.cost_center.trim() || null,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success(
          `Document ${data.data?.material_document}/${data.data?.material_year} created`
        )
      } else {
        toast.error(data.error || 'Failed to post Goods Receipt')
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setResult({ success: false, error: errorMessage })
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Clear form
  const clearForm = () => {
    setFormData({
      material: '',
      plant: '1010',
      storage_location: '',
      quantity: '1',
      movement_type: formData.movement_type, // Keep movement type
      po_number: '',
      po_item: '',
      batch: '',
      cost_center: '',
    })
    setResult(null)
    toast.success('Form cleared')
    setTimeout(() => {
      materialRef.current?.focus()
    }, 100)
  }

  // Reset form completely (new transaction)
  const newTransaction = () => {
    setFormData({
      material: '',
      plant: '1010',
      storage_location: '',
      quantity: '1',
      movement_type: '501',
      po_number: '',
      po_item: '',
      batch: '',
      cost_center: '',
    })
    setResult(null)
    setTimeout(() => {
      materialRef.current?.focus()
    }, 100)
  }

  return (
    <div className='mx-auto flex w-full max-w-md flex-1 flex-col space-y-3 overflow-y-auto p-2'>
      {/* Header Card */}
      <Card>
        <CardHeader className='px-3 pt-3 pb-2'>
          <RFScreenHeader
            title='SAP MIGO'
            subtitle='Direct posting'
            onBack={onBack}
            right={<Package className='text-muted-foreground h-4 w-4' />}
          />
        </CardHeader>
      </Card>

      {/* Movement Type Selection */}
      <Card>
        <CardContent className='space-y-2 p-3'>
          <Label className='text-xs font-semibold'>Movement Type</Label>
          <div className='grid grid-cols-2 gap-2'>
            {MOVEMENT_TYPES.map((mt) => (
              <Button
                key={mt.value}
                variant={
                  formData.movement_type === mt.value ? 'default' : 'outline'
                }
                size='sm'
                onClick={() =>
                  setFormData({
                    ...formData,
                    movement_type: mt.value,
                    po_number: '',
                    po_item: '',
                  })
                }
                className={cn(
                  'flex h-auto flex-col items-center justify-center px-2 py-2',
                  formData.movement_type === mt.value
                    ? 'bg-primary text-primary-foreground'
                    : ''
                )}
              >
                <Badge
                  variant={
                    formData.movement_type === mt.value
                      ? 'secondary'
                      : 'outline'
                  }
                  className='mb-1 text-xs'
                >
                  {mt.value}
                </Badge>
                <span className='text-center text-[10px] leading-tight'>
                  {mt.shortLabel.split(' - ')[1]}
                </span>
              </Button>
            ))}
          </div>
          <p className='text-muted-foreground mt-1 text-center text-[10px]'>
            {selectedMvtType?.description}
          </p>
        </CardContent>
      </Card>

      {/* PO Fields - Only for 101 */}
      {selectedMvtType?.requiresPO && (
        <Card className='border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'>
          <CardContent className='space-y-3 p-3'>
            <div className='flex items-center gap-2'>
              <AlertCircle className='h-4 w-4 text-amber-600' />
              <span className='text-xs font-medium text-amber-800 dark:text-amber-200'>
                PO Reference Required
              </span>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <Label
                  htmlFor='po_number'
                  className='flex items-center gap-1 text-xs'
                >
                  <FileText className='h-3 w-3' />
                  PO Number *
                </Label>
                <ScannerInput
                  ref={poNumberRef}
                  id='po_number'
                  value={formData.po_number}
                  onChange={(e) =>
                    handleFieldChange('po_number', e.target.value)
                  }
                  onKeyDown={(e) => handleKeyPress(e, 'po_number')}
                  placeholder='4500000001'
                  className='h-9 text-center font-mono text-xs'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='po_item' className='text-xs'>
                  PO Item
                </Label>
                <ScannerInput
                  ref={poItemRef}
                  id='po_item'
                  value={formData.po_item}
                  onChange={(e) => handleFieldChange('po_item', e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, 'po_item')}
                  placeholder='00010'
                  className='h-9 text-center font-mono text-xs'
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Form Fields */}
      <Card>
        <CardContent className='space-y-3 p-3'>
          {/* Material & Quantity Row */}
          <div className='grid grid-cols-2 gap-2'>
            <div className='space-y-1'>
              <Label htmlFor='material' className='text-xs'>
                Material # *
              </Label>
              <ScannerInput
                ref={materialRef}
                id='material'
                value={formData.material}
                onChange={(e) => handleFieldChange('material', e.target.value)}
                onKeyDown={(e) => handleKeyPress(e, 'material')}
                placeholder='TESTMAT001'
                className='h-9 text-center font-mono text-xs'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='quantity' className='text-xs'>
                Quantity *
              </Label>
              <ScannerInput
                ref={quantityRef}
                id='quantity'
                type='number'
                min='0.001'
                step='0.001'
                value={formData.quantity}
                onChange={(e) => handleFieldChange('quantity', e.target.value)}
                onKeyDown={(e) => handleKeyPress(e, 'quantity')}
                placeholder='1'
                className='h-9 text-center font-mono text-xs'
              />
            </div>
          </div>

          {/* Plant & Storage Location Row */}
          <div className='grid grid-cols-2 gap-2'>
            <div className='space-y-1'>
              <Label
                htmlFor='plant'
                className='flex items-center gap-1 text-xs'
              >
                <Warehouse className='h-3 w-3' />
                Plant *
              </Label>
              <ScannerInput
                ref={plantRef}
                id='plant'
                value={formData.plant}
                onChange={(e) => handleFieldChange('plant', e.target.value)}
                onKeyDown={(e) => handleKeyPress(e, 'plant')}
                placeholder='1010'
                className='h-9 text-center font-mono text-xs'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='storage_location' className='text-xs'>
                Storage Loc *
              </Label>
              <ScannerInput
                ref={storageLocationRef}
                id='storage_location'
                value={formData.storage_location}
                onChange={(e) =>
                  handleFieldChange('storage_location', e.target.value)
                }
                onKeyDown={(e) => handleKeyPress(e, 'storage_location')}
                placeholder='0001'
                className='h-9 text-center font-mono text-xs'
              />
            </div>
          </div>

          {/* Batch */}
          <div className='space-y-1'>
            <Label htmlFor='batch' className='text-xs'>
              Batch (optional)
            </Label>
            <ScannerInput
              ref={batchRef}
              id='batch'
              value={formData.batch}
              onChange={(e) => handleFieldChange('batch', e.target.value)}
              onKeyDown={(e) => handleKeyPress(e, 'batch')}
              placeholder='Batch number'
              className='h-9 text-center font-mono text-xs'
            />
          </div>

          {/* Cost Center - Only for 501 */}
          {formData.movement_type === '501' && (
            <div className='space-y-1'>
              <Label htmlFor='cost_center' className='text-xs'>
                Cost Center *
              </Label>
              <ScannerInput
                ref={costCenterRef}
                id='cost_center'
                value={formData.cost_center}
                onChange={(e) =>
                  handleFieldChange('cost_center', e.target.value)
                }
                onKeyDown={(e) => handleKeyPress(e, 'cost_center')}
                placeholder='0010101101'
                className='h-9 text-center font-mono text-xs'
              />
              <p className='text-[10px] text-amber-600'>Required for 501</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Summary */}
      <Card className='bg-muted/50'>
        <CardContent className='p-3'>
          <p className='text-muted-foreground mb-2 text-center text-[10px]'>
            Preview
          </p>
          <div className='flex flex-wrap items-center justify-center gap-2 text-xs'>
            <Badge variant='default'>{formData.movement_type}</Badge>
            {selectedMvtType?.requiresPO && formData.po_number && (
              <>
                <span className='text-muted-foreground'>|</span>
                <span className='font-mono'>{formData.po_number}</span>
              </>
            )}
            <span className='text-muted-foreground'>→</span>
            <span className='font-mono font-medium'>
              {formData.quantity || '0'} EA
            </span>
            <span className='text-muted-foreground font-mono'>
              {formData.material || '----'}
            </span>
            <span className='text-muted-foreground'>→</span>
            <span className='font-mono'>
              {formData.plant}/{formData.storage_location || '----'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className='flex gap-2'>
        <Button
          onClick={createGoodsReceipt}
          disabled={isLoading}
          className='h-11 flex-1'
        >
          {isLoading ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Posting...
            </>
          ) : (
            <>
              <Truck className='mr-2 h-4 w-4' />
              Post GR
            </>
          )}
        </Button>
        <Button
          onClick={clearForm}
          variant='outline'
          disabled={isLoading}
          className='h-11'
        >
          <RotateCcw className='h-4 w-4' />
        </Button>
      </div>

      {/* Result Display */}
      {result && (
        <Card
          className={cn(
            result.success
              ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20'
              : 'border-red-500/50 bg-red-50/50 dark:bg-red-950/20'
          )}
        >
          <CardContent className='p-3'>
            {result.success && result.data ? (
              <div className='space-y-3'>
                {/* Success Header */}
                <div className='flex items-center justify-center gap-2'>
                  <CheckCircle2 className='h-5 w-5 text-green-500' />
                  <span className='text-sm font-semibold text-green-700 dark:text-green-300'>
                    GR Posted Successfully
                  </span>
                </div>

                {/* Document Number - Highlighted */}
                <div className='rounded-lg border bg-white p-3 text-center dark:bg-gray-900'>
                  <p className='text-muted-foreground mb-1 text-[10px]'>
                    Material Document
                  </p>
                  <p className='font-mono text-2xl font-bold text-green-600 dark:text-green-400'>
                    {result.data.material_document}
                  </p>
                  <p className='text-muted-foreground font-mono text-sm'>
                    / {result.data.material_year}
                  </p>
                </div>

                {/* Details Grid */}
                <div className='grid grid-cols-2 gap-2 text-xs'>
                  <div className='space-y-0.5'>
                    <p className='text-muted-foreground'>Movement Type</p>
                    <Badge variant='secondary'>
                      {result.data.movement_type}
                    </Badge>
                  </div>
                  <div className='space-y-0.5'>
                    <p className='text-muted-foreground'>Quantity</p>
                    <p className='font-medium'>{result.data.quantity} EA</p>
                  </div>
                  <div className='space-y-0.5'>
                    <p className='text-muted-foreground'>Material</p>
                    <p className='font-mono'>{result.data.material}</p>
                  </div>
                  <div className='space-y-0.5'>
                    <p className='text-muted-foreground'>Plant/SLoc</p>
                    <p className='font-mono'>
                      {result.data.plant}/{result.data.storage_location}
                    </p>
                  </div>
                  {result.data.po_number && (
                    <div className='col-span-2 space-y-0.5'>
                      <p className='text-muted-foreground'>PO Number</p>
                      <p className='font-mono'>{result.data.po_number}</p>
                    </div>
                  )}
                </div>

                {/* New Transaction Button */}
                <Button
                  onClick={newTransaction}
                  variant='outline'
                  className='h-10 w-full'
                >
                  <Package className='mr-2 h-4 w-4' />
                  New Transaction
                </Button>
              </div>
            ) : (
              <div className='space-y-3'>
                {/* Error Header */}
                <div className='flex items-center justify-center gap-2'>
                  <XCircle className='h-5 w-5 text-red-500' />
                  <span className='text-sm font-semibold text-red-700 dark:text-red-300'>
                    Posting Failed
                  </span>
                </div>

                {/* Error Message */}
                <div className='rounded-lg bg-red-100 p-3 dark:bg-red-950/40'>
                  <p className='font-mono text-xs break-words text-red-600 dark:text-red-400'>
                    {result.error || result.message || 'Unknown error occurred'}
                  </p>
                </div>

                <p className='text-muted-foreground text-center text-[10px]'>
                  Check SAP logs (SM21/SLG1) for details
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bottom spacing for dock */}
      <div className='h-4' />
    </div>
  )
}

export default RFSAPMigoForm

// Created and developed by Jai Singh
