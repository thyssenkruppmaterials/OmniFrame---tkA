// Created and developed by Jai Singh
/**
 * WorkType Registry (Phase 4.2).
 *
 * Single source of truth mapping `WorkTypeId` → `WorkTypeConfig`.
 *
 * `enabledWorkTypes(orgId)` checks `work_engine_settings.enabled_work_types`
 * + per-type `work_type_settings.enabled`. Today only `cycle_count` returns
 * true by default; Zoning/Picking flip on through their own follow-on plans.
 */
import { workEngineSettingsService } from '@/lib/supabase/work-engine-settings.service'
import type { WorkTypeId, WorkTask } from '@/lib/work-service/work-task-types'
import { assertWorkTypeConfigComplete, type WorkTypeConfig } from './types'
import { cycleCountWorkType } from './work-types/cycle-count'
import { kitPickWorkType } from './work-types/kit-pick'
import { pickWorkType } from './work-types/pick'
import { putawayWorkType } from './work-types/putaway'
import { replenishWorkType } from './work-types/replenish'
import { zoneAuditWorkType } from './work-types/zone-audit'

export const workTypeRegistry: Record<WorkTypeId, WorkTypeConfig<WorkTask>> = {
  cycle_count: cycleCountWorkType as unknown as WorkTypeConfig<WorkTask>,
  zone_audit: zoneAuditWorkType,
  pick: pickWorkType,
  putaway: putawayWorkType,
  replenish: replenishWorkType,
  kit_pick: kitPickWorkType,
}

// Phase 9.1 / 13.4 "registry exhaustiveness" gate.
for (const cfg of Object.values(workTypeRegistry)) {
  assertWorkTypeConfigComplete(cfg as WorkTypeConfig)
}

export async function enabledWorkTypes(orgId: string): Promise<WorkTypeId[]> {
  const engine = await workEngineSettingsService.getEngineSettings(orgId)
  const types = await workEngineSettingsService.listWorkTypeSettings(orgId)
  const allowed = new Set<string>(engine?.enabled_work_types ?? ['cycle_count'])
  return types
    .filter((t) => t.enabled && allowed.has(t.task_type))
    .map((t) => t.task_type as WorkTypeId)
    .filter((id) => id in workTypeRegistry)
}

// Created and developed by Jai Singh
