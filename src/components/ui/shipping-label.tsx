// Created and developed by Jai Singh
'use client'

import * as React from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'

// 4x1 Shipping Label Component
interface ShippingLabelProps {
  deliveryId: string
  dimensions: {
    length: string
    width: string
    height: string
  }
  weight: string
  printedBy?: string
  printedAt?: string
}

const ShippingLabel: React.FC<ShippingLabelProps> = ({
  deliveryId,
  dimensions,
  weight,
  printedBy,
  printedAt,
}) => {
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  const formatDate = (dateString?: string) => {
    if (!dateString) return new Date().toLocaleString()
    return new Date(dateString).toLocaleString()
  }

  // Print function removed - now handled by the main Generate & Print button

  return (
    <div className='mx-auto w-full max-w-md space-y-4'>
      <div className='rounded-lg border bg-gray-50 p-4 dark:bg-gray-800'>
        <h3 className='mb-3 text-center font-medium'>
          4×1 Shipping Label Preview
        </h3>

        {/* Label Preview */}
        <div className='mb-4 rounded border-2 border-dashed border-gray-300 bg-white p-3 text-black'>
          <div className='grid grid-cols-2 gap-4 font-mono text-xs'>
            <div>
              <div className='space-y-1'>
                <div className='mt-2 text-lg font-bold text-black'>
                  <strong>Delivery:</strong> {deliveryId}
                </div>

                <div className='text-black'>
                  <strong>Weight:</strong> {weight} lbs
                </div>
              </div>
            </div>
            <div className='text-right'>
              <div className='space-y-1'>
                <div className='text-black'>
                  <strong>Dimensions:</strong>
                </div>
                <div className='text-black'>
                  L:{dimensions.length} W:{dimensions.width} H:
                  {dimensions.height} cm
                </div>
                <div className='text-black'>
                  <strong>By:</strong>{' '}
                  {printedBy || profile?.username || 'System'}
                </div>
                <div className='text-black'>
                  <strong>Time:</strong> {formatDate(printedAt)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ShippingLabel }

// Created and developed by Jai Singh
