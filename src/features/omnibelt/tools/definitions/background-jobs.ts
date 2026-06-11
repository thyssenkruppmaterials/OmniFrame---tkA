// Created and developed by Jai Singh
/**
 * OmniBelt — Background Jobs tool (P4)
 *
 * Self-tab panel shell listing the user's currently-running
 * background jobs. The full live list (with cancel buttons + halo
 * progress) lands in P5 alongside `useOmnibeltJobs`; P4 ships a
 * stub shell that points users at the existing work-queue admin
 * surface. Documented as a P4 deviation.
 *
 * Permission: none — visibility is implicitly gated by job
 * ownership, which the future P5 hook enforces by filtering on
 * `worker_id = currentUserId`.
 */
import { IconListTree } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const backgroundJobsTool: ToolDef = {
  id: 'background_jobs',
  label: 'Background Jobs',
  description: 'Active background-job status (Mach 3 lands in P5)',
  icon: IconListTree,
  accent: 'amber',
  category: 'self',
  searchable: true,
  shell: () => import('../shells/BackgroundJobsShell'),
}

// Created and developed by Jai Singh
