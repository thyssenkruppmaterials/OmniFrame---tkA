// Created and developed by Jai Singh
/**
 * ToolsSection — Allow-list tab.
 *
 * Thin wrapper around `ToolAllowGrid`. Reads the current allow-list
 * from the bootstrap query and passes it down; `ToolAllowGrid` owns
 * the optimistic checkbox state and the save flow.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToolAllowGrid } from '../components/ToolAllowGrid'
import { useOmnibeltAdminBootstrap } from '../hooks/useOmnibeltAdminBootstrap'

export function ToolsSection() {
  const { data, isLoading, isError, error } = useOmnibeltAdminBootstrap()

  if (isLoading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-8 w-72' />
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-32 w-full rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <Card className='border-rose-500/40 bg-rose-500/5'>
        <CardHeader>
          <CardTitle className='text-sm'>
            Failed to load tool registry
          </CardTitle>
        </CardHeader>
        <CardContent className='text-muted-foreground text-xs'>
          {error instanceof Error ? error.message : 'Unknown error.'}
        </CardContent>
      </Card>
    )
  }

  return <ToolAllowGrid allowList={data.allowList} />
}

// Created and developed by Jai Singh
