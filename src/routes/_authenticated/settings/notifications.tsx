// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import SettingsNotifications from '@/features/settings/notifications'

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  component: SettingsNotifications,
})

// Created and developed by Jai Singh
