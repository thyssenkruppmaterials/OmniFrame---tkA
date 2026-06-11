// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import SettingsAppearance from '@/features/settings/appearance'

export const Route = createFileRoute('/_authenticated/settings/appearance')({
  component: SettingsAppearance,
})

// Created and developed by Jai Singh
