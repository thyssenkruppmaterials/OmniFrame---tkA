// Created and developed by Jai Singh
import { HTMLAttributes, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import useUnifiedAuthStore from '@/stores/unifiedAuthStore'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

type UserAuthFormProps = HTMLAttributes<HTMLFormElement>

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Please enter your password')
    .min(7, 'Password must be at least 7 characters long'),
})

export function UserAuthForm({ className, ...props }: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { redirect } = useSearch({ strict: false }) as { redirect?: string }
  const { signIn } = useUnifiedAuth()
  const lastVisitedPath = useUnifiedAuthStore((s) => s.lastVisitedPath)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    try {
      logger.log('🔐 Sign-in attempt for:', data.email)
      logger.log('📝 Form data valid:', !!data.email && !!data.password)

      const result = await signIn(data.email, data.password)

      // CRITICAL FIX: Check if sign-in actually succeeded
      // signIn returns { user, error } instead of throwing
      if (result.error || !result.user) {
        const errorMessage = result.error?.message || 'Failed to sign in'
        logger.error('❌ Sign-in failed:', errorMessage)

        // Provide more specific error messages
        let friendlyMessage = 'Failed to sign in'

        if (errorMessage.includes('Invalid login credentials')) {
          friendlyMessage = 'Invalid email or password'
        } else if (errorMessage.includes('Email not confirmed')) {
          friendlyMessage = 'Please verify your email address'
        } else if (errorMessage.includes('Too many requests')) {
          friendlyMessage = 'Too many attempts. Please try again later'
        } else if (errorMessage.includes('fetch')) {
          friendlyMessage = 'Network error - please check your connection'
        } else {
          friendlyMessage = errorMessage
        }

        logger.log('🔔 Showing error toast:', friendlyMessage)
        toast.error(friendlyMessage)
        return // Don't navigate on error
      }

      logger.log('✅ Sign-in completed, preparing to navigate...')
      toast.success('Signed in successfully!')

      // Prevent redirect loop - never redirect back to sign-in page
      // Priority: explicit redirect param > last-visited path > home
      const decodedRedirect = redirect ? decodeURIComponent(redirect) : null
      const targetRoute =
        decodedRedirect && !decodedRedirect.includes('sign-in')
          ? decodedRedirect
          : lastVisitedPath && !lastVisitedPath.includes('sign-in')
            ? lastVisitedPath
            : '/'
      logger.log('🔄 Navigating to:', targetRoute)

      // Parse the target route to handle query params properly
      // The redirect may contain search params like /apps/grs?tab=tracking
      const url = new URL(targetRoute, window.location.origin)
      const searchParams: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value
      })

      navigate({
        to: url.pathname,
        search: Object.keys(searchParams).length > 0 ? searchParams : undefined,
        hash: url.hash || undefined,
      })
    } catch (error: unknown) {
      logger.error('❌ Unexpected error in sign-in handler:', {
        error,
        message: error instanceof Error ? error.message : String(error),
        type: typeof error,
        keys: error && typeof error === 'object' ? Object.keys(error) : [],
      })

      // Handle unexpected errors that might be thrown
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred'
      logger.log('🔔 Showing error toast:', errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder='name@example.com' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='text-muted-foreground absolute -top-0.5 right-0 text-sm font-medium hover:opacity-75'
              >
                Forgot password?
              </Link>
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          Login
        </Button>
      </form>
    </Form>
  )
}

// Created and developed by Jai Singh
