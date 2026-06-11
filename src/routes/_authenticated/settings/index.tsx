// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import SettingsProfile from '@/features/settings/profile'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsProfile,
})

// Created and developed by Jai Singh
