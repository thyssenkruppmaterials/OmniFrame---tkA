// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import DataManager from '@/components/data-manager'

export const Route = createFileRoute('/_authenticated/apps/data-manager')({
  beforeLoad: createStandardProtectedRoute('DATA_MANAGER'),
  component: DataManager,
})

// Created and developed by Jai Singh
