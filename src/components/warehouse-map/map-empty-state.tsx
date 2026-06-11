// Created and developed by Jai Singh
import { MapPinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface MapEmptyStateProps {
  warehouseCode: string
  onCreateMap: () => void
  canCreate: boolean
}

export function MapEmptyState({
  warehouseCode,
  onCreateMap,
  canCreate,
}: MapEmptyStateProps) {
  return (
    <div className='flex h-full items-center justify-center p-8'>
      <Card className='max-w-md text-center'>
        <CardHeader className='pb-2'>
          <div className='mx-auto mb-4'>
            <MapPinOff
              className='text-muted-foreground size-12'
              aria-hidden='true'
            />
          </div>
          <CardTitle className='text-xl'>No Warehouse Map</CardTitle>
          <CardDescription>
            There is no map configured for warehouse{' '}
            <span className='font-medium'>{warehouseCode}</span>. Create one to
            visualize and manage storage locations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canCreate ? (
            <Button onClick={onCreateMap} className='mt-2'>
              Create Warehouse Map
            </Button>
          ) : (
            <p className='text-muted-foreground text-sm'>
              Contact an administrator to set up the warehouse map.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
