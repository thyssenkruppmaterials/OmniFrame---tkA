import { useState } from 'react'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  Warehouse,
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

interface ConfirmTOResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    to_number: string
    warehouse: string
    severity?: string
    confirmed_items?: number
    messages?: Array<{ TYPE: string; MESSAGE: string }>
  }
}

export function ConfirmTOTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<ConfirmTOResult | null>(null)
  const [formData, setFormData] = useState({
    warehouse: '034',
    to_number: '',
    quantity: undefined as number | undefined,
  })

  const confirmTransferOrder = async () => {
    if (!formData.to_number) {
      toast.error('Validation Error', {
        description: 'Please enter a Transfer Order number',
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const response = await sapFetch('/api/sap/confirm-to', {
        method: 'POST',
        body: JSON.stringify({
          warehouse: formData.warehouse,
          to_number: formData.to_number,
          quantity: formData.quantity || null,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success('Transfer Order Confirmed', {
          description: `TO ${formData.to_number} confirmed successfully`,
        })
      } else {
        toast.error('Confirmation Failed', {
          description: data.error || 'Failed to confirm Transfer Order',
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
      {/* Confirm TO Form */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <ClipboardCheck className='h-5 w-5' />
            Confirm Transfer Order
          </CardTitle>
          <CardDescription>
            Confirm an existing Transfer Order in SAP WM/EWM
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
              <Label htmlFor='to_number'>Transfer Order Number *</Label>
              <Input
                id='to_number'
                value={formData.to_number}
                onChange={(e) =>
                  setFormData({ ...formData, to_number: e.target.value })
                }
                placeholder='0000000001'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='quantity'>Confirm Quantity (optional)</Label>
              <Input
                id='quantity'
                type='number'
                min='0.001'
                step='0.001'
                value={formData.quantity || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    quantity: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                placeholder='Leave empty for full confirmation'
              />
              <p className='text-muted-foreground text-xs'>
                Leave empty to confirm the full quantity
              </p>
            </div>
          </div>

          <Button
            onClick={confirmTransferOrder}
            disabled={isLoading}
            className='w-full md:w-auto'
          >
            {isLoading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Confirming Transfer Order...
              </>
            ) : (
              <>
                <ClipboardCheck className='mr-2 h-4 w-4' />
                Confirm Transfer Order
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
                  Transfer Order Confirmed
                </>
              ) : (
                <>
                  <XCircle className='h-5 w-5 text-red-500' />
                  Confirmation Failed
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success && result.data ? (
              <div className='space-y-4'>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Transfer Order
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
                  {result.data.severity && (
                    <div className='space-y-2'>
                      <Label className='text-sm font-medium'>Status</Label>
                      <Badge
                        variant={
                          result.data.severity === 'E'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {result.data.severity === 'E' ? 'Error' : 'Success'}
                      </Badge>
                    </div>
                  )}
                  {result.data.confirmed_items !== undefined && (
                    <div className='space-y-2'>
                      <Label className='text-sm font-medium'>
                        Confirmed Items
                      </Label>
                      <p className='text-muted-foreground text-sm'>
                        {result.data.confirmed_items}
                      </p>
                    </div>
                  )}
                </div>

                {result.data.messages && result.data.messages.length > 0 && (
                  <div className='space-y-2 border-t pt-4'>
                    <Label className='text-sm font-medium'>SAP Messages</Label>
                    <div className='space-y-1'>
                      {result.data.messages.map((msg, idx) => (
                        <div
                          key={idx}
                          className='flex items-start gap-2 text-sm'
                        >
                          <Badge
                            variant={
                              msg.TYPE === 'E'
                                ? 'destructive'
                                : msg.TYPE === 'W'
                                  ? 'secondary'
                                  : 'outline'
                            }
                            className='text-xs'
                          >
                            {msg.TYPE}
                          </Badge>
                          <span className='text-muted-foreground'>
                            {msg.MESSAGE}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
