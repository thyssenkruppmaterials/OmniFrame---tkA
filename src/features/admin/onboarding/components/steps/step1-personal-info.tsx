/**
 * Step 1: Personal Information
 * Collect basic employee details
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  User,
  Mail,
  Phone,
  Calendar,
  Building,
  AlertCircle,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { useOnboarding } from '../../context/onboarding-context'
import {
  PersonalInfoData,
  personalInfoSchema,
} from '../../types/onboarding.types'

export function Step1PersonalInfo() {
  const { state, updateStepData } = useOnboarding()

  const form = useForm<PersonalInfoData>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: state.personalInfo || {
      first_name: '',
      last_name: '',
      email: '',
      phone_number: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      employee_id: '',
      start_date: new Date().toISOString().split('T')[0],
      department: '',
      avatar_url: null,
    },
    mode: 'onChange',
  })

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        updateStepData('personalInfo', data as PersonalInfoData)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, updateStepData])

  const initials =
    `${form.watch('first_name')?.[0] || ''}${form.watch('last_name')?.[0] || ''}`.toUpperCase() ||
    'NU'

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <User className='h-5 w-5' />
            Personal Information
          </CardTitle>
          <CardDescription>
            Enter the new employee's basic information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Avatar Preview */}
              <div className='flex items-center gap-4'>
                <Avatar className='h-20 w-20'>
                  <AvatarImage src={form.watch('avatar_url') || undefined} />
                  <AvatarFallback className='text-lg'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className='text-sm font-medium'>Employee Photo</p>
                  <p className='text-muted-foreground text-xs'>
                    Photo can be added after account creation
                  </p>
                </div>
              </div>

              {/* Name Fields */}
              <div className='grid gap-4 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='first_name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input placeholder='John' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='last_name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input placeholder='Doe' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Email */}
              <FormField
                control={form.control}
                name='email'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='flex items-center gap-2'>
                      <Mail className='h-4 w-4' />
                      Email Address *
                    </FormLabel>
                    <FormControl>
                      <Input
                        type='email'
                        placeholder='john.doe@company.com'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      This will be used for login credentials
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phone */}
              <FormField
                control={form.control}
                name='phone_number'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='flex items-center gap-2'>
                      <Phone className='h-4 w-4' />
                      Phone Number
                    </FormLabel>
                    <FormControl>
                      <Input
                        type='tel'
                        placeholder='+1 (555) 123-4567'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Start Date & Department */}
              <div className='grid gap-4 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='start_date'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2'>
                        <Calendar className='h-4 w-4' />
                        Start Date *
                      </FormLabel>
                      <FormControl>
                        <Input type='date' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='department'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2'>
                        <Building className='h-4 w-4' />
                        Department
                      </FormLabel>
                      <FormControl>
                        <Input placeholder='Operations' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Employee ID */}
              <FormField
                control={form.control}
                name='employee_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee ID / Badge Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='Leave blank for auto-generation'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      If left blank, a badge number will be generated
                      automatically
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Emergency Contact */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <AlertCircle className='h-5 w-5' />
            Emergency Contact
          </CardTitle>
          <CardDescription>
            Optional emergency contact information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <div className='grid gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='emergency_contact_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl>
                      <Input placeholder='Jane Doe' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='emergency_contact_phone'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Phone</FormLabel>
                    <FormControl>
                      <Input
                        type='tel'
                        placeholder='+1 (555) 987-6543'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Step1PersonalInfo
