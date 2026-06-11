// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import SettingsAccount from '@/features/settings/account'

export const Route = createFileRoute('/_authenticated/settings/account')({
  component: SettingsAccount,
})

// Created and developed by Jai Singh
