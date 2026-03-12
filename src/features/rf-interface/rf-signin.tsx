import { HTMLAttributes, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { ScannerInput } from '@/components/ui/scanner-input'
import { ScannerPasswordInput } from '@/components/ui/scanner-password-input'

type RFAuthFormProps = HTMLAttributes<HTMLFormElement>

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Please enter your password')
    .min(7, 'Password must be at least 7 characters long'),
})

// RF Terminal Auth Form
function RFAuthForm({ className, ...props }: RFAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [autoAdvanceTimer, setAutoAdvanceTimer] =
    useState<NodeJS.Timeout | null>(null)
  const navigate = useNavigate()
  const { redirect } = useSearch({ strict: false }) as { redirect?: string }
  const { signIn } = useUnifiedAuth()

  // Field refs for focus management
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const watchEmail = form.watch('email')
  const watchPassword = form.watch('password')
  const autoAdvanceDelay = 800 // Match RF tool patterns

  async function onSubmit(data: z.infer<typeof formSchema>) {
    logger.log('🔐 RF Signin: Submitting form with email:', data.email)
    setIsLoading(true)

    try {
      await signIn(data.email, data.password)
      toast.success('Signed in successfully!')
      // Redirect to standalone RF Interface
      navigate({ to: redirect || '/rf-interface' })
    } catch (error: unknown) {
      logger.error('❌ RF Signin: Login failed:', error)

      // Provide more specific error messages
      let errorMessage = 'Failed to sign in'

      const errorMsg = error instanceof Error ? error.message : ''
      if (errorMsg) {
        // Parse common Supabase auth errors
        if (errorMsg.includes('Invalid login credentials')) {
          errorMessage = 'Invalid email or password'
        } else if (errorMsg.includes('Email not confirmed')) {
          errorMessage = 'Please verify your email address'
        } else if (errorMsg.includes('Too many requests')) {
          errorMessage = 'Too many attempts. Please try again later'
        } else {
          errorMessage = errorMsg
        }
      }

      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-focus email field on component mount
  useEffect(() => {
    logger.log('🎯 RF Signin: Setting auto-focus on email field')
    const timer = setTimeout(() => {
      if (emailRef.current) {
        emailRef.current.focus()
        logger.log('✅ RF Signin: Email field focused')
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [])

  // Auto-advance from email to password when email is valid
  useEffect(() => {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer)
    }

    // Check if email is valid
    const emailSchema = z.string().email()
    const isEmailValid = emailSchema.safeParse(watchEmail).success

    if (isEmailValid && watchEmail.length > 0) {
      logger.log(
        '📧 RF Signin: Valid email detected, setting auto-advance timer:',
        watchEmail
      )
      const timer = setTimeout(() => {
        if (passwordRef.current) {
          passwordRef.current.focus()
          logger.log('✅ RF Signin: Auto-advanced to password field')
        }
      }, autoAdvanceDelay)

      setAutoAdvanceTimer(timer)
    }

    return () => {
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoAdvanceTimer is intentionally excluded; including it would create a set/re-run loop
  }, [watchEmail])

  // Auto-login when password meets criteria
  useEffect(() => {
    const passwordSchema = z.string().min(7)
    const isPasswordValid = passwordSchema.safeParse(watchPassword).success
    const emailSchema = z.string().email()
    const isEmailValid = emailSchema.safeParse(watchEmail).success

    if (isEmailValid && isPasswordValid && watchPassword.length >= 7) {
      logger.log(
        '🔑 RF Signin: Valid credentials detected, setting auto-login timer'
      )
      const timer = setTimeout(() => {
        logger.log('🚀 RF Signin: Triggering auto-login')
        form.handleSubmit(onSubmit)()
      }, autoAdvanceDelay)

      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSubmit is a non-memoized component function; its captured deps (signIn, navigate) are stable
  }, [watchEmail, watchPassword, form])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Unmount-only cleanup; adding autoAdvanceTimer would clear timer on every state change
  }, [])

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
                <ScannerInput
                  placeholder='name@example.com'
                  autoCapitalize='none'
                  autoCorrect='off'
                  spellCheck='false'
                  {...field}
                  ref={(el) => {
                    field.ref(el)
                    emailRef.current = el
                  }}
                />
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
                <ScannerPasswordInput
                  placeholder='********'
                  autoCapitalize='none'
                  autoCorrect='off'
                  spellCheck='false'
                  {...field}
                  ref={(el) => {
                    field.ref(el)
                    passwordRef.current = el
                  }}
                />
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

// RF Terminal Sign In Layout - matches main AuthLayout with iOS safe area support
function RFAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className='bg-primary-foreground container grid h-svh max-w-none items-center justify-center'
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[480px] sm:p-8'>
        <div className='mb-4 flex flex-col items-center justify-center space-y-4'>
          <div className='relative flex h-48 w-48 items-center justify-center overflow-hidden'>
            {/* Ripple Effect Rings - Using theme primary color for consistency */}
            <div className='border-primary/40 absolute h-24 w-24 rounded-full border-2 motion-safe:animate-[ripple_2.5s_ease-out_infinite]'></div>
            <div className='border-primary/30 absolute h-24 w-24 rounded-full border-2 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:0.5s]'></div>
            <div className='border-primary/25 absolute h-24 w-24 rounded-full border-2 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:1s]'></div>
            <div className='border-primary/20 absolute h-24 w-24 rounded-full border-2 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:1.5s]'></div>

            {/* Main Logo */}
            <img
              src='/images/favicon.svg'
              alt='OmniFrame Logo'
              className='relative z-10 h-24 w-24 motion-safe:animate-[pulse_6s_ease-in-out_infinite] motion-safe:animate-[spin_3s_linear_infinite]'
            />
          </div>
          <h1 className='text-xl font-medium'>OmniFrame</h1>
        </div>
        {children}
      </div>
    </div>
  )
}

// Main RF Sign In Component
export default function RFSignIn() {
  return (
    <RFAuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>Login</CardTitle>
          <CardDescription>
            Enter your email and password below to <br />
            log into your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RFAuthForm />
        </CardContent>
        <CardFooter>
          <p className='text-muted-foreground px-8 text-center text-sm'>
            By clicking login, you agree to our{' '}
            <a
              href='/terms'
              className='hover:text-primary underline underline-offset-4'
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href='/privacy'
              className='hover:text-primary underline underline-offset-4'
            >
              Privacy Policy
            </a>
            .
          </p>
        </CardFooter>
      </Card>
    </RFAuthLayout>
  )
}
