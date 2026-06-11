// Created and developed by Jai Singh
import { useState } from 'react'
import {
  workEngineSettingsService,
  type WorkEngineSettingsRow,
} from '@/lib/supabase/work-engine-settings.service'
import {
  WORK_ENGINE_FLAG_DEFAULTS,
  type WorkEngineFlagKey,
} from '@/lib/work-engine/flags'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

const FLAG_HELP: Record<WorkEngineFlagKey, string> = {
  work_engine_enabled:
    'Master gate. When false, RF + supervisor surfaces stay on the legacy cycle-count code paths.',
  work_tasks_shadow_write:
    'Enable migration-257 sync triggers for this org. Required before read-shadow / read-primary cutover.',
  work_tasks_read_shadow:
    'Read both legacy and work_tasks; report drift; serve legacy. Used during canary.',
  work_tasks_read_primary:
    'Source of truth flip — work_tasks becomes authoritative for this org.',
  work_tasks_rollback_to_legacy:
    'Break-glass. Forces legacy reads/writes regardless of other flags. Only used during incident response.',
  push_preflight_zone_check:
    'Retain Migration-252 supervisor preflight panel that blocks pushes into a zone with active conflicts.',
  worker_capability_required:
    'When true, claim filters by worker_capabilities strictly with no fall-back. Risk: orgs that haven’t populated capabilities will starve.',
  signed_url_photos:
    'Switch evidence photo reads from public URL to short-lived signed URL. Required when storage buckets become private.',
}

interface Props {
  orgId: string | null
  engine: WorkEngineSettingsRow | null
  onChange: () => void
}

export function FeatureFlagsTab({ orgId, engine, onChange }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<WorkEngineFlagKey | null>(null)

  if (!engine) {
    return (
      <Card className='text-muted-foreground p-4 text-sm'>
        No work engine row for this org yet.
      </Card>
    )
  }

  const flags = engine.feature_flags ?? {}

  async function setFlag(key: WorkEngineFlagKey, value: boolean) {
    if (!orgId) return
    setError(null)
    setPending(key)
    try {
      const next = { ...flags, [key]: value }
      await workEngineSettingsService.updateEngineSettings(orgId, {
        feature_flags: next,
      })
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className='space-y-3'>
      {error && (
        <Card className='border-rose-500/50 bg-rose-500/5 p-3 text-sm text-rose-600'>
          {error}
        </Card>
      )}
      {(Object.keys(WORK_ENGINE_FLAG_DEFAULTS) as WorkEngineFlagKey[]).map(
        (key) => {
          const current =
            key in flags ? Boolean(flags[key]) : WORK_ENGINE_FLAG_DEFAULTS[key]
          const isBreakGlass = key === 'work_tasks_rollback_to_legacy'
          return (
            <Card
              key={key}
              className={`flex items-start justify-between gap-4 p-4 ${
                isBreakGlass ? 'border-rose-500/40' : ''
              }`}
            >
              <div className='space-y-1'>
                <div className='font-medium'>
                  <code>{key}</code>{' '}
                  {isBreakGlass && (
                    <span className='ml-2 text-xs tracking-wide text-rose-600 uppercase'>
                      break-glass
                    </span>
                  )}
                </div>
                <p className='text-muted-foreground text-sm'>
                  {FLAG_HELP[key]}
                </p>
                <p className='text-muted-foreground text-xs'>
                  Default: {String(WORK_ENGINE_FLAG_DEFAULTS[key])}
                </p>
              </div>
              <Switch
                checked={current}
                onCheckedChange={(v) => setFlag(key, v)}
                disabled={pending === key}
              />
            </Card>
          )
        }
      )}
    </div>
  )
}

// Created and developed by Jai Singh
