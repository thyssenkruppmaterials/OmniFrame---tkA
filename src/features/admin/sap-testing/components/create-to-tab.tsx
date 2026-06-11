// Created and developed by Jai Singh
import { useState } from 'react'
import {
  Loader2,
  Package,
  CheckCircle2,
  XCircle,
  Warehouse,
  ArrowRight,
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

interface CreateTOResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    to_number: string
    warehouse: string
    material: string
    quantity: number
    return_code?: number
  }
}

export function CreateTOTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<CreateTOResult | null>(null)
  const [formData, setFormData] = useState({
    warehouse: '034',
    material: '',
    quantity: 1,
    source_storage_type: '',
    source_storage_bin: '',
    dest_storage_type: '',
    dest_storage_bin: '',
    movement_type: '999',
    plant: '1010',
    storage_location: '',
  })

  const createTransferOrder = async () => {
    if (
      !formData.material ||
      !formData.source_storage_type ||
      !formData.dest_storage_type
    ) {
      toast.error('Validation Error', {
        description: 'Please fill in all required fields',
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const response = await sapFetch('/api/sap/create-to', {
        method: 'POST',
        body: JSON.stringify(formData),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success('Transfer Order Created', {
          description: `TO ${data.data?.to_number} created successfully`,
        })
      } else {
        toast.error('Creation Failed', {
          description: data.error || 'Failed to create Transfer Order',
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

  return (
    <div className='space-y-6'>
      {/* Create TO Form */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' />
            Create Transfer Order
          </CardTitle>
          <CardDescription>
            Create a new Transfer Order in SAP WM/EWM
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='warehouse' className='flex items-center gap-2'>
                <Warehouse className='h-4 w-4' />
                Warehouse Number *
              </Label>
              <Input
                id='warehouse'
                value={formData.warehouse}
                onChange={(e) =>
                  setFormData({ ...formData, warehouse: e.target.value })
                }
                placeholder='034'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='plant'>Plant</Label>
              <Input
                id='plant'
                value={formData.plant}
                onChange={(e) =>
                  setFormData({ ...formData, plant: e.target.value })
                }
                placeholder='1010'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='material'>Material Number *</Label>
              <Input
                id='material'
                value={formData.material}
                onChange={(e) =>
                  setFormData({ ...formData, material: e.target.value })
                }
                placeholder='TESTMAT001'
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
                placeholder='1'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='source_storage_type'>Source Storage Type *</Label>
              <Input
                id='source_storage_type'
                value={formData.source_storage_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    source_storage_type: e.target.value,
                  })
                }
                placeholder='004'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='source_storage_bin'>Source Storage Bin</Label>
              <Input
                id='source_storage_bin'
                value={formData.source_storage_bin}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    source_storage_bin: e.target.value,
                  })
                }
                placeholder='B-001 (optional)'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='dest_storage_type'>
                Destination Storage Type *
              </Label>
              <Input
                id='dest_storage_type'
                value={formData.dest_storage_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    dest_storage_type: e.target.value,
                  })
                }
                placeholder='004'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='dest_storage_bin'>Destination Storage Bin</Label>
              <Input
                id='dest_storage_bin'
                value={formData.dest_storage_bin}
                onChange={(e) =>
                  setFormData({ ...formData, dest_storage_bin: e.target.value })
                }
                placeholder='B-002 (optional)'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='movement_type'>Movement Type</Label>
              <Input
                id='movement_type'
                value={formData.movement_type}
                onChange={(e) =>
                  setFormData({ ...formData, movement_type: e.target.value })
                }
                placeholder='999'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='storage_location'>Storage Location</Label>
              <Input
                id='storage_location'
                value={formData.storage_location}
                onChange={(e) =>
                  setFormData({ ...formData, storage_location: e.target.value })
                }
                placeholder='(optional)'
              />
            </div>
          </div>

          {/* Visual representation of transfer */}
          <div className='bg-muted/50 flex items-center justify-center gap-4 rounded-lg py-4'>
            <div className='text-center'>
              <Badge variant='outline' className='mb-1 text-xs'>
                Source
              </Badge>
              <p className='font-mono text-sm'>
                {formData.source_storage_type || '----'}
              </p>
              {formData.source_storage_bin && (
                <p className='text-muted-foreground font-mono text-xs'>
                  {formData.source_storage_bin}
                </p>
              )}
            </div>
            <ArrowRight className='text-muted-foreground h-6 w-6' />
            <div className='text-center'>
              <Badge variant='outline' className='mb-1 text-xs'>
                Destination
              </Badge>
              <p className='font-mono text-sm'>
                {formData.dest_storage_type || '----'}
              </p>
              {formData.dest_storage_bin && (
                <p className='text-muted-foreground font-mono text-xs'>
                  {formData.dest_storage_bin}
                </p>
              )}
            </div>
          </div>

          <Button
            onClick={createTransferOrder}
            disabled={isLoading}
            className='w-full md:w-auto'
          >
            {isLoading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Creating Transfer Order...
              </>
            ) : (
              <>
                <Package className='mr-2 h-4 w-4' />
                Create Transfer Order
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card
          className={
            result.success ? 'border-green-500/50' : 'border-red-500/50'
          }
        >
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {result.success ? (
                <>
                  <CheckCircle2 className='h-5 w-5 text-green-500' />
                  Transfer Order Created
                </>
              ) : (
                <>
                  <XCircle className='h-5 w-5 text-red-500' />
                  Creation Failed
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success && result.data ? (
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>
                    Transfer Order Number
                  </Label>
                  <Badge variant='default' className='font-mono text-lg'>
                    {result.data.to_number}
                  </Badge>
                </div>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>Warehouse</Label>
                  <p className='text-muted-foreground text-sm'>
                    {result.data.warehouse}
                  </p>
                </div>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>Material</Label>
                  <p className='text-muted-foreground text-sm'>
                    {result.data.material}
                  </p>
                </div>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>Quantity</Label>
                  <p className='text-muted-foreground text-sm'>
                    {result.data.quantity}
                  </p>
                </div>
              </div>
            ) : (
              <div className='space-y-2'>
                <Label className='text-sm font-medium text-red-600'>
                  Error Details
                </Label>
                <p className='rounded bg-red-50 p-3 font-mono text-sm text-red-500 dark:bg-red-950/20'>
                  {result.error || result.message || 'Unknown error occurred'}
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
