import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { authService } from '@/lib/auth/auth-service'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'

// Available avatar options
const AVATAR_OPTIONS = [
  { value: 'none', label: 'Default (Initials)', color: 'gradient' },
  { value: '/avatars/avatar-1.svg', label: 'Blue', color: '#3b82f6' },
  { value: '/avatars/avatar-2.svg', label: 'Green', color: '#10b981' },
  { value: '/avatars/avatar-3.svg', label: 'Orange', color: '#f59e0b' },
  { value: '/avatars/avatar-4.svg', label: 'Purple', color: '#8b5cf6' },
  { value: '/avatars/avatar-5.svg', label: 'Red', color: '#ef4444' },
  { value: '/avatars/avatar-6.svg', label: 'Pink', color: '#ec4899' },
  { value: '/avatars/avatar-7.svg', label: 'Teal', color: '#14b8a6' },
  { value: '/avatars/avatar-8.svg', label: 'Indigo', color: '#6366f1' },
]

const profileFormSchema = z.object({
  avatar_url: z.string().optional(),
  first_name: z.string().min(1, 'First name is required.').max(50),
  last_name: z.string().min(1, 'Last name is required.').max(50),
  username: z
    .string()
    .min(2, 'Username must be at least 2 characters.')
    .max(30, 'Username must not be longer than 30 characters.')
    .optional(),
  bio: z.string().max(500).optional(),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

export default function ProfileForm() {
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState
  const [isLoading, setIsLoading] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null)

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      avatar_url: profile?.avatar_url || 'none',
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      username: profile?.username || '',
      bio:
        ((profile?.metadata as Record<string, unknown> | null)
          ?.bio as string) || '',
    },
    mode: 'onChange',
  })

  // Initialize selected avatar from profile
  useEffect(() => {
    const avatarValue = profile?.avatar_url || 'none'
    setSelectedAvatar(avatarValue)
    form.setValue('avatar_url', avatarValue)
  }, [profile?.avatar_url, form])

  const handleAvatarSelect = (avatarUrl: string) => {
    setSelectedAvatar(avatarUrl)
    form.setValue('avatar_url', avatarUrl)
  }

  const onSubmit = async (data: ProfileFormValues) => {
    if (!user?.id) {
      toast.error('User not authenticated')
      return
    }

    setIsLoading(true)
    try {
      // Update profile with avatar and other fields
      // Note: full_name is a generated column, so we don't update it directly
      await authService.updateProfile(user.id, {
        avatar_url: data.avatar_url === 'none' ? null : data.avatar_url,
        first_name: data.first_name,
        last_name: data.last_name,
        username: data.username,
        metadata: {
          ...(profile?.metadata as Record<string, unknown>),
          bio: data.bio,
        },
      })

      // Refresh profile to get updated data - this will trigger re-renders throughout the app
      if (user?.id) {
        await authService.getUserProfile(user.id)
      }

      // Force a page reload to ensure all components reflect the new avatar
      window.location.reload()

      toast.success(
        'Profile updated successfully! Your avatar will now appear across the application.'
      )
    } catch (error: unknown) {
      logger.error('Error updating profile:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to update profile'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const getUserInitials = () => {
    if (profile?.full_name) {
      const parts = profile.full_name.split(' ')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      }
      return profile.full_name.substring(0, 2).toUpperCase()
    }
    return 'U'
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
        {/* Avatar Selection */}
        <div className='space-y-4'>
          <FormLabel>Profile Picture</FormLabel>

          {/* Current Avatar Preview */}
          <div className='bg-muted/50 flex items-center space-x-4 rounded-lg p-4'>
            <Avatar className='border-primary/20 h-20 w-20 border-2'>
              {selectedAvatar && selectedAvatar !== 'none' ? (
                <AvatarImage src={selectedAvatar} alt='Profile' />
              ) : null}
              <AvatarFallback
                className={
                  selectedAvatar === 'none'
                    ? 'from-primary to-primary/70 text-primary-foreground bg-gradient-to-br text-2xl font-bold'
                    : 'text-2xl font-bold'
                }
              >
                {getUserInitials()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className='text-sm font-medium'>Current Avatar</p>
              <p className='text-muted-foreground text-xs'>
                {selectedAvatar === 'none'
                  ? 'Using initials as avatar'
                  : 'Select an avatar from the options below'}
              </p>
            </div>
          </div>

          <div className='flex flex-col items-start space-y-2'>
            {/* Avatar Grid */}
            <div className='relative z-10 ml-2 grid w-full max-w-full grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9'>
              {AVATAR_OPTIONS.map((option) => (
                <Card
                  key={option.value}
                  className={cn(
                    'relative flex-shrink-0 cursor-pointer transition-all hover:scale-105',
                    selectedAvatar === option.value
                      ? 'ring-primary ring-offset-background z-20 ring-2 ring-offset-2'
                      : 'hover:ring-muted-foreground/50 hover:ring-2'
                  )}
                  onClick={() => handleAvatarSelect(option.value)}
                >
                  <div className='aspect-square p-2'>
                    <Avatar className='h-full w-full'>
                      {option.value !== 'none' ? (
                        <AvatarImage src={option.value} alt={option.label} />
                      ) : null}
                      <AvatarFallback
                        className={
                          option.color === 'gradient'
                            ? 'from-primary to-primary/70 text-primary-foreground bg-gradient-to-br'
                            : ''
                        }
                      >
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                    {selectedAvatar === option.value && (
                      <div className='bg-primary absolute -top-1 -right-1 z-30 flex h-5 w-5 items-center justify-center rounded-full'>
                        <Check className='text-primary-foreground h-3 w-3' />
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* First Name */}
        <FormField
          control={form.control}
          name='first_name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input placeholder='John' {...field} />
              </FormControl>
              <FormDescription>
                Your first name as it will appear throughout the application.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Last Name */}
        <FormField
          control={form.control}
          name='last_name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name</FormLabel>
              <FormControl>
                <Input placeholder='Doe' {...field} />
              </FormControl>
              <FormDescription>
                Your last name as it will appear throughout the application.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Username */}
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username (Optional)</FormLabel>
              <FormControl>
                <Input placeholder='johndoe' {...field} />
              </FormControl>
              <FormDescription>
                This is your public display name. It can be your real name or a
                pseudonym.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Bio */}
        <FormField
          control={form.control}
          name='bio'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder='Tell us a little bit about yourself'
                  className='h-24 resize-none'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Brief description about yourself. Maximum 500 characters.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type='submit' disabled={isLoading}>
          {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {isLoading ? 'Updating...' : 'Update Profile'}
        </Button>
      </form>
    </Form>
  )
}
