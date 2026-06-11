// Created and developed by Jai Singh
/**
 * Step 2: Authentication Setup
 * Configure login credentials
 */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Key, RefreshCw, Eye, EyeOff, Copy, Check, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useOnboarding } from '../../context/onboarding-context'
import {
  AuthenticationSetupData,
  authenticationSetupSchema,
} from '../../types/onboarding.types'

// Generate a secure password
const generatePassword = (length: number = 12): string => {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lowercase = 'abcdefghjkmnpqrstuvwxyz'
  const numbers = '23456789'
  const special = '!@#$%^&*'

  const all = uppercase + lowercase + numbers + special
  let password = ''

  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += special[Math.floor(Math.random() * special.length)]

  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)]
  }

  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

export function Step2Authentication() {
  const { state, updateStepData } = useOnboarding()
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)

  const form = useForm<AuthenticationSetupData>({
    resolver: zodResolver(authenticationSetupSchema) as never,
    defaultValues: state.authenticationSetup || {
      auto_generate_password: true,
      password: '',
      generated_password: generatePassword(),
      auto_activate: true,
      send_welcome_email: false,
    },
    mode: 'onChange',
  })

  const autoGenerate = form.watch('auto_generate_password')
  const currentPassword = autoGenerate
    ? form.watch('generated_password')
    : form.watch('password')

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        updateStepData('authenticationSetup', data as AuthenticationSetupData)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, updateStepData])

  const regeneratePassword = () => {
    const newPassword = generatePassword()
    form.setValue('generated_password', newPassword)
    toast.success('New password generated')
  }

  const copyPassword = async () => {
    if (currentPassword) {
      await navigator.clipboard.writeText(currentPassword)
      setCopied(true)
      toast.success('Password copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Key className='h-5 w-5' />
            Authentication Setup
          </CardTitle>
          <CardDescription>
            Configure login credentials for the new employee
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Auto-generate toggle */}
              <FormField
                control={form.control}
                name='auto_generate_password'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                    <div className='space-y-0.5'>
                      <FormLabel className='text-base'>
                        Auto-generate Password
                      </FormLabel>
                      <FormDescription>
                        Generate a secure random password automatically
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Password Field */}
              {autoGenerate ? (
                <div className='space-y-2'>
                  <FormLabel>Generated Password</FormLabel>
                  <div className='flex gap-2'>
                    <div className='relative flex-1'>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={form.watch('generated_password') || ''}
                        readOnly
                        className='pr-20 font-mono'
                      />
                      <div className='absolute top-1/2 right-2 flex -translate-y-1/2 gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7'
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className='h-4 w-4' />
                          ) : (
                            <Eye className='h-4 w-4' />
                          )}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7'
                          onClick={copyPassword}
                        >
                          {copied ? (
                            <Check className='h-4 w-4 text-green-500' />
                          ) : (
                            <Copy className='h-4 w-4' />
                          )}
                        </Button>
                      </div>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={regeneratePassword}
                    >
                      <RefreshCw className='mr-2 h-4 w-4' />
                      Regenerate
                    </Button>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    Make sure to save this password securely. It will only be
                    shown once.
                  </p>
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name='password'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className='relative'>
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder='Enter a secure password'
                            {...field}
                            className='pr-10'
                          />
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2'
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? (
                              <EyeOff className='h-4 w-4' />
                            ) : (
                              <Eye className='h-4 w-4' />
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Must be at least 8 characters with uppercase, lowercase,
                        number, and special character
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Auto-activate */}
              <FormField
                control={form.control}
                name='auto_activate'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                    <div className='space-y-0.5'>
                      <FormLabel className='text-base'>
                        Auto-activate Account
                      </FormLabel>
                      <FormDescription>
                        Immediately activate the account without email
                        verification
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Send welcome email */}
              <FormField
                control={form.control}
                name='send_welcome_email'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                    <div className='space-y-0.5'>
                      <FormLabel className='text-base'>
                        Send Welcome Email
                      </FormLabel>
                      <FormDescription>
                        Send an email with login instructions to the employee
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Security Notice */}
      <Alert>
        <Shield className='h-4 w-4' />
        <AlertTitle>Security Notice</AlertTitle>
        <AlertDescription>
          Credentials will be shown once after onboarding is complete. You can
          print or save them for secure handoff to the new employee. The
          password should be changed on first login.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default Step2Authentication

// Created and developed by Jai Singh
