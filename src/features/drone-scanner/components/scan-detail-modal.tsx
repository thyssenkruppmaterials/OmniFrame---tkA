/**
 * Scan Detail Modal Component
 *
 * Displays detailed information about a drone scan including
 * AI analysis results, detected items, and full-size image.
 */
import { format } from 'date-fns'
import {
  MapPin,
  Clock,
  Barcode,
  FileText,
  Package,
  AlertTriangle,
  Brain,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DroneScan } from './scan-results-grid'

interface ScanDetailModalProps {
  scan: DroneScan | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ScanDetailModal({
  scan,
  open,
  onOpenChange,
}: ScanDetailModalProps) {
  if (!scan) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-4xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Brain className='h-5 w-5' />
            Scan Details
          </DialogTitle>
        </DialogHeader>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          {/* Image */}
          <div className='bg-muted relative aspect-video overflow-hidden rounded-lg'>
            {scan.image_url ? (
              <img
                src={scan.image_url}
                alt={`Scan ${scan.id}`}
                className='h-full w-full object-contain'
              />
            ) : (
              <div className='flex h-full w-full items-center justify-center'>
                <Package className='text-muted-foreground h-12 w-12' />
              </div>
            )}
          </div>

          {/* Info */}
          <div className='space-y-4'>
            {/* Location */}
            <div>
              <h4 className='mb-2 flex items-center gap-1 text-sm font-medium'>
                <MapPin className='h-4 w-4' />
                Location
              </h4>
              <div className='space-y-1 text-sm'>
                {scan.warehouse_zone && (
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Zone:</span>
                    <span className='font-medium'>{scan.warehouse_zone}</span>
                  </div>
                )}
                {scan.aisle && (
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Aisle:</span>
                    <span className='font-medium'>{scan.aisle}</span>
                  </div>
                )}
                {scan.shelf_position && (
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Shelf:</span>
                    <span className='font-medium'>{scan.shelf_position}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div>
              <h4 className='mb-2 flex items-center gap-1 text-sm font-medium'>
                <Clock className='h-4 w-4' />
                Captured
              </h4>
              <p className='text-sm'>
                {format(new Date(scan.captured_at), 'PPpp')}
              </p>
            </div>

            {/* Inventory Assessment */}
            {scan.inventory_assessment && (
              <div>
                <h4 className='mb-2 flex items-center gap-1 text-sm font-medium'>
                  <Package className='h-4 w-4' />
                  Inventory Status
                </h4>
                <div className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <Badge
                      variant={
                        scan.inventory_assessment.level === 'full'
                          ? 'default'
                          : scan.inventory_assessment.level === 'partial'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {scan.inventory_assessment.level.toUpperCase()}
                    </Badge>
                    <span className='text-muted-foreground text-sm'>
                      {Math.round(
                        scan.inventory_assessment.estimated_fill * 100
                      )}
                      % filled
                    </span>
                  </div>
                  {scan.inventory_assessment.damage_detected && (
                    <div className='flex items-center gap-1 text-amber-600'>
                      <AlertTriangle className='h-4 w-4' />
                      <span className='text-sm'>Damage detected</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* AI Analysis Tabs */}
        <Tabs defaultValue='description' className='mt-4'>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='description'>Description</TabsTrigger>
            <TabsTrigger value='texts'>Detected Text</TabsTrigger>
            <TabsTrigger value='barcodes'>Barcodes</TabsTrigger>
          </TabsList>

          <TabsContent value='description' className='mt-4'>
            <ScrollArea className='h-[200px]'>
              {scan.spatial_description ? (
                <p className='text-sm leading-relaxed'>
                  {scan.spatial_description}
                </p>
              ) : (
                <p className='text-muted-foreground text-sm'>
                  No AI description available
                </p>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value='texts' className='mt-4'>
            <ScrollArea className='h-[200px]'>
              {scan.detected_texts && scan.detected_texts.length > 0 ? (
                <div className='space-y-2'>
                  {scan.detected_texts.map((text, index) => (
                    <div
                      key={index}
                      className='bg-muted flex items-center justify-between rounded p-2'
                    >
                      <div className='flex items-center gap-2'>
                        <FileText className='text-muted-foreground h-4 w-4' />
                        <span className='font-mono'>{text.value}</span>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Badge variant='outline' className='text-xs'>
                          {text.type}
                        </Badge>
                        <span className='text-muted-foreground text-xs'>
                          {Math.round(text.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-muted-foreground flex flex-col items-center justify-center py-8'>
                  <FileText className='mb-2 h-8 w-8' />
                  <p className='text-sm'>No text detected</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value='barcodes' className='mt-4'>
            <ScrollArea className='h-[200px]'>
              {scan.detected_barcodes && scan.detected_barcodes.length > 0 ? (
                <div className='space-y-2'>
                  {scan.detected_barcodes.map((barcode, index) => (
                    <div
                      key={index}
                      className='bg-muted flex items-center justify-between rounded p-2'
                    >
                      <div className='flex items-center gap-2'>
                        <Barcode className='text-muted-foreground h-4 w-4' />
                        <span className='font-mono'>{barcode.value}</span>
                      </div>
                      <Badge variant='outline' className='text-xs'>
                        {barcode.format}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-muted-foreground flex flex-col items-center justify-center py-8'>
                  <Barcode className='mb-2 h-8 w-8' />
                  <p className='text-sm'>No barcodes detected</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Raw Text */}
        {scan.raw_text && (
          <div className='bg-muted mt-4 rounded p-3'>
            <h4 className='mb-2 text-sm font-medium'>Raw Extracted Text</h4>
            <p className='text-muted-foreground font-mono text-xs whitespace-pre-wrap'>
              {scan.raw_text}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
