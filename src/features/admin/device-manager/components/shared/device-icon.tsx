import {
  IconDeviceMobile,
  IconDeviceTablet,
  IconDeviceDesktop,
  IconDeviceTv,
  IconDeviceWatch,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface DeviceIconProps {
  model: string | null
  productName: string | null
  className?: string
  size?: number
}

export function DeviceIcon({
  model,
  productName,
  className,
  size = 20,
}: DeviceIconProps) {
  const lowerModel = (model || '').toLowerCase()
  const lowerProduct = (productName || '').toLowerCase()

  if (lowerModel.includes('ipad') || lowerProduct.includes('ipad')) {
    return (
      <IconDeviceTablet
        size={size}
        className={cn('text-muted-foreground', className)}
      />
    )
  }

  if (lowerModel.includes('mac') || lowerProduct.includes('mac')) {
    return (
      <IconDeviceDesktop
        size={size}
        className={cn('text-muted-foreground', className)}
      />
    )
  }

  if (lowerModel.includes('apple tv') || lowerProduct.includes('apple tv')) {
    return (
      <IconDeviceTv
        size={size}
        className={cn('text-muted-foreground', className)}
      />
    )
  }

  if (lowerModel.includes('watch') || lowerProduct.includes('watch')) {
    return (
      <IconDeviceWatch
        size={size}
        className={cn('text-muted-foreground', className)}
      />
    )
  }

  return (
    <IconDeviceMobile
      size={size}
      className={cn('text-muted-foreground', className)}
    />
  )
}
