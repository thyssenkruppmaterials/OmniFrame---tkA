// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import NotFoundError from '@/features/errors/not-found-error'

export const Route = createFileRoute('/(errors)/404')({
  component: NotFoundError,
})

// Created and developed by Jai Singh
