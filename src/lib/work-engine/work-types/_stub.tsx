// Created and developed by Jai Singh
/**
 * Disabled-stub helper. Each follow-on plan imports `disabledStub({...})`
 * to declare a minimum-shape WorkTypeConfig that fails loudly if it ever
 * gets instantiated, while still satisfying the registry exhaustiveness
 * gate.
 */
import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { WorkTask, WorkTypeId } from '@/lib/work-service/work-task-types'
import type { WorkTypeConfig } from '../types'

export function disabledStub(args: {
  id: WorkTypeId
  label: string
  shortLabel: string
  icon: LucideIcon
}): WorkTypeConfig<WorkTask> {
  function NotImplemented(): ReactElement {
    throw new Error(
      `WorkType '${args.id}' is registered but not enabled. Ship its follow-on plan to use it.`
    )
  }
  return {
    id: args.id,
    label: args.label,
    shortLabel: args.shortLabel,
    icon: args.icon,
    defaultSteps: [],
    RootComponent: NotImplemented as unknown as React.FC<{
      task: WorkTask
      onExit: () => void
    }>,
    buildResultPayload: () => ({}),
    enabled: false,
    dockMenuLabel: null,
  }
}

// Created and developed by Jai Singh
