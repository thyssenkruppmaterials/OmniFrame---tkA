import { createFileRoute } from '@tanstack/react-router'
import ForgotPassword from '@/features/auth/forgot-password'

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPassword,
})
// Developer and Creator: Jai Singh
