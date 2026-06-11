// Created and developed by Jai Singh
import type { WorkflowStepConfig } from '@/lib/supabase/workflow-config.service'

export interface StepProps {
  step: WorkflowStepConfig
  taskData: {
    count_number: string
    material_number: string
    material_description: string | null
    location: string
    warehouse: string | null
    unit_of_measure: string
    system_quantity: number
    counted_quantity: number | null
    count_type: string | null
    priority: string
    // Found Part Transfer (migration 222 + 223). When present, `location`
    // is the SOURCE (A) and `transfer_destination_location` is the
    // DESTINATION (B). Always projected by the parent RF shell so steps
    // can rely on it.
    transfer_destination_location?: string | null
    transfer_source_quantity?: number | null
  }
  stepResult: Record<string, unknown>
  onComplete: (result: Record<string, unknown>) => void
  onBack: () => void
  isProcessing?: boolean
}

// Created and developed by Jai Singh
