import { createFileRoute } from '@tanstack/react-router'
import OrganizationSettings from '@/features/settings/organization'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  component: () => <OrganizationSettings />,
})
// Developer and Creator: Jai Singh
