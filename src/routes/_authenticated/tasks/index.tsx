// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import Tasks from '@/features/tasks'

export const Route = createFileRoute('/_authenticated/tasks/')({
  component: Tasks,
})

// Created and developed by Jai Singh
