/**
 * Step 6: Working Area Assignment
 * Assign primary and secondary work locations
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Users, X, AlertTriangle } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnboarding } from '../../context/onboarding-context'
import { OnboardingService } from '../../services/onboarding.service'
import {
  WorkingAreaData,
  workingAreaSchema,
} from '../../types/onboarding.types'

export function Step6WorkingArea() {
  const { state, updateStepData } = useOnboarding()
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  // Fetch working areas
  const { data: areas, isLoading } = useQuery({
    queryKey: ['onboarding-areas', organizationId],
    queryFn: () => OnboardingService.getAvailableWorkingAreas(organizationId!),
    enabled: !!organizationId,
  })

  const form = useForm<WorkingAreaData>({
    resolver: zodResolver(workingAreaSchema),
    defaultValues: state.workingArea || {
      primary_area_id: '',
      primary_area_name: '',
      secondary_areas: [],
    },
    mode: 'onChange',
  })

  const primaryAreaId = form.watch('primary_area_id')
  const secondaryAreas = form.watch('secondary_areas') || []
  const primaryArea = areas?.find((a) => a.id === primaryAreaId)

  // Watch form changes and update context
  useEffect(() => {
    const subscription = form.watch((data) => {
      if (data) {
        updateStepData('workingArea', data as WorkingAreaData)
      }
    })
    return () => subscription.unsubscribe()
  }, [form, updateStepData])

  // Update display name when primary area changes
  useEffect(() => {
    if (primaryArea) {
      form.setValue('primary_area_name', primaryArea.area_name)
    }
  }, [primaryArea, form])

  const addSecondaryArea = (areaId: string) => {
    const area = areas?.find((a) => a.id === areaId)
    if (area && !secondaryAreas.find((s) => s.area_id === areaId)) {
      form.setValue('secondary_areas', [
        ...secondaryAreas,
        { area_id: areaId, area_name: area.area_name },
      ])
    }
  }

  const removeSecondaryArea = (areaId: string) => {
    form.setValue(
      'secondary_areas',
      secondaryAreas.filter((s) => s.area_id !== areaId)
    )
  }

  const availableSecondaryAreas = areas?.filter(
    (a) =>
      a.id !== primaryAreaId && !secondaryAreas.find((s) => s.area_id === a.id)
  )

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <MapPin className='h-5 w-5' />
            Working Area Assignment
          </CardTitle>
          <CardDescription>
            Assign the employee to their work location(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className='space-y-6'>
              {/* Primary Area Selection */}
              <FormField
                control={form.control}
                name='primary_area_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Working Area *</FormLabel>
                    <FormControl>
                      {isLoading ? (
                        <Skeleton className='h-10 w-full' />
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select primary area...' />
                          </SelectTrigger>
                          <SelectContent>
                            {areas?.map((area) => (
                              <SelectItem key={area.id} value={area.id}>
                                <div className='flex items-center gap-2'>
                                  <span>{area.area_name}</span>
                                  <Badge variant='outline' className='text-xs'>
                                    {area.area_type}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormDescription>
                      The main location where this employee will work
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Primary Area Details */}
              {primaryArea && (
                <div className='space-y-3 rounded-lg border p-4'>
                  <h4 className='font-medium'>{primaryArea.area_name}</h4>
                  <div className='grid gap-2 text-sm'>
                    <div className='flex items-center gap-2'>
                      <Users className='text-muted-foreground h-4 w-4' />
                      <span className='text-muted-foreground'>Capacity:</span>
                      <span>{primaryArea.capacity || 'Unlimited'}</span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <span className='text-muted-foreground'>Type:</span>
                      <Badge variant='secondary'>{primaryArea.area_type}</Badge>
                    </div>
                    {primaryArea.requires_certification && (
                      <Alert className='mt-2'>
                        <AlertTriangle className='h-4 w-4' />
                        <AlertDescription>
                          This area requires certification. Make sure to add
                          required certifications in the next step.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Secondary Areas */}
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Secondary Areas (Optional)</CardTitle>
          <CardDescription>
            Add additional areas where this employee may work
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {/* Current Secondary Areas */}
          {secondaryAreas.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              {secondaryAreas.map((area) => (
                <Badge
                  key={area.area_id}
                  variant='secondary'
                  className='flex items-center gap-1 pr-1'
                >
                  <MapPin className='h-3 w-3' />
                  {area.area_name}
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='hover:bg-destructive hover:text-destructive-foreground h-4 w-4 rounded-full'
                    onClick={() => removeSecondaryArea(area.area_id)}
                  >
                    <X className='h-3 w-3' />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          {/* Add Secondary Area */}
          {availableSecondaryAreas && availableSecondaryAreas.length > 0 && (
            <div className='flex gap-2'>
              <Select onValueChange={addSecondaryArea}>
                <SelectTrigger className='flex-1'>
                  <SelectValue placeholder='Add secondary area...' />
                </SelectTrigger>
                <SelectContent>
                  {availableSecondaryAreas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      <div className='flex items-center gap-2'>
                        <span>{area.area_name}</span>
                        <Badge variant='outline' className='text-xs'>
                          {area.area_type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {secondaryAreas.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              No secondary areas assigned. Employee will work only in the
              primary area.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Step6WorkingArea
