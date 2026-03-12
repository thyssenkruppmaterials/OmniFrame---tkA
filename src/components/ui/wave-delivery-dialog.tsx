'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, Loader2, Scan, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WaveDeliveryDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onScanDelivery: (
    deliveryNumber: string
  ) => Promise<{ success: boolean; message: string }>
}

interface ScannedDelivery {
  deliveryNumber: string
  timestamp: Date
  success: boolean
}

export function WaveDeliveryDialog({
  isOpen,
  onOpenChange,
  onScanDelivery,
}: WaveDeliveryDialogProps) {
  const [deliveryNumber, setDeliveryNumber] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [scannedDeliveries, setScannedDeliveries] = useState<ScannedDelivery[]>(
    []
  )
  const [totalScanCount, setTotalScanCount] = useState(0)
  const [flashMessage, setFlashMessage] = useState<{
    message: string
    type: 'success' | 'error'
  } | null>(null)
  const [isAutoProcessing, setIsAutoProcessing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoProcessTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Configuration for auto-proceed (typical delivery number length is 8 digits)
  const DELIVERY_NUMBER_LENGTH = 8
  const AUTO_PROCESS_DELAY = 500 // milliseconds to wait after input before auto-processing

  // Auto-focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  // Auto-focus input after each scan
  useEffect(() => {
    if (!isScanning && isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [isScanning, isOpen])

  // Auto-proceed when delivery number reaches expected length
  useEffect(() => {
    logger.log(`[Wave Delivery Auto-Proceed Debug] 
      deliveryNumber: "${deliveryNumber}" (length: ${deliveryNumber.length})
      DELIVERY_NUMBER_LENGTH: ${DELIVERY_NUMBER_LENGTH}
      isScanning: ${isScanning}
      isAutoProcessing: ${isAutoProcessing}
      shouldAutoProcess: ${deliveryNumber.length >= DELIVERY_NUMBER_LENGTH && !isScanning && !isAutoProcessing}`)

    // Clear any existing timeout
    if (autoProcessTimeoutRef.current) {
      clearTimeout(autoProcessTimeoutRef.current)
      autoProcessTimeoutRef.current = null
    }

    // Only auto-process if we have a delivery number of expected length and not currently scanning
    if (
      deliveryNumber.length >= DELIVERY_NUMBER_LENGTH &&
      !isScanning &&
      !isAutoProcessing
    ) {
      logger.log(
        `[Wave Delivery Auto-Proceed] Starting auto-process timeout for delivery: ${deliveryNumber}`
      )
      autoProcessTimeoutRef.current = setTimeout(async () => {
        logger.log(
          `[Wave Delivery Auto-Proceed] Timeout triggered, processing delivery: ${deliveryNumber}`
        )
        if (!deliveryNumber.trim() || isScanning) {
          logger.log(
            `[Wave Delivery Auto-Proceed] Aborting - invalid delivery or already scanning`
          )
          return
        }

        setIsScanning(true)
        setIsAutoProcessing(true)

        try {
          logger.log(
            `[Wave Delivery Auto-Proceed] Calling onScanDelivery with: ${deliveryNumber.trim()}`
          )
          const result = await onScanDelivery(deliveryNumber.trim())
          logger.log(
            `[Wave Delivery Auto-Proceed] onScanDelivery result:`,
            result
          )

          // Add to scanned deliveries list
          const scannedDelivery: ScannedDelivery = {
            deliveryNumber: deliveryNumber.trim(),
            timestamp: new Date(),
            success: result.success,
          }

          // Increment total scan count
          setTotalScanCount((prev) => prev + 1)
          setScannedDeliveries((prev) => [scannedDelivery, ...prev.slice(0, 9)]) // Keep last 10

          // Show flash message
          setFlashMessage({
            message: result.message,
            type: result.success ? 'success' : 'error',
          })

          // Clear the input field for next scan
          setDeliveryNumber('')
          logger.log(
            `[Wave Delivery Auto-Proceed] Successfully processed and cleared field`
          )
        } catch (error) {
          logger.error(
            `[Wave Delivery Auto-Proceed] Error scanning delivery:`,
            error
          )
          setFlashMessage({
            message: 'Auto-scan failed. Please try again.',
            type: 'error',
          })
        } finally {
          logger.log(
            `[Wave Delivery Auto-Proceed] Cleaning up - setting scanning/auto-processing to false`
          )
          setIsScanning(false)
          setIsAutoProcessing(false)
        }
      }, AUTO_PROCESS_DELAY)
    }

    // Cleanup timeout on unmount or when dependencies change
    return () => {
      if (autoProcessTimeoutRef.current) {
        clearTimeout(autoProcessTimeoutRef.current)
        autoProcessTimeoutRef.current = null
      }
    }
  }, [
    deliveryNumber,
    isScanning,
    isAutoProcessing,
    onScanDelivery,
    DELIVERY_NUMBER_LENGTH,
    AUTO_PROCESS_DELAY,
  ])

  // Clear flash message after 2 seconds
  useEffect(() => {
    if (flashMessage) {
      const timer = setTimeout(() => {
        setFlashMessage(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [flashMessage])

  const handleManualScan = useCallback(async () => {
    if (!deliveryNumber.trim() || isScanning) return

    setIsScanning(true)

    try {
      const result = await onScanDelivery(deliveryNumber.trim())

      // Add to scanned deliveries list
      const scannedDelivery: ScannedDelivery = {
        deliveryNumber: deliveryNumber.trim(),
        timestamp: new Date(),
        success: result.success,
      }

      // Increment total scan count
      setTotalScanCount((prev) => prev + 1)
      setScannedDeliveries((prev) => [scannedDelivery, ...prev.slice(0, 9)]) // Keep last 10

      // Show flash message
      setFlashMessage({
        message: result.message,
        type: result.success ? 'success' : 'error',
      })

      // Clear the input field for next scan
      setDeliveryNumber('')
    } catch (error) {
      logger.error('Error scanning delivery:', error)
      setFlashMessage({
        message: 'Scan failed. Please try again.',
        type: 'error',
      })
    } finally {
      setIsScanning(false)
    }
  }, [deliveryNumber, isScanning, onScanDelivery])

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isScanning) {
      e.preventDefault()
      handleManualScan()
    }
  }

  const handleClose = () => {
    // Clear any pending auto-process timeout
    if (autoProcessTimeoutRef.current) {
      clearTimeout(autoProcessTimeoutRef.current)
      autoProcessTimeoutRef.current = null
    }

    setDeliveryNumber('')
    setScannedDeliveries([])
    setTotalScanCount(0)
    setFlashMessage(null)
    setIsAutoProcessing(false)
    onOpenChange(false)
  }

  const successCount = scannedDeliveries.filter((d) => d.success).length
  const errorCount = scannedDeliveries.filter((d) => !d.success).length

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[80vh] max-w-2xl overflow-hidden'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Zap className='h-5 w-5 text-blue-600' />
            Wave Delivery Scanner
          </DialogTitle>
          <DialogDescription>
            Scan delivery barcodes to rapidly update status from Pending to
            Printed. Auto-processing will begin immediately when a delivery
            number is scanned - no button clicks required.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Flash Message */}
          {flashMessage && (
            <div
              className={cn(
                'animate-in fade-in-0 rounded-lg border p-3 text-sm font-medium duration-300',
                flashMessage.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              )}
            >
              <div className='flex items-center gap-2'>
                {flashMessage.type === 'success' ? (
                  <CheckCircle className='h-4 w-4' />
                ) : (
                  <X className='h-4 w-4' />
                )}
                {flashMessage.message}
              </div>
            </div>
          )}

          {/* Scanning Interface */}
          <Card>
            <CardContent className='p-6'>
              <div className='space-y-4'>
                <div className='space-y-4 text-center'>
                  {isAutoProcessing || isScanning ? (
                    <Loader2 className='mx-auto h-16 w-16 animate-spin text-blue-600' />
                  ) : (
                    <Scan
                      className={cn(
                        'mx-auto h-16 w-16 transition-colors duration-200',
                        deliveryNumber.length >= DELIVERY_NUMBER_LENGTH
                          ? 'text-blue-600'
                          : 'text-muted-foreground'
                      )}
                    />
                  )}

                  <h3 className='text-lg font-semibold'>
                    {isAutoProcessing
                      ? 'Auto-Processing...'
                      : isScanning
                        ? 'Processing...'
                        : 'Scan Delivery Barcode'}
                  </h3>

                  <p className='text-muted-foreground text-sm'>
                    {isAutoProcessing || isScanning
                      ? 'Please wait while the delivery is being processed...'
                      : 'Position barcode scanner or enter delivery number manually'}
                  </p>
                </div>

                <div className='mx-auto max-w-md space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='deliveryNumber'>Delivery Number</Label>
                    <Input
                      ref={inputRef}
                      id='deliveryNumber'
                      placeholder='Scan or enter delivery number'
                      value={deliveryNumber}
                      onChange={(e) => setDeliveryNumber(e.target.value)}
                      onKeyPress={handleKeyPress}
                      disabled={isScanning || isAutoProcessing}
                      className={cn(
                        'text-center font-mono text-lg transition-colors',
                        deliveryNumber.length >= DELIVERY_NUMBER_LENGTH
                          ? 'border-blue-500 bg-blue-50'
                          : ''
                      )}
                      autoComplete='off'
                    />
                  </div>

                  {/* Auto-processing indicator - more prominent */}
                  {deliveryNumber.length >= DELIVERY_NUMBER_LENGTH &&
                    !isScanning &&
                    !isAutoProcessing && (
                      <div className='rounded-lg border-2 border-blue-300 bg-blue-100 p-3'>
                        <div className='flex animate-pulse items-center justify-center gap-2 text-base font-semibold text-blue-700'>
                          <Loader2 className='h-5 w-5 animate-spin' />
                          AUTO-PROCESSING DELIVERY...
                        </div>
                      </div>
                    )}

                  {/* Auto-processing active indicator */}
                  {isAutoProcessing && (
                    <div className='rounded-lg border-2 border-green-300 bg-green-100 p-3'>
                      <div className='flex items-center justify-center gap-2 text-base font-semibold text-green-700'>
                        <Loader2 className='h-5 w-5 animate-spin' />
                        PROCESSING DELIVERY {deliveryNumber}...
                      </div>
                    </div>
                  )}

                  {/* Progress indicator */}
                  {deliveryNumber.length > 0 &&
                    deliveryNumber.length < DELIVERY_NUMBER_LENGTH && (
                      <div className='text-muted-foreground text-center text-sm'>
                        {deliveryNumber.length} / {DELIVERY_NUMBER_LENGTH}{' '}
                        digits entered
                      </div>
                    )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          {scannedDeliveries.length > 0 && (
            <div className='grid grid-cols-3 gap-4'>
              <Card>
                <CardContent className='p-4 text-center'>
                  <div className='text-foreground text-2xl font-bold'>
                    {totalScanCount}
                  </div>
                  <div className='text-muted-foreground text-sm'>
                    Total Scanned
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className='p-4 text-center'>
                  <div className='text-2xl font-bold text-green-600'>
                    {successCount}
                  </div>
                  <div className='text-muted-foreground text-sm'>
                    Successfully Waved
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className='p-4 text-center'>
                  <div className='text-2xl font-bold text-red-600'>
                    {errorCount}
                  </div>
                  <div className='text-muted-foreground text-sm'>Failed</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Recent Scans */}
          {scannedDeliveries.length > 0 && (
            <Card>
              <CardContent className='p-4'>
                <h4 className='mb-3 font-medium'>Recent Scans</h4>
                <div className='max-h-40 space-y-2 overflow-y-auto'>
                  {scannedDeliveries.slice(0, 8).map((scan) => (
                    <div
                      key={`${scan.deliveryNumber}-${scan.timestamp.getTime()}`}
                      className='flex items-center justify-between rounded-lg border p-2'
                    >
                      <div className='flex items-center gap-3'>
                        <Badge
                          variant={scan.success ? 'default' : 'destructive'}
                          className='w-16 justify-center'
                        >
                          {scan.success ? 'Waved' : 'Failed'}
                        </Badge>
                        <span className='font-mono text-sm'>
                          {scan.deliveryNumber}
                        </span>
                      </div>
                      <span className='text-muted-foreground text-xs'>
                        {scan.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={handleClose}>
            Close Scanner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
