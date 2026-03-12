/**
 * RF Productivity Card Component
 * Reusable stat card component for displaying productivity metrics in RF interface
 * Follows OmniFrame design patterns with proper theming and loading states
 */
import React from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Utils function for class names
function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ')
}

export interface ProductivityCardProps {
  title: string
  icon: React.ElementType
  count: number | null
  isLoading?: boolean
  error?: string | null
  variant?:
    | 'default'
    | 'success'
    | 'warning'
    | 'info'
    | 'orange'
    | 'teal'
    | 'slate'
    | 'placeholder'
  description?: string
}

const variantStyles = {
  default: {
    card: 'border-border',
    header: 'text-foreground',
    icon: 'text-muted-foreground',
    count: 'text-foreground',
    badge: 'bg-primary text-primary-foreground',
  },
  success: {
    card: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20',
    header: 'text-green-800 dark:text-green-100',
    icon: 'text-green-600 dark:text-green-400',
    count: 'text-green-700 dark:text-green-200',
    badge: 'bg-green-600 text-white',
  },
  warning: {
    card: 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20',
    header: 'text-yellow-800 dark:text-yellow-100',
    icon: 'text-yellow-600 dark:text-yellow-400',
    count: 'text-yellow-700 dark:text-yellow-200',
    badge: 'bg-yellow-600 text-white',
  },
  info: {
    card: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    header: 'text-blue-800 dark:text-blue-100',
    icon: 'text-blue-600 dark:text-blue-400',
    count: 'text-blue-700 dark:text-blue-200',
    badge: 'bg-blue-600 text-white',
  },
  orange: {
    card: 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20',
    header: 'text-orange-800 dark:text-orange-100',
    icon: 'text-orange-600 dark:text-orange-400',
    count: 'text-orange-700 dark:text-orange-200',
    badge: 'bg-orange-600 text-white',
  },
  teal: {
    card: 'border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-900/20',
    header: 'text-teal-800 dark:text-teal-100',
    icon: 'text-teal-600 dark:text-teal-400',
    count: 'text-teal-700 dark:text-teal-200',
    badge: 'bg-teal-600 text-white',
  },
  slate: {
    card: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40',
    header: 'text-slate-800 dark:text-slate-100',
    icon: 'text-slate-600 dark:text-slate-400',
    count: 'text-slate-700 dark:text-slate-200',
    badge: 'bg-slate-600 text-white',
  },
  placeholder: {
    card: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40 opacity-75',
    header: 'text-gray-600 dark:text-gray-400',
    icon: 'text-gray-500 dark:text-gray-500',
    count: 'text-gray-600 dark:text-gray-400',
    badge: 'bg-gray-500 text-white',
  },
}

export const ProductivityCard: React.FC<ProductivityCardProps> = ({
  title,
  icon: Icon,
  count,
  isLoading = false,
  error = null,
  variant = 'default',
  description,
}) => {
  const styles = variantStyles[variant]

  return (
    <Card
      className={cn(
        'min-h-[100px] shadow-sm transition-all duration-200 hover:shadow-md',
        styles.card
      )}
    >
      <CardContent className='p-4'>
        <div className='mb-3 flex items-start justify-between'>
          <div className='flex items-center gap-2'>
            <Icon className={cn('h-4 w-4 flex-shrink-0', styles.icon)} />
            <span className={cn('text-sm font-semibold', styles.header)}>
              {title}
            </span>
          </div>

          {/* Today indicator badge - show for all non-placeholder cards */}
          {!isLoading && !error && variant !== 'placeholder' && (
            <Badge
              variant='secondary'
              className={cn('h-5 flex-shrink-0 px-2 text-xs', styles.badge)}
            >
              Today
            </Badge>
          )}
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex-1'>
            {isLoading ? (
              <div className='flex items-center space-x-2'>
                <Loader2 className={cn('h-5 w-5 animate-spin', styles.icon)} />
                <span className={cn('text-sm', styles.count)}>Loading...</span>
              </div>
            ) : error ? (
              <div className='space-y-1'>
                <span
                  className={cn(
                    'text-sm font-semibold text-red-600 dark:text-red-400'
                  )}
                >
                  Error
                </span>
                <span
                  className='text-xs break-words text-red-500 dark:text-red-400'
                  title={error}
                >
                  {error.length > 30 ? `${error.substring(0, 30)}...` : error}
                </span>
              </div>
            ) : (
              <div className='space-y-1'>
                <div
                  className={cn(
                    'text-2xl leading-none font-bold',
                    styles.count
                  )}
                >
                  {count !== null ? count.toLocaleString() : '-'}
                </div>
                {description && (
                  <div
                    className={cn(
                      'text-xs leading-tight',
                      styles.header,
                      'opacity-75'
                    )}
                  >
                    {description}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ProductivityCard
