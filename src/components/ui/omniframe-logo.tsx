import * as React from 'react'
import { cn } from '@/lib/utils'

interface OmniFrameLogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: 'default' | 'collapsed'
}

export function OmniFrameLogo({
  size = 'default',
  className,
  ...props
}: OmniFrameLogoProps) {
  // Use size-6 by default for main sidebar, but allow override via className
  const defaultSize = className?.includes('size-') ? '' : 'size-6'

  return (
    <img
      src='/images/favicon.svg'
      alt='OmniFrame Logo'
      className={cn(
        'object-contain transition-transform duration-[8s] ease-linear',
        'shrink-0 animate-spin hover:duration-[4s]',
        defaultSize,
        className
      )}
      style={{
        animation: 'spin 8s linear infinite',
      }}
      {...props}
    />
  )
}

export default OmniFrameLogo
