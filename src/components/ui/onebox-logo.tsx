// Created and developed by Jai Singh
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
  const defaultSize = className?.includes('size-') ? '' : 'size-6'

  return (
    <img
      src='/images/OneBoxLogoX.png'
      alt='OmniFrame Logo'
      className={cn(
        'object-contain transition-transform duration-[8s] ease-linear',
        'shrink-0 animate-spin hover:duration-[4s]',
        defaultSize,
        className
      )}
      style={{
        animation: 'spin 8s linear infinite',
        filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.3))',
      }}
      {...props}
    />
  )
}

/** @deprecated Use OmniFrameLogo instead */
export const OneBoxLogo = OmniFrameLogo

export default OmniFrameLogo

// Created and developed by Jai Singh
