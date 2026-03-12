import React from 'react'
import { cn } from '@/lib/utils'

interface PublicHeaderProps extends React.HTMLAttributes<HTMLElement> {
  fixed?: boolean
}

export const PublicHeader = ({
  className,
  fixed,
  children,
  ...props
}: PublicHeaderProps) => {
  const [offset, setOffset] = React.useState(0)

  React.useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    document.addEventListener('scroll', onScroll, { passive: true })

    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'bg-background flex h-16 items-center gap-3 p-4 sm:gap-4',
        fixed &&
          'header-fixed peer/header fixed top-0 right-0 left-0 z-50 w-full',
        offset > 10 && fixed ? 'shadow-sm' : 'shadow-none',
        className
      )}
      {...props}
    >
      {children}
    </header>
  )
}

PublicHeader.displayName = 'PublicHeader'
