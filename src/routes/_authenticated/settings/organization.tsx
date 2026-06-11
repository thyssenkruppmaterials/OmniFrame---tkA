// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import OrganizationSettings from '@/features/settings/organization'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  component: () => <OrganizationSettings />,
})

// Created and developed by Jai Singh
