// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import Dashboard from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  component: Dashboard,
})

// Created and developed by Jai Singh
