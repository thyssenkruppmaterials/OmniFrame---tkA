// Created and developed by Jai Singh
export function WarehouseMapSkeleton() {
  return (
    <div className='flex h-[calc(100vh-200px)] flex-col gap-3 p-4'>
      <div className='bg-muted h-12 animate-pulse rounded' />
      <div className='bg-muted/50 relative flex-1 animate-pulse rounded'>
        <div className='bg-muted absolute bottom-4 left-4 h-32 w-48 animate-pulse rounded' />
        <div className='bg-muted absolute right-4 bottom-4 h-36 w-48 animate-pulse rounded' />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
