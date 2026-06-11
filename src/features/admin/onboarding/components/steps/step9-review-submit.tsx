// Created and developed by Jai Singh
/**
 * Step 9: Review & Submit
 * Review all entered data and complete onboarding
 * Updated: December 27, 2025 - Added printable documents for shift details and ID card
 */
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Award,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Key,
  MapPin,
  Shield,
  Smartphone,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import LaborManagementService, {
  type ShiftSchedule,
} from '@/lib/supabase/labor-management.service'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useOnboarding } from '../../context/onboarding-context'
import { EmployeePrintouts } from '../shared/employee-printouts'

interface SectionCardProps {
  title: string
  icon: React.ReactNode
  isValid: boolean
  onEdit: () => void
  children: React.ReactNode
}

function SectionCard({
  title,
  icon,
  isValid,
  onEdit,
  children,
}: SectionCardProps) {
  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-2 text-base'>
            {icon}
            {title}
            {isValid ? (
              <Check className='h-4 w-4 text-green-500' />
            ) : (
              <AlertCircle className='text-destructive h-4 w-4' />
            )}
          </CardTitle>
          <Button variant='ghost' size='sm' onClick={onEdit}>
            Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent className='pt-0'>{children}</CardContent>
    </Card>
  )
}

export function Step9ReviewSubmit() {
  const { state, goToStep, isStepValid } = useOnboarding()

  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id

  const {
    personalInfo,
    authenticationSetup,
    roleAssignment,
    positionAssignment,
    shiftSchedule,
    workingArea,
    certifications,
    devices,
    generatedCredentials,
  } = state

  // Fetch shift template if one was selected
  const [shiftTemplate, setShiftTemplate] = useState<ShiftSchedule | null>(null)

  useEffect(() => {
    const fetchShiftTemplate = async () => {
      if (shiftSchedule?.shift_schedule_id && organizationId) {
        try {
          const schedules =
            await LaborManagementService.getShiftSchedules(organizationId)
          const template = schedules.find(
            (s) => s.id === shiftSchedule.shift_schedule_id
          )
          if (template) {
            setShiftTemplate(template)
          }
        } catch (error) {
          logger.error('Failed to fetch shift template:', error)
        }
      }
    }
    fetchShiftTemplate()
  }, [shiftSchedule?.shift_schedule_id, organizationId])

  // Check all validations
  const allValid =
    isStepValid(1) &&
    isStepValid(2) &&
    isStepValid(3) &&
    isStepValid(4) &&
    isStepValid(5) &&
    isStepValid(6)

  const handleCopyCredentials = async () => {
    if (generatedCredentials) {
      const text = `
Email: ${generatedCredentials.email}
Password: ${generatedCredentials.password}
Badge Number: ${generatedCredentials.badgeNumber}
Login URL: ${generatedCredentials.loginUrl}
      `.trim()
      await navigator.clipboard.writeText(text)
      toast.success('Credentials copied to clipboard')
    }
  }

  // Show success dialog when credentials are available
  if (generatedCredentials) {
    return (
      <div className='space-y-6'>
        <Card className='border-green-500'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-green-600'>
              <CheckCircle2 className='h-6 w-6' />
              Onboarding Complete!
            </CardTitle>
            <CardDescription>
              The employee account has been created successfully
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-6'>
            <div className='py-4 text-center'>
              <h3 className='text-2xl font-bold'>
                {personalInfo?.first_name} {personalInfo?.last_name}
              </h3>
              <p className='text-muted-foreground'>
                {positionAssignment?.position_title}
              </p>
              <Badge className='mt-2'>{generatedCredentials.badgeNumber}</Badge>
            </div>

            <Alert>
              <Key className='h-4 w-4' />
              <AlertTitle>Login Credentials</AlertTitle>
              <AlertDescription className='mt-2 space-y-2'>
                <div className='grid gap-1'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Email:</span>
                    <span className='font-mono'>
                      {generatedCredentials.email}
                    </span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Password:</span>
                    <span className='font-mono'>
                      {generatedCredentials.password}
                    </span>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className='flex justify-center'>
              <Button variant='outline' onClick={handleCopyCredentials}>
                <Copy className='mr-2 h-4 w-4' />
                Copy Credentials
              </Button>
            </div>

            <Alert
              variant='destructive'
              className='border-amber-200 bg-amber-50 text-amber-800'
            >
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                These credentials will only be shown once. Make sure to save or
                print them before leaving this page. The employee should change
                their password on first login.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Print Documents Section */}
        <EmployeePrintouts
          personalInfo={personalInfo}
          positionAssignment={positionAssignment}
          shiftSchedule={shiftSchedule}
          shiftTemplate={shiftTemplate}
          credentials={generatedCredentials}
        />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <CheckCircle2 className='h-5 w-5' />
            Review & Submit
          </CardTitle>
          <CardDescription>
            Review all entered information before completing the onboarding
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!allValid && (
            <Alert variant='destructive' className='mb-6'>
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>Incomplete Information</AlertTitle>
              <AlertDescription>
                Please complete all required fields before submitting. Check the
                sections marked with errors.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Personal Information */}
      <SectionCard
        title='Personal Information'
        icon={<User className='h-4 w-4' />}
        isValid={isStepValid(1)}
        onEdit={() => goToStep(1)}
      >
        <div className='grid gap-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Name:</span>
            <span>
              {personalInfo?.first_name} {personalInfo?.last_name}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Email:</span>
            <span>{personalInfo?.email}</span>
          </div>
          {personalInfo?.phone_number && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Phone:</span>
              <span>{personalInfo.phone_number}</span>
            </div>
          )}
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Start Date:</span>
            <span>
              {personalInfo?.start_date
                ? new Date(personalInfo.start_date).toLocaleDateString()
                : 'Not set'}
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Authentication */}
      <SectionCard
        title='Authentication'
        icon={<Key className='h-4 w-4' />}
        isValid={isStepValid(2)}
        onEdit={() => goToStep(2)}
      >
        <div className='grid gap-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Password:</span>
            <span>
              {authenticationSetup?.auto_generate_password
                ? 'Auto-generated'
                : 'Manual'}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Auto-activate:</span>
            <Badge
              variant={
                authenticationSetup?.auto_activate ? 'default' : 'secondary'
              }
            >
              {authenticationSetup?.auto_activate ? 'Yes' : 'No'}
            </Badge>
          </div>
        </div>
      </SectionCard>

      {/* Role */}
      <SectionCard
        title='Role & Permissions'
        icon={<Shield className='h-4 w-4' />}
        isValid={isStepValid(3)}
        onEdit={() => goToStep(3)}
      >
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground'>Role:</span>
          <Badge>{roleAssignment?.role_name || 'Not selected'}</Badge>
        </div>
      </SectionCard>

      {/* Position */}
      <SectionCard
        title='Position Assignment'
        icon={<Briefcase className='h-4 w-4' />}
        isValid={isStepValid(4)}
        onEdit={() => goToStep(4)}
      >
        <div className='grid gap-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Position:</span>
            <span>{positionAssignment?.position_title || 'Not selected'}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Supervisor:</span>
            <span>{positionAssignment?.supervisor_name || 'Not selected'}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Type:</span>
            <Badge variant='outline'>
              {positionAssignment?.assignment_type || 'permanent'}
            </Badge>
          </div>
        </div>
      </SectionCard>

      {/* Schedule */}
      <SectionCard
        title='Shift Schedule'
        icon={<Clock className='h-4 w-4' />}
        isValid={isStepValid(5)}
        onEdit={() => goToStep(5)}
      >
        <div className='grid gap-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Pattern:</span>
            <Badge variant='outline'>{shiftSchedule?.shift_pattern}</Badge>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Hours:</span>
            <span>
              {shiftSchedule?.shift_start_time} -{' '}
              {shiftSchedule?.shift_end_time}
            </span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Days:</span>
            <span>{shiftSchedule?.working_days?.length || 0} days/week</span>
          </div>
        </div>
      </SectionCard>

      {/* Working Area */}
      <SectionCard
        title='Working Area'
        icon={<MapPin className='h-4 w-4' />}
        isValid={isStepValid(6)}
        onEdit={() => goToStep(6)}
      >
        <div className='grid gap-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Primary Area:</span>
            <span>{workingArea?.primary_area_name || 'Not selected'}</span>
          </div>
          {workingArea?.secondary_areas &&
            workingArea.secondary_areas.length > 0 && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Secondary Areas:</span>
                <span>{workingArea.secondary_areas.length}</span>
              </div>
            )}
        </div>
      </SectionCard>

      {/* Certifications */}
      <SectionCard
        title='Certifications'
        icon={<Award className='h-4 w-4' />}
        isValid={true}
        onEdit={() => goToStep(7)}
      >
        <div className='text-sm'>
          {certifications.length === 0 ? (
            <span className='text-muted-foreground'>
              No certifications added
            </span>
          ) : (
            <div className='flex flex-wrap gap-2'>
              {certifications.map((cert, i) => (
                <Badge key={i} variant='secondary'>
                  {cert.certification_name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Devices */}
      <SectionCard
        title='Devices'
        icon={<Smartphone className='h-4 w-4' />}
        isValid={true}
        onEdit={() => goToStep(8)}
      >
        <div className='text-sm'>
          {devices.length === 0 ? (
            <span className='text-muted-foreground'>No devices assigned</span>
          ) : (
            <div className='flex flex-wrap gap-2'>
              {devices.map((device, i) => (
                <Badge key={i} variant='secondary'>
                  {device.device_name || device.device_type}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

export default Step9ReviewSubmit

// Created and developed by Jai Singh
