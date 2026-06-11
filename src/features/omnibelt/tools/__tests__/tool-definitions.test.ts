// Created and developed by Jai Singh
/**
 * OmniBelt — TOOL_REGISTRY contract tests (P4 + 2026-05-24 PM)
 *
 * Locks the v1 9-tool roster (the spec §11.2 8-tool baseline plus
 * the post-P9 `agent_chat` addition) to its structural invariants.
 * These are intentionally structural — the resolved-tools hook
 * covers the runtime filter pipeline; this file just makes sure
 * each `ToolDef` is well-formed and the registry as a whole is
 * sane.
 *
 * Why each assertion exists:
 *   - Unique `id` — used as a Zustand store key and a panel
 *     `data-tool-id` selector; collisions silently lose state.
 *   - `navigationUrl` xor `shell` — the `ToolTile` renderer
 *     branches on this; both-set or neither-set means the tile
 *     does nothing on click. The type allows it; the test bans it.
 *   - Permission shape — when present, must be a non-empty
 *     `{ action, resource }` pair so `usePermissionStore.hasPermission`
 *     receives strings (it returns `false` for empty inputs).
 *   - Icon — must be a callable component; the registry types
 *     this as `ComponentType` but a stale lazy import or `undefined`
 *     trips a runtime React warning.
 *   - Accent — must be one of the 8 tokens that `ToolTile`
 *     understands; a bad value means an unstyled disc.
 *   - Category — must be one of the 4 panel-tab buckets.
 */
import { describe, expect, it } from 'vitest'
import {
  TOOL_REGISTRY,
  type ToolAccent,
  type ToolCategory,
  type ToolDef,
} from '../registry'

const ALLOWED_ACCENTS: readonly ToolAccent[] = [
  'teal',
  'blue',
  'violet',
  'amber',
  'rose',
  'lime',
  'cyan',
  'indigo',
]

const ALLOWED_CATEGORIES: readonly ToolCategory[] = [
  'operations',
  'admin',
  'self',
  'help',
]

const EXPECTED_V1_IDS: readonly string[] = [
  'quick_pick',
  'sap_status',
  'inventory_lookup',
  'background_jobs',
  'agent_chat',
  'quick_note',
  'build_info',
  'settings_shortcut',
  'help_docs',
]

describe('TOOL_REGISTRY — v1 roster shape', () => {
  it('exports exactly the 9 v1 tools in canonical order', () => {
    expect(TOOL_REGISTRY.map((t) => t.id)).toEqual(EXPECTED_V1_IDS)
  })

  it('every id is unique', () => {
    const ids = TOOL_REGISTRY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe.each(TOOL_REGISTRY.map((tool) => [tool.id, tool] as const))(
  'tool %s',
  (_id, tool: ToolDef) => {
    it('declares either navigationUrl or shell, not both and not neither', () => {
      const hasNav =
        typeof tool.navigationUrl === 'string' && tool.navigationUrl.length > 0
      const hasShell = typeof tool.shell === 'function'
      expect(hasNav || hasShell).toBe(true)
      expect(hasNav && hasShell).toBe(false)
    })

    it('permission (when present) is a non-empty {action, resource} pair', () => {
      if (!tool.permission) return
      expect(typeof tool.permission.action).toBe('string')
      expect(tool.permission.action.length).toBeGreaterThan(0)
      expect(typeof tool.permission.resource).toBe('string')
      expect(tool.permission.resource.length).toBeGreaterThan(0)
    })

    it('icon is a renderable component', () => {
      // tabler / lucide icons are functions (or forwardRef objects); both
      // are callable values. Anything else means a stale or default
      // import slipped through.
      const iconType = typeof tool.icon
      expect(['function', 'object']).toContain(iconType)
      expect(tool.icon).toBeTruthy()
    })

    it('accent is one of the 8 allowed tones', () => {
      expect(ALLOWED_ACCENTS).toContain(tool.accent)
    })

    it('category is one of the 4 panel buckets', () => {
      expect(ALLOWED_CATEGORIES).toContain(tool.category)
    })

    it('label is a non-empty string', () => {
      expect(typeof tool.label).toBe('string')
      expect(tool.label.length).toBeGreaterThan(0)
    })

    it('searchable is a boolean', () => {
      expect(typeof tool.searchable).toBe('boolean')
    })
  }
)

// Created and developed by Jai Singh
