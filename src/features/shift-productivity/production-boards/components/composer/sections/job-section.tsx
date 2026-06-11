// Created and developed by Jai Singh
/**
 * Job-specific extras section.
 *
 * Multi-block: employment type + pay range + hiring manager + apply route.
 * The Department / Apply URL / Apply Email / Internal toggle live on the
 * shell because they map directly to columns on
 * `production_board_job_postings`, not to `kind_data`.
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  JOB_EMPLOYMENT_TYPES,
  JOB_PAY_PERIODS,
  type ComposerValues,
  type JobKindData,
} from '../composer-types'
import { Section } from '../section'

interface JobSectionProps {
  values: ComposerValues
  kindData: JobKindData
  onChange: (next: JobKindData) => void
  onShellChange: (delta: Partial<ComposerValues>) => void
  disabled?: boolean
}

const PAY_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'MXN']

export function JobSection({
  values,
  kindData,
  onChange,
  onShellChange,
  disabled,
}: JobSectionProps) {
  const patch = (delta: Partial<JobKindData>): void => {
    onChange({ ...kindData, ...delta })
  }

  const numericOrUndefined = (raw: string): number | undefined => {
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

  return (
    <>
      <Section
        title='Job details'
        description='Role, department, employment type.'
      >
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-department'>Department</Label>
            <Input
              id='job-department'
              placeholder='Outbound, Maintenance, …'
              value={values.jobDepartment ?? ''}
              onChange={(e) =>
                onShellChange({ jobDepartment: e.target.value || null })
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-employment-type'>Employment type</Label>
            <Select
              value={kindData.employment_type ?? ''}
              onValueChange={(v) =>
                patch({
                  employment_type:
                    (v as JobKindData['employment_type']) || undefined,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger id='job-employment-type'>
                <SelectValue placeholder='Select…' />
              </SelectTrigger>
              <SelectContent>
                {JOB_EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className='capitalize'>
                    {t.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='border-border/40 bg-background flex items-center justify-between gap-2 rounded-md border p-3'>
          <div>
            <Label className='mt-0!'>Internal posting</Label>
            <p className='text-muted-foreground text-xs'>
              External postings still render on the board; mark internal if
              it&apos;s org-only.
            </p>
          </div>
          <Switch
            checked={values.jobIsInternal}
            onCheckedChange={(v) => onShellChange({ jobIsInternal: v })}
            disabled={disabled}
          />
        </div>
      </Section>

      <Section
        title='Pay range'
        description='Optional — leave blank to omit from the card.'
      >
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_120px_140px]'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-pay-min'>Min</Label>
            <Input
              id='job-pay-min'
              type='number'
              step='0.01'
              min='0'
              value={kindData.pay_min ?? ''}
              onChange={(e) =>
                patch({ pay_min: numericOrUndefined(e.target.value) })
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-pay-max'>Max</Label>
            <Input
              id='job-pay-max'
              type='number'
              step='0.01'
              min='0'
              value={kindData.pay_max ?? ''}
              onChange={(e) =>
                patch({ pay_max: numericOrUndefined(e.target.value) })
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-pay-currency'>Currency</Label>
            <Select
              value={kindData.pay_currency ?? 'USD'}
              onValueChange={(v) => patch({ pay_currency: v })}
              disabled={disabled}
            >
              <SelectTrigger id='job-pay-currency'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-pay-period'>Period</Label>
            <Select
              value={kindData.pay_period ?? ''}
              onValueChange={(v) =>
                patch({
                  pay_period: (v as JobKindData['pay_period']) || undefined,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger id='job-pay-period'>
                <SelectValue placeholder='—' />
              </SelectTrigger>
              <SelectContent>
                {JOB_PAY_PERIODS.map((p) => (
                  <SelectItem key={p} value={p} className='capitalize'>
                    {p === 'hour'
                      ? '/ hour'
                      : p === 'year'
                        ? '/ year'
                        : `/ ${p}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <Section
        title='How to apply'
        description='URL, email, or both. At least one is recommended.'
      >
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-apply-url'>Application URL</Label>
            <Input
              id='job-apply-url'
              placeholder='https://…'
              value={values.jobApplyUrl ?? ''}
              onChange={(e) =>
                onShellChange({ jobApplyUrl: e.target.value || null })
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-apply-email'>Application email</Label>
            <Input
              id='job-apply-email'
              placeholder='careers@…'
              type='email'
              value={values.jobApplyEmail ?? ''}
              onChange={(e) =>
                onShellChange({ jobApplyEmail: e.target.value || null })
              }
              disabled={disabled}
            />
          </div>
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-hm-name'>Hiring manager name</Label>
            <Input
              id='job-hm-name'
              placeholder='Pat Quinn'
              value={kindData.hiring_manager_name ?? ''}
              onChange={(e) =>
                patch({
                  hiring_manager_name: e.target.value || undefined,
                })
              }
              disabled={disabled}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='job-hm-email'>Hiring manager email</Label>
            <Input
              id='job-hm-email'
              placeholder='pat.quinn@example.com'
              type='email'
              value={kindData.hiring_manager_email ?? ''}
              onChange={(e) =>
                patch({
                  hiring_manager_email: e.target.value || undefined,
                })
              }
              disabled={disabled}
            />
          </div>
        </div>
      </Section>

      <Section
        title='Requirements'
        description='Bulleted list works well — line breaks are preserved.'
      >
        <textarea
          rows={4}
          placeholder='• 1 year warehouse experience&#10;• Forklift cert (or willing to certify)'
          value={values.jobRequirements ?? ''}
          onChange={(e) =>
            onShellChange({ jobRequirements: e.target.value || null })
          }
          disabled={disabled}
          className='border-input bg-background focus-visible:ring-ring min-h-[100px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
        />
      </Section>
    </>
  )
}

// Created and developed by Jai Singh
