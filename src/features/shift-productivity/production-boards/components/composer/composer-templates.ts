// Created and developed by Jai Singh
/**
 * Starter templates for the Post Composer. Each template is a shallow
 * patch over `defaultsForKind(kind)`; the composer applies the patch on
 * "Use template" click and leaves all other fields (audience,
 * attachments, accent) untouched so the curator can switch templates
 * without losing in-flight uploads.
 *
 * Adding a new template? Keep the body short and end with a TODO marker
 * so it's clear the curator is expected to fill in specifics before
 * publishing.
 */
import type {
  ComposerValues,
  JobKindData,
  PostKind,
  SafetyAlertKindData,
} from './composer-types'

export interface ComposerTemplate {
  id: string
  label: string
  description: string
  patch: Partial<ComposerValues>
}

export const TEMPLATES_BY_KIND: Record<PostKind, ComposerTemplate[]> = {
  announcement: [
    {
      id: 'announcement.plant_shutdown',
      label: 'Plant shutdown',
      description: 'Annual maintenance / extended downtime notice.',
      patch: {
        title: 'Plant Shutdown Notice',
        body:
          'The plant will be closed for [reason] from [start date] through [end date]. ' +
          'No production runs, deliveries, or scheduled meetings during this window.\n\n' +
          'Questions: contact [name] at [phone / email].',
        priority: 'high',
        accentHex: '#ea580c',
      },
    },
    {
      id: 'announcement.shift_change',
      label: 'Shift schedule change',
      description: 'New shift hours starting [date].',
      patch: {
        title: 'Shift Schedule Update',
        body:
          'Effective [date], the [shift] start time moves to [HH:MM]. ' +
          'Please review your timekeeping kiosk for the new schedule.',
        priority: 'normal',
      },
    },
    {
      id: 'announcement.kudos',
      label: 'Floor kudos',
      description: 'Recognise an associate or team achievement.',
      patch: {
        title: 'Big Kudos',
        body: 'Shout-out to [team / name] for [achievement]. Keep it up!',
        priority: 'normal',
        accentHex: '#16a34a',
      },
    },
  ],
  hr_news: [
    {
      id: 'hr_news.benefits_open_enrollment',
      label: 'Benefits open enrollment',
      description: 'Annual benefits window reminder.',
      patch: {
        title: 'Benefits Open Enrollment',
        body:
          'Open enrollment runs [start] – [end]. Review your options at [link]. ' +
          'HR is hosting drop-in sessions in the breakroom every [day] from [time].',
        priority: 'high',
        kindData: { category: 'benefits' },
      },
    },
    {
      id: 'hr_news.handbook_update',
      label: 'Handbook update',
      description: 'New / revised policy.',
      patch: {
        title: 'Handbook Update',
        body:
          'The [section] policy has been updated. The new version is in effect [date]. ' +
          'A summary of the changes is attached.',
        priority: 'normal',
        kindData: { category: 'policy' },
      },
    },
    {
      id: 'hr_news.community_event',
      label: 'Community event',
      description: 'Volunteer day / company picnic / fundraiser.',
      patch: {
        title: 'Community Event',
        body:
          'Join us on [date] for [event]. Sign up by [deadline]. ' +
          'Food and t-shirts provided.',
        priority: 'normal',
        kindData: { category: 'culture' },
      },
    },
  ],
  job: [
    {
      id: 'job.forklift_operator',
      label: 'Forklift operator',
      description: 'Internal forklift role.',
      patch: {
        title: 'Forklift Operator',
        body: 'Operate sit-down / reach lifts in the [shift] shift.',
        jobDepartment: 'Outbound',
        jobRequirements:
          'Valid forklift certification or willingness to certify. ' +
          'Comfortable lifting up to 50 lbs. Six months of warehouse experience preferred.',
        jobApplyEmail: '',
        priority: 'normal',
        kindData: {
          employment_type: 'full_time',
          pay_min: 21,
          pay_max: 24,
          pay_currency: 'USD',
          pay_period: 'hour',
        } satisfies JobKindData,
      },
    },
    {
      id: 'job.maintenance_tech',
      label: 'Maintenance technician',
      description: 'Facility maintenance role.',
      patch: {
        title: 'Maintenance Technician',
        jobDepartment: 'Maintenance',
        body:
          'Perform preventative + corrective maintenance on conveyors, ' +
          'forklifts, and material-handling equipment.',
        jobRequirements:
          '2+ years maintenance experience. Comfortable reading electrical schematics. ' +
          'OSHA-10 preferred.',
        priority: 'normal',
        kindData: {
          employment_type: 'full_time',
          pay_min: 28,
          pay_max: 36,
          pay_currency: 'USD',
          pay_period: 'hour',
        } satisfies JobKindData,
      },
    },
    {
      id: 'job.internship',
      label: 'Summer internship',
      description: 'Operations / logistics intern.',
      patch: {
        title: 'Operations Intern (Summer)',
        body:
          'Shadow shift supervisors, support continuous-improvement projects, ' +
          'and complete a capstone project.',
        jobDepartment: 'Operations',
        jobRequirements:
          'Currently enrolled in an undergraduate program. ' +
          'Interest in supply chain / industrial engineering.',
        priority: 'normal',
        kindData: {
          employment_type: 'intern',
          pay_min: 20,
          pay_max: 24,
          pay_currency: 'USD',
          pay_period: 'hour',
        } satisfies JobKindData,
      },
    },
  ],
  safety_alert: [
    {
      id: 'safety.near_miss',
      label: 'Near miss',
      description: 'Recent near-miss with prevention guidance.',
      patch: {
        title: 'Near Miss — please review',
        body:
          'On [date / shift], a near miss occurred at [location]. ' +
          'No injuries. Root cause: [cause]. Corrective action: [action].\n\n' +
          'Please be aware while working in this area.',
        severity: 'warning',
        priority: 'high',
        acknowledgmentRequired: true,
        kindData: {
          hazard_type: 'other',
          corrective_action:
            'Awareness reminder + supervisor walkthrough this shift.',
        } satisfies SafetyAlertKindData,
      },
    },
    {
      id: 'safety.spill',
      label: 'Spill / leak',
      description: 'Active spill with cleanup status.',
      patch: {
        title: 'Spill on [aisle / location]',
        body:
          'A [substance] spill has been reported at [location]. Avoid the area until ' +
          'cleanup is complete. Notify [contact] if you observe further leaks.',
        severity: 'danger',
        priority: 'pinned',
        acknowledgmentRequired: true,
        repromptIntervalMinutes: 60,
        kindData: {
          hazard_type: 'spill',
          corrective_action: 'Spill kit deployed; barricade in place.',
        } satisfies SafetyAlertKindData,
      },
    },
    {
      id: 'safety.lockout_tagout',
      label: 'Lockout / tagout in progress',
      description: 'LOTO underway on [equipment].',
      patch: {
        title: 'LOTO in progress — [equipment]',
        body:
          '[Equipment] is locked / tagged out for [reason]. ' +
          'Do NOT remove the LOTO without authorization from [owner].',
        severity: 'warning',
        priority: 'high',
        acknowledgmentRequired: true,
        kindData: {
          hazard_type: 'lockout_tagout',
          corrective_action: 'LOTO sign-off required from [owner].',
        } satisfies SafetyAlertKindData,
      },
    },
  ],
}

// Created and developed by Jai Singh
