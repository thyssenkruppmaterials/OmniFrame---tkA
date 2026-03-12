import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Key, Loader2, Eye, EyeOff } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PasswordInput } from '@/components/password-input'
import { useUserManagement } from '../hooks/use-user-management'
import { passwordResetSchema, type PasswordResetFormData } from '../types'

interface PasswordResetDialogProps {
  userId: string | null
  userEmail: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PasswordResetDialog({
  userId,
  userEmail,
  open,
  onOpenChange,
}: PasswordResetDialogProps) {
  const { resetPassword, isResettingPassword } = useUserManagement()
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<PasswordResetFormData>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: {
      new_password: '',
      confirm_password: '',
      send_email: true,
    },
  })

  const onSubmit = async (data: PasswordResetFormData) => {
    if (!userId) return

    try {
      await resetPassword(userId, data)
      onOpenChange(false)
      form.reset()
    } catch (error) {
      logger.error('Error resetting password:', error)
    }
  }

  const generatePassword = () => {
    const length = 12
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''

    // Ensure at least one character from each category
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]
    password += '0123456789'[Math.floor(Math.random() * 10)]
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)]

    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)]
    }

    // Shuffle the password
    password = password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('')

    form.setValue('new_password', password)
    form.setValue('confirm_password', password)
  }

  // const watchSendEmail = form.watch('send_email')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Reset the password for {userEmail}. The new password will be set
            immediately.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Key className='h-4 w-4' />
          <AlertDescription>
            This will immediately update the user's password. The user will need
            to use the new password to log in.
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='new_password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <div className='flex space-x-2'>
                    <FormControl className='flex-1'>
                      <PasswordInput
                        placeholder='Enter new password'
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className='h-4 w-4' />
                      ) : (
                        <Eye className='h-4 w-4' />
                      )}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='confirm_password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder='Confirm new password'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='flex justify-between'>
              <Button
                type='button'
                variant='outline'
                onClick={generatePassword}
                size='sm'
              >
                Generate Secure Password
              </Button>
            </div>

            <FormField
              control={form.control}
              name='send_email'
              render={({ field }) => (
                <FormItem className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4'>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className='space-y-1 leading-none'>
                    <FormLabel>Send Email Notification</FormLabel>
                    <p className='text-muted-foreground text-sm'>
                      Notify the user via email that their password has been
                      reset by an administrator.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <div className='flex justify-end space-x-2 pt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={isResettingPassword}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isResettingPassword}>
                {isResettingPassword && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Reset Password
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Standalone component for use in table actions
export function PasswordResetDialogTrigger() {
  const [open, setOpen] = useState(false)
  const [selectedUser] = useState<{ id: string; email: string } | null>(null)

  return (
    <>
      <PasswordResetDialog
        userId={selectedUser?.id || null}
        userEmail={selectedUser?.email || null}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
