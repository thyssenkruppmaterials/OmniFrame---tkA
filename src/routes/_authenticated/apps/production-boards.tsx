// Created and developed by Jai Singh
import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'

const ProductionBoardsPage = lazy(() =>
  import('@/features/shift-productivity/production-boards').then((module) => ({
    default: module.ProductionBoardsPage,
  }))
)

const ProductionBoardsFallback = () => (
  <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4'>
    <div className='bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl'>
      <Loader2 className='size-6 animate-spin' />
    </div>
    <p className='text-muted-foreground text-sm font-medium'>
      Loading Production Boards…
    </p>
  </div>
)

function ProductionBoardsRoute() {
  return (
    <Suspense fallback={<ProductionBoardsFallback />}>
      <ProductionBoardsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/_authenticated/apps/production-boards')({
  beforeLoad: createStandardProtectedRoute('PRODUCTION_BOARDS'),
  component: ProductionBoardsRoute,
})

// Created and developed by Jai Singh
