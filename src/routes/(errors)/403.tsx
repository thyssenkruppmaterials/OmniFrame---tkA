import { createFileRoute } from '@tanstack/react-router'
import ForbiddenError from '@/features/errors/forbidden'

export const Route = createFileRoute('/(errors)/403')({
  component: ForbiddenError,
})
// Developer and Creator: Jai Singh
