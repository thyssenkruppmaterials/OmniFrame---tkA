/**
 * Scan Results Grid Component
 *
 * Displays drone scan results in a responsive grid with thumbnails.
 */
import { formatDistanceToNow } from 'date-fns'
import {
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Package,
  Barcode,
  FileText,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export interface DroneScan {
  id: string
  captured_at: string
  image_url: string
  thumbnail_url?: string
  warehouse_zone?: string
  aisle?: string
  shelf_position?: string
  ai_analysis_status: string
  raw_text?: string
  spatial_description?: string
  detected_texts?: Array<{ value: string; type: string; confidence: number }>
  detected_barcodes?: Array<{ value: string; format: string }>
  inventory_assessment?: {
    level: string
    estimated_fill: number
    damage_detected: boolean
  }
  rank?: number
}

interface ScanResultsGridProps {
  scans: DroneScan[]
  isLoading?: boolean
  onScanClick?: (scan: DroneScan) => void
}

export function ScanResultsGrid({
  scans,
  isLoading = false,
  onScanClick,
}: ScanResultsGridProps) {
  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
      </div>
    )
  }

  if (scans.length === 0) {
    return (
      <div className='py-12 text-center'>
        <Package className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
        <p className='text-muted-foreground'>No scans found</p>
        <p className='text-muted-foreground text-sm'>
          Try a different search query or capture new scans
        </p>
      </div>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {scans.map((scan) => (
        <ScanCard
          key={scan.id}
          scan={scan}
          onClick={() => onScanClick?.(scan)}
        />
      ))}
    </div>
  )
}

interface ScanCardProps {
  scan: DroneScan
  onClick?: () => void
}

function ScanCard({ scan, onClick }: ScanCardProps) {
  const getStatusBadge = () => {
    switch (scan.ai_analysis_status) {
      case 'completed':
        return (
          <Badge variant='default' className='bg-green-500 text-xs'>
            <CheckCircle2 className='mr-1 h-3 w-3' />
            Analyzed
          </Badge>
        )
      case 'processing':
        return (
          <Badge variant='secondary' className='text-xs'>
            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
            Processing
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant='destructive' className='text-xs'>
            <AlertCircle className='mr-1 h-3 w-3' />
            Failed
          </Badge>
        )
      default:
        return (
          <Badge variant='outline' className='text-xs'>
            Pending
          </Badge>
        )
    }
  }

  const getInventoryLevelColor = (level?: string) => {
    switch (level) {
      case 'full':
        return 'bg-green-500'
      case 'partial':
        return 'bg-yellow-500'
      case 'empty':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <Card
      className='hover:ring-primary/50 cursor-pointer overflow-hidden transition-all hover:ring-2'
      onClick={onClick}
    >
      {/* Image */}
      <div className='bg-muted relative aspect-video'>
        {scan.thumbnail_url || scan.image_url ? (
          <img
            src={scan.thumbnail_url || scan.image_url}
            alt={`Scan ${scan.id}`}
            className='h-full w-full object-cover'
            loading='lazy'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center'>
            <Package className='text-muted-foreground h-8 w-8' />
          </div>
        )}

        {/* Status badge overlay */}
        <div className='absolute top-2 right-2'>{getStatusBadge()}</div>

        {/* Inventory level indicator */}
        {scan.inventory_assessment && (
          <div className='absolute bottom-2 left-2'>
            <div
              className={`h-2 w-2 rounded-full ${getInventoryLevelColor(scan.inventory_assessment.level)}`}
              title={`Inventory: ${scan.inventory_assessment.level}`}
            />
          </div>
        )}

        {/* Relevance indicator for search results */}
        {scan.rank && scan.rank > 0 && (
          <div className='absolute top-2 left-2'>
            <Badge variant='secondary' className='text-xs'>
              {Math.round(scan.rank * 100)}% match
            </Badge>
          </div>
        )}
      </div>

      <CardContent className='space-y-2 p-3'>
        {/* Location */}
        {(scan.warehouse_zone || scan.aisle) && (
          <div className='flex items-center gap-1 text-sm'>
            <MapPin className='text-muted-foreground h-3 w-3' />
            <span className='font-medium'>
              {[scan.warehouse_zone, scan.aisle, scan.shelf_position]
                .filter(Boolean)
                .join(' / ')}
            </span>
          </div>
        )}

        {/* Detected items summary */}
        <div className='flex flex-wrap gap-1'>
          {scan.detected_texts && scan.detected_texts.length > 0 && (
            <Badge variant='outline' className='text-xs'>
              <FileText className='mr-1 h-3 w-3' />
              {scan.detected_texts.length} texts
            </Badge>
          )}
          {scan.detected_barcodes && scan.detected_barcodes.length > 0 && (
            <Badge variant='outline' className='text-xs'>
              <Barcode className='mr-1 h-3 w-3' />
              {scan.detected_barcodes.length} barcodes
            </Badge>
          )}
        </div>

        {/* Description preview */}
        {scan.spatial_description && (
          <p className='text-muted-foreground line-clamp-2 text-xs'>
            {scan.spatial_description}
          </p>
        )}

        {/* Timestamp */}
        <div className='text-muted-foreground flex items-center gap-1 text-xs'>
          <Clock className='h-3 w-3' />
          <span>
            {formatDistanceToNow(new Date(scan.captured_at), {
              addSuffix: true,
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
