// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowDownAZ,
  ArrowLeftRight,
  ArrowUpAZ,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Cpu,
  Download,
  Eye,
  FileEdit,
  FileSearch,
  Info,
  Layers,
  Loader2,
  Package,
  PackageMinus,
  PackagePlus,
  PlayCircle,
  Repeat,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Terminal,
  Video,
  Wallet,
  Warehouse,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useOrgId } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import {
  appendInventoryAdjustmentRow,
  inventoryAdjustmentStagingQueryKey,
  type InventoryAdjustmentStagingInsert,
} from '@/lib/supabase/inventory-adjustment-staging.service'
import { cn } from '@/lib/utils'
// Phase 5 (rust-work-service full-integration plan, 2026-05-06) —
// Material Master mutations now route through the rust-work-service
// `/api/v1/sap-mutations/material-master` endpoint instead of
// directly POSTing to the local agent. The route layers five
// defence-in-depth checks (role gate, per-material concurrency lock,
// per-org rate limit, pre-flight audit row, idempotency-keyed job
// INSERT) ahead of the actual `sap_agent_jobs` INSERT, so even a
// stolen JWT or a runaway batch loop is bounded server-side. See
// `Implementations/Implement-Rust-Work-Service-Phase5.md`.
import {
  postMaterialMasterMutation,
  SapMutationError,
  type MaterialMasterMutation as MaterialMasterMutationBody,
} from '@/lib/work-service/sap-mutations-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
// Phase 6 (rust-work-service integration plan, 2026-05-07) — WS bridge
// that pushes `WsEvent::SapAgentConsoleLine` events into the shared
// console buffer. See `hooks/use-agent-console-stream.ts`.
import { useAgentConsoleStream } from '../hooks/use-agent-console-stream'
import {
  refreshAgentDetection,
  suppressLocalProbe,
  unsuppressLocalProbe,
  useAgentDetection,
} from '../hooks/use-agent-detection'
// 2026-05-09 — Inventory Management fleet-routing toggle. `useExecutionMode`
// owns the local-vs-fleet routing decision for the entire tab; `dispatch()`
// is the single entry-point that BOTH paths funnel through. See
// [[Implementations/Implement-Inventory-Management-Fleet-Routing]].
import { useExecutionMode } from '../hooks/use-execution-mode'
import { useJobQueue } from '../hooks/use-job-queue'
import { useLL01History } from '../hooks/use-ll01-history'
// Phase 8 (rust-work-service full-integration plan, 2026-05-06) —
// consolidated dashboard fetch. The hook drives BOTH the
// "Pin to agent" picker AND the WS-invalidation chain that keeps it
// fresh on `SapAgentChanged` / `SapJobStatusChanged` /
// `RfPutawayChanged` events. The legacy `useOnlineSapAgents` import
// above is the Phase 11 fallback path — it stays in the tree for one
// release window in case the new endpoint hits a deploy issue. See
// `Implementations/Implement-Rust-Work-Service-Phase8.md`.
import { useSapTestingDashboard } from '../hooks/use-sap-testing-dashboard'
import {
  agentFetch,
  hasCapability,
  isAgentOutdated,
  // v1.7.2 — user-facing copy now references LATEST_AGENT_VERSION so
  // the "available" banner reads "v1.7.2 available" rather than the
  // misleading "v1.4.0 available" the MIN_REQUIRED_AGENT_VERSION
  // constant produced (1.4.0 was the FLOOR — what the frontend will
  // tolerate — not what we actually want users to upgrade to).
  // `isAgentOutdated` still gates on MIN_REQUIRED_AGENT_VERSION below
  // so we don't break older-but-functional agents.
  LATEST_AGENT_VERSION,
  type AgentHealth as SharedAgentHealth,
} from '../lib/agent-fetch'
import { logSapAudit } from '../lib/sap-audit'
import { AgentNotDetectedBanner } from './agent-not-detected-banner'
import { AgentSupabaseStatusButton } from './agent-supabase-status-button'
// `AgentHealthCard`, `AgentsFleetCard`, and `RecentJobsCard` are mounted
// in the Agent Triggers tab's "Fleet & Diagnostics" section (audit gaps
// FE-1 / FE-2 closed 2026-05-07) so all fleet observability lives next
// to the server-side trigger runtime that depends on it. The inventory
// tab keeps `useOnlineSapAgents` only for the BatchModePanel "Pin to
// agent" picker — Phase 11 fallback path for the new
// `useSapTestingDashboard` consolidation.
import { useOnlineSapAgents } from './agents-fleet-card'
// 2026-05-07 — Inventory Adjustment workflow. Renders as a `kind: 'tool'`
// entry in the Query Library (sibling pattern to RecorderPanel /
// ReversalPanel) and is fed by the new `+ Add to Inv. Adjust` LT10
// row action below. Backed by migration 288 + the agent's
// `/sap/zmm60/lookup` endpoint (capability `zmm60-price-lookup`).
import { InventoryAdjustmentView } from './inventory-adjustment-view'
import {
  LX25_WAREHOUSES,
  type InventoryCompletionResult,
} from './inventory-completion-types'
// 2026-05-10 — LX25 Inventory Completion fan-out across 5 warehouses.
// Custom result renderer (NOT a flat-table query) that surfaces the
// aggregate completion stat card + 5 per-warehouse cards + detail
// table. Backed by the agent's `/sap/lx25/inventory-completion`
// endpoint (capability `lx25-inventory-completion`). See
// [[Implementations/Implement-LX25-Inventory-Completion]].
import { InventoryCompletionView } from './inventory-completion-view'
import { InventoryExecutionModeToggle } from './inventory-execution-mode-toggle'
import { LL01HistoryPicker } from './ll01-history-picker'
import {
  MaterialMasterDryRunDialog,
  type DryRunInputRow,
} from './material-master-dry-run-dialog'
import { RecorderPanel } from './recorder-panel'
import { ReversalPanel } from './reversal-panel'
import {
  SapConsoleCard,
  useSapConsole,
  type PushConsole,
} from './sap-console-card'
// v1.7.9 — shared SAP session picker (pin-aware). Replaces the inline
// <select> when the agent advertises `sap-session-pinning`; older
// agents fall back to the legacy dropdown so functionality doesn't
// regress when the user is on an older EXE.
import { SapSessionPicker, type SapSessionsPayload } from './sap-session-picker'
// 2026-05-09 — TO History (LT24) migrated from the standalone admin
// tab into the Query Library. Replaces the flat-table results view
// with a Journey/Timeline visualization. See
// `transfer-order-history-view.tsx` for the rendering details.
import { TransferOrderHistoryView } from './transfer-order-history-view'
import {
  LL01_PLANTS,
  type LL01Progress,
  type LL01RunResult,
} from './warehouse-activity-monitor-types'
import { WarehouseActivityMonitorView } from './warehouse-activity-monitor-view'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

type AgentHealth = SharedAgentHealth

// v1.7.9 — single alias delegating to the shared picker payload type so
// the `/sap/sessions` shape (now augmented with system/client/user/
// pinned/is_active per session + a top-level `pinned_session` echo) is
// in one place. The picker types stay compatible with the v1.7.8 shape
// (all v1.7.9 fields are optional) so older agents still parse.
type SapSessionsData = SapSessionsPayload

// v1.7.2 — `'unauthenticated'` joins the family. The agent process is
// reachable on /health but `/agent-token/check` 401's, indicating a
// stale localStorage X-Agent-Token (or, post-v1.7.2 with JWT refresh,
// a stale Supabase JWT that GoTrue's refresh path also rejected). We
// surface this distinctly so the AgentHealthCard / status bar can
// render the right "Reconnect Account" CTA instead of the misleading
// "Agent Disconnected" copy a missing process would warrant. Mirrors
// the parallel state added in `agent-triggers-tab.tsx` for v1.6.5.
type AgentStatus = 'checking' | 'connected' | 'unauthenticated' | 'missing'

interface QueryColumn {
  id: string
  title: string
}

interface QueryResult {
  ok: boolean
  columns?: QueryColumn[]
  rows?: Record<string, string>[]
  total?: number
  meta?: Record<string, unknown>
  error?: string
}

interface QueryInputField {
  name: string
  label: string
  placeholder?: string
  required?: boolean
  defaultValue?: string
  help?: string
}

/** Maps a friendly display column to a raw SAP column from the agent.
 *
 * The agent's _extract_sap_list_output returns columns whose `title`
 * is the SAP-rendered header (often abbreviated like "Typ", "Plnt",
 * "Avail.stck"). A QueryColumnSpec lets each query map those raw
 * titles to readable display titles in a stable, ordered way.
 */
interface QueryColumnSpec {
  /** Display title shown in the table header (e.g. "Storage Type"). */
  title: string
  /** SAP raw column title to match. Case-insensitive trim equality. */
  match: string
  /** When the SAP output has multiple columns sharing this raw title
   *  (e.g. two "S" columns for Stock Category + Special Stock), pick
   *  by 0-based position-in-output. Defaults to 0. */
  matchIndex?: number
  /** Optional value formatter. */
  format?: 'number' | 'date' | 'plain'
  /** Per-column tailwind classes to merge into the cell. */
  className?: string
}

// ──────────────────────────────────────────────────────────────────────
// SAP Console types (ConsoleLevel / ConsoleMessage / PushConsole) are
// imported from `./sap-console-card`.
// ──────────────────────────────────────────────────────────────────────

/** Pre-fill payload sent to the Transfer Inventory dialog. When `manual`
 *  is true the source-side fields (material/warehouse/plant/storage
 *  location/source bin) become editable so users can trigger an LT01
 *  transfer without having first run an LT10 query — see the
 *  "Transfer Inventory (LT01)" entry-point button in the LT10 active
 *  query panel. Row-driven opens (the per-row dropdown action) leave
 *  `manual` undefined/false and keep those fields read-only. */
interface TransferInventoryPrefill {
  warehouse: string
  material: string
  plant: string
  storageLocation: string
  sourceStorageType: string
  sourceStorageBin: string
  manual?: boolean
  // v2.0.1 follow-up — carry the source-row stock attributes so the
  // dialog can prefill BESTQ / SOBKZ / LSONR without the user having
  // to retype values that LT10 already showed in the grid. All three
  // are optional: row actions opened from older LT10 layouts (or from
  // manual mode) leave them undefined and the dialog falls back to
  // blank inputs. Print Destination (LDEST) is intentionally NOT here
  // — it's a per-action override of the user's default printer, not
  // a row attribute, so it always starts blank.
  sourceStockCategory?: string
  sourceSpecialStockIndicator?: string
  sourceSpecialStockNumber?: string
}

/** Pre-fill payload sent to the Bin Blocks dialog. */
interface BinBlocksPrefill {
  warehouse: string
  storageType: string
  storageBin: string
  material: string
  putawayBlocked: boolean
  stockRemovalBlocked: boolean
}

/** Payload sent into `addToInventoryAdjustment` from a row action. The
 *  parent owns the actual ZMM60 call + Supabase INSERT so the action
 *  handler stays a single function call. */
interface AddToInventoryAdjustmentInput {
  material: string
  plant: string
  storageType: string
  storageLocation: string
  storageBin: string
  totalStock: number
}

/** Context passed into row-action onClick handlers so they can read
 *  query-level inputs (warehouse, etc.) and open dialogs without
 *  needing direct access to React state. */
interface QueryActionContext {
  /** Current values of the query's input fields keyed by input name. */
  queryInputs: Record<string, string>
  /** Open the "Transfer Inventory" (LT01) dialog pre-filled with row data. */
  openTransferDialog: (data: TransferInventoryPrefill) => void
  /** Open the "Bin Blocks" (LS02N) dialog pre-filled with row data. */
  openBinBlocksDialog: (data: BinBlocksPrefill) => void
  /** 2026-05-07 — Inventory Adjustment workflow. Calls ZMM60 via the
   *  agent and INSERTs a `inventory_adjustment_staging` row on success.
   *  The parent owns the orgId + queryClient so the row action stays
   *  a one-liner. Returns void; outcome is communicated via toasts. */
  addToInventoryAdjustment: (input: AddToInventoryAdjustmentInput) => void
}

/** A row-action exposed via the leading "Selection" dropdown column. */
interface QueryRowAction {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  /** Called when the user picks this action from the dropdown.
   *  `value(title)` looks up cell values by friendly column title.
   *  `ctx` exposes query-level inputs and dialog openers. */
  onClick: (
    row: Record<string, string>,
    value: (specTitle: string) => string,
    ctx: QueryActionContext
  ) => void
  /** Phase B8 — capability id required by this action. When the agent
   *  doesn't report it in /health, the action is shown but disabled
   *  with a tooltip explaining the agent is too old. */
  requiredCapability?: string
}

/** Aggregate summary card displayed above the results table. */
interface QueryStatSpec {
  id: string
  label: string
  /** Friendly column title to sum across all filtered rows. */
  sumColumn: string
  /** Optional formatter — defaults to integer with thousands separator. */
  format?: (n: number) => string
  icon?: React.ComponentType<{ className?: string }>
  /** Tailwind text color for the value. Defaults to foreground. */
  accentClass?: string
}

interface QueryDefinition {
  id: string
  name: string
  description: string
  transaction: string
  /** Handler name for read-only `/sap/query` queries. Ignored when
   *  `mutationEndpoint` is set. */
  handler: string
  category: 'inventory' | 'warehouse' | 'custom' | 'master-data' | 'tools'
  icon: React.ComponentType<{ className?: string }>
  /** Optional discriminator. When `'tool'`, the entry renders a custom
   *  React component instead of the standard form/results layout. Used
   *  by Phase D #12 (Self-Recording Mode) — a non-query, non-mutation
   *  feature that still belongs in the same Query Library sidebar. */
  kind?: 'query' | 'mutation' | 'tool'
  /** When `kind === 'tool'`, the id of the tool component to render. */
  toolId?: 'recorder' | 'reversal-engine' | 'inventory-adjustment'
  inputs: QueryInputField[]
  /** When set, the form posts to this agent endpoint with the input
   *  fields as JSON body (snake_case key = input.name). The query is
   *  treated as a write action — no results table is rendered, but
   *  console messages are emitted on success/failure. */
  mutationEndpoint?: string
  /** When true (mutations only), show a Batch Mode panel that lets
   *  users paste a CSV of rows and execute them sequentially with
   *  a progress bar. Each row's columns map by position to the order
   *  of `inputs` above. */
  batchable?: boolean
  /** Column IDs to show by default. If empty, all columns show. */
  defaultColumns?: string[]
  /** Any column IDs that should be hidden by default. */
  hiddenColumns?: string[]
  /** When provided, replaces the raw column list with this curated
   *  ordered set of friendly columns. The first column rendered will
   *  always be the Selection (action button) column. */
  columns?: QueryColumnSpec[]
  /** Optional predicate to drop noise rows (SAP list output sometimes
   *  includes header/separator lines as data). Return true to keep.
   *  `value(specTitle)` looks up cell values by friendly column title
   *  defined in `columns`, so the filter is independent of agent
   *  column ids (which are positional like `c0_0`, `c1_3`). */
  rowFilter?: (
    row: Record<string, string>,
    value: (specTitle: string) => string
  ) => boolean
  /** Available actions for the leading Selection dropdown column.
   *  When present, the Selection column is rendered. */
  rowActions?: QueryRowAction[]
  /** Optional summary stat cards rendered above the results table.
   *  Each stat sums a friendly column across all filtered rows. */
  stats?: QueryStatSpec[]
  /** Phase B8 — capability id required by this query/mutation. The
   *  Run button is disabled with an "agent too old" tooltip when the
   *  capability isn't reported by the running agent. */
  requiredCapability?: string
  /** Phase D #11 — when set, BatchModePanel and the single-row Run
   *  button gain a Preview path: each row is read via this MM03
   *  display-mode endpoint first, the diff is shown to the user, and
   *  only confirmed (and optionally diff-only) rows go to
   *  `mutationEndpoint`. Currently used by the two Material Master
   *  entries; pair with `dryRunCapability` so older agents fall back
   *  to the existing direct-commit flow. */
  dryRunEndpoint?: string
  dryRunCapability?: string
}

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const INPUT_HISTORY_KEY = 'omniframe.inventory_query_inputs.v1'
/** Persistent SAP Console buffer for the Inventory Management tab.
 *  See `sap-console-card.tsx → useSapConsole` for storage semantics. */
const INVENTORY_CONSOLE_KEY = 'omniframe.inventory_console.v1'
const LAST_BATCH_KEY_PREFIX = 'omniframe.last_batch.'
const QUEUE_MODE_KEY = 'omniframe.batch_queue_mode.v1'
// 2026-05-09 — LT24 personal layout (ctxtLISTV). Each user maintains
// their own SAP layout (e.g. "JSINGHX") for the LT24 selection screen,
// so we persist it per-browser rather than baking it into the shared
// per-query input history (INPUT_HISTORY_KEY). The agent's `handler_lt24`
// already accepts an optional `layout` param — empty ⇒ no layout applied.
const LT24_LAYOUT_KEY = 'omniframe.sap-testing.lt24.layout'
// 2026-05-09 — LT24 BDATU date range (ctxtBDATU-LOW / ctxtBDATU-HIGH).
// Persisted per-browser like LT24_LAYOUT_KEY: an LT24 user typically
// re-runs the same date window across many materials/TOs while
// investigating a shipment, so re-typing the range each time is
// friction. Default empty (no auto-default to today/yesterday) — a
// blank value means "no date filter" and the agent skips the BDATU
// writes entirely. Stored as ISO `YYYY-MM-DD` (the native value of
// `<input type="date">`); the agent's `_format_sap_date` converts
// to MM/DD/YYYY before the SAP GUI write.
const LT24_DATE_FROM_KEY = 'omniframe.sap-testing.lt24.date-from'
const LT24_DATE_TO_KEY = 'omniframe.sap-testing.lt24.date-to'

// LT10 Bin Status Report column mapping. SAP's report renders headers
// in compact abbreviations (Typ, Plnt, SLoc, Avail.stck etc.) — this
// map renames them to their full names from the SAP layout panel and
// orders them how a warehouse user expects to read them.
//
// Header order (per the 2026-05-07 UpdatedLT10 export):
//   Sl  Typ  Plnt  SLoc  StorageBin  Material  Stock  Avail.stck
//   PutawayStk  Pick qty  S  S  Last inv.  Batch  IA  PB  RB
//   Special Stock Number
//
// "Special Stock Number" is new in this layout and only ever populated
// when the row's Special Stock indicator is set (e.g. "Q" project →
// WBS / handling-unit id). Older LT10 exports without the column
// continue to parse cleanly because the position-keyed `matchIndex`
// scheme falls through gracefully — the column simply renders empty.
const LT10_COLUMNS: QueryColumnSpec[] = [
  { title: 'Storage Type', match: 'Typ' },
  { title: 'Plant', match: 'Plnt' },
  { title: 'Storage Location', match: 'SLoc' },
  { title: 'Storage Bin', match: 'StorageBin' },
  { title: 'Material', match: 'Material' },
  { title: 'Total Stock', match: 'Stock', format: 'number' },
  { title: 'Available Stock', match: 'Avail.stck', format: 'number' },
  { title: 'Stock for Putaway', match: 'PutawayStk', format: 'number' },
  { title: 'Pick Quantity', match: 'Pick qty', format: 'number' },
  // SAP renders both Stock Category and Special Stock as just "S" —
  // disambiguate by position-in-header.
  { title: 'Stock Category', match: 'S', matchIndex: 0 },
  { title: 'Special Stock', match: 'S', matchIndex: 1 },
  { title: 'Special Stock Number', match: 'Special Stock Number' },
  { title: 'Last Inventory', match: 'Last Inv.', format: 'date' },
  { title: 'Batch', match: 'Batch' },
  { title: 'Inventory Active', match: 'IA' },
  { title: 'Putaway Block', match: 'PB' },
  { title: 'Stock Removal Block', match: 'RB' },
]

// LT10 row filter — drops the metadata header lines that SAP's list
// output prepends (e.g. "Whse number  WH5", "Stge type  *") and the
// trailing totals row (no Material). A real data row always has a
// non-empty Material column. Uses the `value(specTitle)` helper
// because agent row keys are positional ids like `c0_0`, not titles.
const LT10_ROW_FILTER = (
  _row: Record<string, string>,
  value: (specTitle: string) => string
): boolean => {
  return Boolean(value('Material'))
}

/** Human-friendly label for the `category` discriminator. Used by the
 *  active query crumb header so the layout reads like a breadcrumb
 *  (e.g. "Warehouse / LT10") instead of just the raw enum value. */
function categoryLabel(category: QueryDefinition['category']): string {
  switch (category) {
    case 'inventory':
      return 'Inventory'
    case 'warehouse':
      return 'Warehouse'
    case 'master-data':
      return 'Master Data'
    case 'tools':
      return 'Tools'
    case 'custom':
      return 'Custom'
    default:
      return category
  }
}

// Subtle category accent stripes used in the Query Library (left edge bar)
// and the Form panel eyebrow. Hand-picked so the four work-categories read
// as distinct without competing with status colours (red/amber/emerald
// already mean error/warn/ok in this tab).
const CATEGORY_ACCENT: Record<
  QueryDefinition['category'],
  {
    bar: string
    text: string
    icon: string
    bg: string
  }
> = {
  warehouse: {
    bar: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    icon: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  inventory: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    icon: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  'master-data': {
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    icon: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  tools: {
    bar: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    icon: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  custom: {
    bar: 'bg-slate-500',
    text: 'text-slate-600 dark:text-slate-400',
    icon: 'text-slate-500',
    bg: 'bg-slate-500/10',
  },
}

const QUERY_LIBRARY: QueryDefinition[] = [
  {
    id: 'lt10-bin-stock',
    name: 'Bin Stock by Material',
    description:
      'LT10 — Stock Transfer: Start. Single-screen lookup that returns every storage bin containing the given material, with available/actual stock, TO number, last movement, batch, and bin details.',
    transaction: 'LT10',
    handler: 'lt10',
    category: 'warehouse',
    icon: Boxes,
    requiredCapability: 'lt10',
    columns: LT10_COLUMNS,
    rowFilter: LT10_ROW_FILTER,
    rowActions: [
      {
        id: 'transfer-inventory',
        label: 'Transfer Inventory',
        icon: ArrowLeftRight,
        requiredCapability: 'transfer-inventory',
        onClick: (_row, value, ctx) => {
          const material = value('Material')
          const bin = value('Storage Bin')
          const stype = value('Storage Type')
          if (!material || !bin) {
            toast.error('Missing material or bin on this row')
            return
          }
          ctx.openTransferDialog({
            warehouse: ctx.queryInputs.warehouse ?? '',
            material,
            plant: value('Plant'),
            storageLocation: value('Storage Location'),
            sourceStorageType: stype,
            sourceStorageBin: bin,
            // v2.0.1 follow-up — carry the row's stock attributes
            // through so the dialog can prefill them. `value()` returns
            // '' for missing cells (older LT10 layouts without the
            // Special Stock Number column simply pass undefined-after-
            // empty-trim, which the dialog treats as "not present").
            sourceStockCategory: value('Stock Category'),
            sourceSpecialStockIndicator: value('Special Stock'),
            sourceSpecialStockNumber: value('Special Stock Number'),
          })
        },
      },
      {
        id: 'bin-blocks',
        label: 'Bin Blocks',
        icon: ShieldOff,
        requiredCapability: 'bin-blocks',
        onClick: (_row, value, ctx) => {
          const bin = value('Storage Bin')
          const stype = value('Storage Type')
          if (!bin) {
            toast.error('No storage bin on this row')
            return
          }
          // SAP renders a checked block as 'X', unchecked as blank. Be
          // lenient — accept any truthy text the user might see.
          const parseFlag = (s: string): boolean => {
            const v = (s ?? '').trim().toLowerCase()
            return (
              v === 'x' || v === 'true' || v === '1' || v === 'y' || v === 'yes'
            )
          }
          ctx.openBinBlocksDialog({
            warehouse: ctx.queryInputs.warehouse ?? '',
            storageType: stype,
            storageBin: bin,
            material: value('Material'),
            putawayBlocked: parseFlag(value('Putaway Block')),
            stockRemovalBlocked: parseFlag(value('Stock Removal Block')),
          })
        },
      },
      {
        id: 'copy-bin',
        label: 'Copy bin location',
        icon: Boxes,
        onClick: (_row, value) => {
          const bin = value('Storage Bin')
          if (!bin) {
            toast.error('No storage bin on this row')
            return
          }
          void navigator.clipboard.writeText(bin)
          toast.success('Copied to clipboard', { description: bin })
        },
      },
      // 2026-05-07 — Inventory Adjustment workflow. Calls ZMM60 via the
      // agent (capability `zmm60-price-lookup`) to get the unit price for
      // this row's material, then INSERTs a row into
      // `inventory_adjustment_staging`. The new "Inventory Adjustment"
      // entry in the Query Library renders the staging table with stat
      // cards + Excel export. Action gated on the capability so older
      // agents render the dropdown item disabled with a "needs update"
      // hint instead of failing the network call.
      {
        id: 'add-to-inv-adjust',
        label: '+ Add to Inv. Adjust',
        icon: Wallet,
        requiredCapability: 'zmm60-price-lookup',
        onClick: (_row, value, ctx) => {
          const material = value('Material')
          if (!material) {
            toast.error('No material on this row')
            return
          }
          // Parse Total Stock with the same SAP conventions
          // `parseSapNumber` handles (trailing-minus / comma thousands)
          // so a row with a -23 shortfall stages correctly under Gross
          // Losses. Falls back to 0 when SAP renders the cell blank.
          const stockText = value('Total Stock')
          const totalStock = parseSapNumber(stockText) ?? 0
          ctx.addToInventoryAdjustment({
            material,
            plant: value('Plant'),
            storageType: value('Storage Type'),
            storageLocation: value('Storage Location'),
            storageBin: value('Storage Bin'),
            totalStock,
          })
        },
      },
    ],
    stats: [
      {
        id: 'total-stock',
        label: 'Total Stock',
        sumColumn: 'Total Stock',
        icon: Boxes,
        accentClass: 'text-emerald-500',
      },
      {
        id: 'total-open-putaways',
        label: 'Total Open Putaways',
        sumColumn: 'Stock for Putaway',
        icon: PackagePlus,
        accentClass: 'text-amber-500',
      },
      {
        id: 'total-open-pick',
        label: 'Total Open Pick',
        sumColumn: 'Pick Quantity',
        icon: PackageMinus,
        accentClass: 'text-cyan-500',
      },
    ],
    inputs: [
      {
        name: 'material',
        label: 'Material Number',
        placeholder: '23085150',
        required: true,
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        placeholder: 'WH5',
        required: true,
        defaultValue: 'WH5',
      },
      {
        name: 'storage_type',
        label: 'Storage Type',
        placeholder: '*',
        defaultValue: '*',
        help: 'Use * for all storage types',
      },
    ],
  },
  // 2026-05-09 — TO History (LT24). Migrated FROM the standalone "TO
  // History" admin tab into the Query Library so the entire inventory
  // workflow lives under one roof. Replaces the flat-table view with
  // the new <TransferOrderHistoryView /> dual-mode visualization
  // (Journey + Timeline). Uses the existing `handler_lt24` already
  // wired into `/sap/query`; no agent change required. Capability
  // `lt24` was registered when the old tab shipped, so older fleet
  // agents continue to advertise it.
  //
  // Inputs accept ANY of {material, to_number} — the agent infers the
  // selection mode from the most-specific param present. The form
  // validates "at least one of" client-side via the
  // `lt24-history`-specific gate in `runQuery`.
  {
    id: 'lt24-history',
    name: 'TO History',
    description:
      'LT24 — Reconstruct the physical journey of a material through the warehouse. Each row is a TO movement (source bin → destination bin) annotated with timestamps, users, and confirmation status. Choose the Journey view for a per-TO trail or the Timeline view for a chronological feed.',
    transaction: 'LT24',
    handler: 'lt24',
    category: 'warehouse',
    icon: Route,
    requiredCapability: 'lt24',
    inputs: [
      {
        name: 'material',
        label: 'Material Number',
        placeholder: '23077931',
        help: 'Provide either Material OR TO Number (TO Number is faster).',
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        placeholder: 'WH5',
        required: true,
        defaultValue: 'WH5',
      },
      {
        name: 'to_number',
        label: 'TO Number (optional)',
        placeholder: '0001043619',
        help: 'When set, narrows to a single transfer order. Leave blank to query by material.',
      },
    ],
  },
  // 2026-05-10 — Inventory Completion (LX25). Cross-warehouse cycle-count
  // status across all 5 warehouses (WH5/WH8/JSM/JSF/PDC). Each warehouse
  // has its own SAP variant (TKAWH5/TKAWH8/TKAJSM/TKAJSF/TKAPDC) that
  // carries the storage-type / owner / date-range filters server-side,
  // so the user inputs ARE the click on Run Query — no per-call inputs.
  // The agent fans out across the 5 warehouses sequentially in a
  // single SAP session and returns aggregate + per-warehouse counts.
  // Result is rendered by the custom <InventoryCompletionView /> below
  // (NOT the standard flat-table ResultsCard). See
  // [[Implementations/Implement-LX25-Inventory-Completion]].
  {
    id: 'lx25-inventory-completion',
    name: 'Inventory Completion',
    description:
      'LX25 — Cycle count completion across all 5 warehouses (WH5, WH8, JSM, JSF, PDC). One click runs the warehouse-specific variant in each, then aggregates Bins Counted / Total Bins into a single completion %. Failed warehouses are surfaced inline so a missing variant doesn’t hide the rest.',
    transaction: 'LX25',
    handler: '',
    category: 'warehouse',
    icon: ClipboardCheck,
    requiredCapability: 'lx25-inventory-completion',
    inputs: [],
  },
  {
    id: 'll01-warehouse-activity-monitor',
    name: 'Warehouse Activity Monitor',
    description:
      'LL01 — Stuck/critical warehouse conditions across 5 plants and 7 categories. Heatmap of counts with traffic-light severity, trend history, and row-level drilldown.',
    transaction: 'LL01',
    handler: '',
    category: 'warehouse',
    icon: Activity,
    requiredCapability: 'll01-warehouse-activity-monitor',
    inputs: [],
  },
  {
    id: 'mb52-stock-on-hand',
    name: 'List Warehouse Stocks on Hand',
    description:
      'MB52 — List of materials with current stock quantities by plant and storage location.',
    transaction: 'MB52',
    handler: 'mb52',
    category: 'inventory',
    icon: Warehouse,
    inputs: [
      {
        name: 'material',
        label: 'Material Number (optional)',
        placeholder: '23087914',
      },
      {
        name: 'plant',
        label: 'Plant (optional)',
        placeholder: '',
      },
      {
        name: 'storage_location',
        label: 'Storage Location (optional)',
        placeholder: '',
      },
    ],
  },
  {
    id: 'mmbe-stock-overview',
    name: 'Stock Overview (Single Material)',
    description:
      'MMBE — Hierarchical stock overview for a single material across all plants, storage locations, and special stocks.',
    transaction: 'MMBE',
    handler: 'mmbe',
    category: 'inventory',
    icon: Package,
    inputs: [
      {
        name: 'material',
        label: 'Material Number',
        placeholder: '23087914',
        required: true,
      },
      {
        name: 'plant',
        label: 'Plant (optional)',
        placeholder: '',
      },
    ],
  },
  {
    id: 'mm02-material-master-bin',
    name: 'Material Master — Storage Bin',
    description:
      "MM02 — Change the storage bin field on a material's Warehouse Mgmt 2 view. Supports batch mode for bulk re-binning.",
    transaction: 'MM02',
    handler: '',
    category: 'master-data',
    icon: FileEdit,
    mutationEndpoint: '/sap/material-master-bin',
    requiredCapability: 'mm02-bin',
    dryRunEndpoint: '/sap/material-master-read-bin',
    dryRunCapability: 'mm03-read-bin',
    batchable: true,
    inputs: [
      {
        name: 'material',
        label: 'Material Number',
        placeholder: 'AS16446',
        required: true,
      },
      {
        name: 'plant',
        label: 'Plant',
        placeholder: 'PL08',
        required: true,
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        placeholder: 'WH8',
        required: true,
      },
      {
        name: 'storage_type',
        label: 'Storage Type',
        placeholder: '826',
        required: true,
      },
      {
        name: 'storage_bin',
        label: 'New Storage Bin (optional)',
        placeholder: 'SX-29-EN',
        required: false,
        help: 'Leave blank to clear the current bin assignment in the material master.',
      },
    ],
  },
  {
    id: 'mm02-material-master-storage-types',
    name: 'Material Master — Storage Types',
    description:
      "MM02 — Change the warehouse-level storage type defaults on a material's Warehouse Mgmt 1 view: stock removal (LTKZA) and stock placement (LTKZE). Supports batch mode for mass updates.",
    transaction: 'MM02',
    handler: '',
    category: 'master-data',
    icon: FileEdit,
    mutationEndpoint: '/sap/material-master-storage-types',
    requiredCapability: 'mm02-storage-types',
    dryRunEndpoint: '/sap/material-master-read-storage-types',
    dryRunCapability: 'mm03-read-storage-types',
    batchable: true,
    inputs: [
      {
        name: 'material',
        label: 'Material Number',
        placeholder: 'JS30181',
        required: true,
      },
      {
        name: 'plant',
        label: 'Plant',
        placeholder: '8303',
        required: true,
      },
      {
        name: 'warehouse',
        label: 'Warehouse',
        placeholder: 'PDC',
        required: true,
      },
      {
        name: 'org_storage_type',
        label: 'Storage Type (filter)',
        placeholder: '010',
        required: true,
        help: 'Used on the Org Levels popup to load the WM1 view. Use any storage type the material is extended in.',
      },
      {
        name: 'removal_storage_type',
        label: 'Storage Type for Stock Removal (LTKZA)',
        placeholder: '010',
        required: false,
        help: 'Default storage type used when picking from this material. Leave blank to clear.',
      },
      {
        name: 'placement_storage_type',
        label: 'Storage Type for Stock Placement (LTKZE)',
        placeholder: '010',
        required: false,
        help: 'Default storage type used when putting this material away. Leave blank to clear.',
      },
    ],
  },
  {
    id: 'ls01n-create-storage-bin',
    name: 'Create Storage Bin',
    description:
      'LS01N — Create a new storage bin in a warehouse + storage type. Section, total capacity, and allowed capacity use the standard defaults (001 / 9,999,999.000 / 9,999,999.000) and are not exposed as inputs. Supports batch mode for bulk bin creation.',
    transaction: 'LS01N',
    handler: '',
    category: 'master-data',
    icon: PackagePlus,
    mutationEndpoint: '/sap/create-storage-bin',
    requiredCapability: 'create-bin',
    batchable: true,
    inputs: [
      {
        name: 'warehouse',
        label: 'Warehouse',
        placeholder: 'PDC',
        required: true,
      },
      {
        name: 'storage_type',
        label: 'Storage Type',
        placeholder: '010',
        required: true,
      },
      {
        name: 'storage_bin',
        label: 'Storage Bin',
        placeholder: 'RK-71-A-01',
        required: true,
      },
    ],
  },
  // Phase D #12 — Self-Recording Mode (v1.5.0). Renders a custom UI
  // instead of the standard form/results layout — see `kind: 'tool'`
  // discriminator. Lives in a dedicated `tools` category at the bottom
  // of the Query Library so it doesn't intermix with the warehouse
  // operations.
  {
    id: 'recorder',
    name: 'SAP Recorder',
    description:
      'Record any SAP transaction in your live session, then auto-generate a draft Python handler that follows OmniFrame conventions (Pydantic model, retries, soft-warning ack, two-step / popup detection) plus a 1:1 VBS replay. Recordings are encrypted on this machine and never uploaded.',
    transaction: 'TOOL',
    handler: '',
    category: 'tools',
    icon: Video,
    kind: 'tool',
    toolId: 'recorder',
    requiredCapability: 'recording-start',
    inputs: [],
  },
  // Phase D #15 — Reversal / Rollback Engine. Sibling to the Recorder
  // — both are `kind: 'tool'` entries that render a custom panel
  // instead of the standard form/results layout. Selects from the
  // sap_audit_log + queues inverse mutations through `sap_agent_jobs`.
  {
    id: 'reversal-engine',
    name: 'Reversal Engine',
    description:
      'Browse the SAP audit log and reverse past mutations. Uses prev_state snapshots from each audit row to compute the inverse, then enqueues the reversal batch through the existing job queue. LT12 confirmations are irreversible — those rows are flagged and skipped.',
    transaction: 'AUDIT',
    handler: '',
    category: 'tools',
    icon: RotateCcw,
    kind: 'tool',
    toolId: 'reversal-engine',
    requiredCapability: 'reversal-engine',
    inputs: [],
  },
  // 2026-05-07 — Inventory Adjustment workflow. Sibling to Recorder /
  // Reversal-Engine — `kind: 'tool'` entry that renders a custom panel
  // (`InventoryAdjustmentView`) instead of the standard form/results
  // layout. Backed by migration 288 + the agent's `/sap/zmm60/lookup`
  // endpoint (capability `zmm60-price-lookup`). Rows are appended via
  // the new "+ Add to Inv. Adjust" LT10 row action; this entry
  // surfaces them with stat cards + Excel export.
  //
  // Categorised as `inventory` (the action targets are SAP inventory
  // valuation rows, and the emerald accent reads as a Warehouse-
  // adjacent capability) so it lives next to MB52 / MMBE in the
  // Library sidebar — the natural place a user looking for
  // "inventory tools" would scan.
  {
    id: 'inventory-adjustment',
    name: 'Inventory Adjustment',
    description:
      'Stage LT10 rows priced via ZMM60 to a working scratch pad. Net Value / Gross Gains / Gross Losses summarise across the table; Export to Excel for offline review. Add rows from any LT10 result via Actions → + Add to Inv. Adjust.',
    transaction: 'ADJUST',
    handler: '',
    category: 'inventory',
    icon: Wallet,
    kind: 'tool',
    toolId: 'inventory-adjustment',
    requiredCapability: 'zmm60-price-lookup',
    inputs: [],
  },
]

// ──────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────

export function InventoryManagementTab() {
  // 2026-05-07 — Inventory Adjustment workflow. `orgId` and the shared
  // TanStack Query client are needed by the new `+ Add to Inv. Adjust`
  // LT10 row action so it can INSERT into `inventory_adjustment_staging`
  // and invalidate the staging-list cache without having to thread the
  // org id through every action handler.
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  // Agent detection is now sourced from the shared `useAgentDetection`
  // hook so the outbound apps' SmartImportButton and this tab share a
  // single in-flight /health probe. We mirror it into the existing
  // local variable names to avoid touching the ~60 usage sites below.
  // The brief "checking" state lives only for the first ~1.5s while
  // the probe is in flight; after that we collapse to connected/missing.
  const agentDetection = useAgentDetection()
  const [hasResolvedAgent, setHasResolvedAgent] = useState(
    agentDetection.health !== null || agentDetection.available
  )
  useEffect(() => {
    if (!hasResolvedAgent) {
      // First mount: give the in-flight probe a moment to land before
      // flipping the AgentHealthCard from 'checking' → 'missing'.
      const t = setTimeout(() => setHasResolvedAgent(true), 1_500)
      return () => clearTimeout(t)
    }
    return undefined
  }, [hasResolvedAgent])
  useEffect(() => {
    if (agentDetection.health !== null || agentDetection.available) {
      setHasResolvedAgent(true)
    }
  }, [agentDetection.health, agentDetection.available])

  const agentHealth: AgentHealth | null = agentDetection.health
  // v1.7.2 — gate "connected" on BOTH `available` AND `authenticated`.
  // Pre-1.7.2 the tab read just `agentDetection.available`, so a
  // user with a stale JWT (process up but every authenticated RPC
  // 401-ing) saw the AgentHealthCard render green + every action
  // button enabled, then any actual click failed at the network
  // layer with no obvious recourse. We now surface a third state
  // 'unauthenticated' which the AgentHealthCard renders as yellow
  // "Agent online — session expired" so the user knows to click the
  // AgentSupabaseStatusButton's "Reconnect Account" pill (also
  // updated in v1.7.2). Other surfaces in this tab that read
  // `agentStatus === 'connected'` for action-button enable/disable
  // logic now correctly disable those actions until the JWT is
  // refreshed. See [[Debug/Fix-Audit-Closeout-v1.7.2]] for the audit
  // walkthrough.
  const agentStatus: AgentStatus = agentDetection.available
    ? agentDetection.authenticated
      ? 'connected'
      : 'unauthenticated'
    : hasResolvedAgent
      ? 'missing'
      : 'checking'
  const [sapSessions, setSapSessions] = useState<SapSessionsData | null>(null)
  const [selectedQueryId, setSelectedQueryId] = useState<string>(
    QUERY_LIBRARY[0].id
  )
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  // 2026-05-10 — LX25 Inventory Completion result. Lives in its own
  // state slot (NOT the shared `result` above) because the response
  // shape — `{ warehouses: [...], totals: {...}, meta: {...} }` — is
  // structurally different from the standard `QueryResult` (which
  // expects `{ columns, rows, total }`). Keeping it isolated means the
  // standard ResultsCard / pagination / sortBy plumbing stays untouched.
  // Cleared on query change in the same effect that clears `result`.
  const [completionResult, setCompletionResult] =
    useState<InventoryCompletionResult | null>(null)
  // Per-warehouse progress label for the loading state. Updated as
  // each warehouse finishes so the user sees "Fetching warehouse 2 of 5
  // (WH8)…" instead of a static spinner. Today's agent runs the loop
  // server-side so we can't get true mid-flight progress without a
  // streaming endpoint — we fall back to a single "Fetching all 5
  // warehouses…" message while the call is in flight. The state still
  // shapes the loading UI so a future SSE/WS upgrade just has to push
  // updates here.
  const [completionProgress, setCompletionProgress] = useState<{
    current: number
    total: number
    label: string
  } | null>(null)
  const [ll01Result, setLl01Result] = useState<LL01RunResult | null>(null)
  const [ll01Progress, setLl01Progress] = useState<LL01Progress | null>(null)
  // LL01 historical run viewing (2026-05-31). `ll01ViewedRunId` is the
  // snapshot_run_id the user picked from the date picker (null = live run);
  // `ll01ViewedRun` is its lazily-loaded full payload. When set, the
  // WarehouseActivityMonitorView renders this instead of the live result.
  const ll01History = useLL01History(orgId)
  const [ll01ViewedRunId, setLl01ViewedRunId] = useState<string | null>(null)
  const [ll01ViewedRun, setLl01ViewedRun] = useState<LL01RunResult | null>(null)
  const [ll01ViewedLoading, setLl01ViewedLoading] = useState(false)

  const selectLl01HistoryRun = useCallback(
    async (snapshotRunId: string | null) => {
      if (!snapshotRunId) {
        setLl01ViewedRunId(null)
        setLl01ViewedRun(null)
        return
      }
      setLl01ViewedRunId(snapshotRunId)
      setLl01ViewedLoading(true)
      try {
        const loaded = await ll01History.loadRun(snapshotRunId)
        setLl01ViewedRun(loaded)
      } finally {
        setLl01ViewedLoading(false)
      }
    },
    [ll01History]
  )
  // 2026-05-09 — TO History migration handoff. The SAP console's
  // "open Transfer Order N" link writes to
  // `omniframe.inventory_query_handoff.v1` then switches the tab. On
  // mount we consume-and-clear the key so a reload doesn't replay a
  // stale handoff. Guarded to a 30s freshness window so a tab the user
  // left open last week doesn't auto-select on next visit. See
  // [[Implementations/Implement-LT24-History-Trail]] for the full flow.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('omniframe.inventory_query_handoff.v1')
      if (!raw) return
      const handoff = JSON.parse(raw) as {
        queryId?: string
        inputs?: Record<string, string>
        ts?: number
      }
      localStorage.removeItem('omniframe.inventory_query_handoff.v1')
      if (!handoff.queryId || !handoff.ts || Date.now() - handoff.ts > 30_000) {
        return
      }
      const target = QUERY_LIBRARY.find((q) => q.id === handoff.queryId)
      if (!target) return
      setSelectedQueryId(target.id)
      if (handoff.inputs && typeof handoff.inputs === 'object') {
        setInputs((prev) => ({ ...prev, ...handoff.inputs }))
      }
    } catch {
      /* malformed handoff payload — ignore */
    }
  }, [])
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [transferDialogPrefill, setTransferDialogPrefill] =
    useState<TransferInventoryPrefill | null>(null)
  const [binBlocksDialogPrefill, setBinBlocksDialogPrefill] =
    useState<BinBlocksPrefill | null>(null)

  // ── SAP Console (persistent, last 200 messages) ──
  const {
    messages: consoleMessages,
    push: pushConsole,
    clear: clearConsole,
  } = useSapConsole(INVENTORY_CONSOLE_KEY, 200)
  // Phase 6 — agent filter for the live console stream. `null` ⇒
  // show every agent in the org. The dropdown lives on the card.
  const [consoleAgentFilter, setConsoleAgentFilter] = useState<string | null>(
    null
  )
  // Phase 6 — bridge `WsEvent::SapAgentConsoleLine` into this
  // tab's console buffer. Hook is idempotent at the WS-handler
  // level (the singleton dedupes registrations).
  useAgentConsoleStream(pushConsole, {
    agentFilter: consoleAgentFilter,
  })
  const [tableSearch, setTableSearch] = useState('')
  const [sortBy, setSortBy] = useState<{
    col: string | null
    dir: 'asc' | 'desc'
  }>({ col: null, dir: 'asc' })
  // 2026-05-07 enterprise redesign — Console moved to a collapsible
  // bottom drawer instead of a third workbench column. Library gained
  // a name/transaction filter input. Both states persisted to
  // localStorage so the user's preferred drawer state survives reload.
  const [consoleOpen, setConsoleOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('omniframe.inv-mgmt.console-open.v1') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(
        'omniframe.inv-mgmt.console-open.v1',
        consoleOpen ? '1' : '0'
      )
    } catch {
      /* noop */
    }
  }, [consoleOpen])
  const [librarySearch, setLibrarySearch] = useState('')
  // Pagination — keeps the DOM small even with thousands of result rows.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)

  // Batch mode (mutations only) — CSV input + sequential execution state.
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchCsv, setBatchCsv] = useState('')
  const [batchProgress, setBatchProgress] = useState<{
    total: number
    completed: number
    succeeded: number
    failed: number
    currentLabel: string
    cancelRequested: boolean
  } | null>(null)
  // Phase A1 — opt-in queue mode for batch runs (reload-tolerant).
  const [queueMode, setQueueMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(QUEUE_MODE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_MODE_KEY, queueMode ? '1' : '0')
    } catch {
      /* noop */
    }
  }, [queueMode])
  // 2026-05-09 — LT24 personal layout, persisted per browser. Lives
  // outside the shared `inputs` map (and thus outside INPUT_HISTORY_KEY)
  // because it's a user-level preference (one value per browser, reused
  // across every LT24 run) rather than per-query session data the user
  // would expect to wipe between runs. Auto-uppercased in the input
  // handler since SAP layout codes are uppercase. Spread into the LT24
  // dispatch payload below — `handler_lt24` treats empty as "no layout".
  const [lt24Layout, setLt24Layout] = useState<string>(() => {
    try {
      return localStorage.getItem(LT24_LAYOUT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(LT24_LAYOUT_KEY, lt24Layout)
    } catch {
      /* noop */
    }
  }, [lt24Layout])
  // 2026-05-09 — LT24 BDATU date range, persisted per browser. Same
  // rationale as `lt24Layout`: an LT24 user typically runs the same
  // date window across many materials / TOs while investigating an
  // incident, so re-typing the dates each switch is friction. Default
  // empty ⇒ "no date filter" (the agent's `handler_lt24` skips the
  // BDATU writes entirely when both are empty). Stored as ISO
  // `YYYY-MM-DD` (the native value of `<input type="date">`); the
  // agent's `_format_sap_date` helper converts ISO → SAP US
  // (`MM/DD/YYYY`) before the GUI write. We DO NOT auto-default to
  // today/yesterday — an explicit blank means the user truly wants
  // SAP's full date range (the same behaviour as before the field
  // was added).
  const [lt24DateFrom, setLt24DateFrom] = useState<string>(() => {
    try {
      return localStorage.getItem(LT24_DATE_FROM_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [lt24DateTo, setLt24DateTo] = useState<string>(() => {
    try {
      return localStorage.getItem(LT24_DATE_TO_KEY) ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(LT24_DATE_FROM_KEY, lt24DateFrom)
    } catch {
      /* noop */
    }
  }, [lt24DateFrom])
  useEffect(() => {
    try {
      localStorage.setItem(LT24_DATE_TO_KEY, lt24DateTo)
    } catch {
      /* noop */
    }
  }, [lt24DateTo])
  // Phase D #13 — optional pin: when set, queue-mode submissions include
  // assigned_agent_id so only the chosen agent can claim the job.
  const [pinnedAgentId, setPinnedAgentId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('sap.testing.pinned-agent-id') || null
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      if (pinnedAgentId) {
        localStorage.setItem('sap.testing.pinned-agent-id', pinnedAgentId)
      } else {
        localStorage.removeItem('sap.testing.pinned-agent-id')
      }
    } catch {
      /* noop */
    }
  }, [pinnedAgentId])
  // Phase 8 — consolidated dashboard hook. The query stays subscribed
  // to `SapAgentChanged` / `SapJobStatusChanged` / `RfPutawayChanged`
  // / `Notification` WS events for invalidation. The legacy
  // `useOnlineSapAgents()` snapshot is kept as a Phase 11 fallback so
  // the BatchModePanel "Pin to agent" picker still resolves during a
  // work-service outage / cold deploy.
  const sapDashboard = useSapTestingDashboard()
  const fallbackOnlineAgents = useOnlineSapAgents()
  const onlineAgents =
    sapDashboard.data?.online_agents.map((a) => ({
      id: a.id,
      hostname: a.hostname,
      citrix_session: a.citrix_session,
    })) ??
    // TODO(rust-work-service Phase 11): delete this fallback once the
    // dashboard hook has soaked. Single grep target.
    fallbackOnlineAgents
  const jobQueue = useJobQueue()
  // 2026-05-09 — Inventory Management fleet-routing toggle. The hook
  // owns the local-vs-fleet routing decision for THIS tab; every
  // in-scope action (LT10/MB52/MMBE queries, ZMM60 lookup, LT01
  // transfer, MM02 mutations, LS01N create-bin) funnels through
  // `executionMode.dispatch(endpoint, payload, opts)` so call sites
  // don't branch. SAP Recorder + Reversal Engine bypass this path
  // entirely — they keep `agentFetch` directly because their flows
  // require the LIVE local SAP GUI session.
  const executionMode = useExecutionMode()
  // Phase C #7 — confirm dialog for big destructive batches
  const [bigBatchConfirm, setBigBatchConfirm] = useState<{
    rows: number
    onConfirm: () => void
  } | null>(null)
  // Phase D #11 — Material-Master dry-run preview dialog. Shared by the
  // single-row Run flow and BatchModePanel; `mode` decides which path
  // confirmation routes through.
  const [dryRunDialog, setDryRunDialog] = useState<{
    rows: DryRunInputRow[]
    mode: 'single' | 'batch'
  } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedQuery =
    QUERY_LIBRARY.find((q) => q.id === selectedQueryId) ?? QUERY_LIBRARY[0]

  // 2026-05-09 follow-up — composite gating signal from
  // `useExecutionMode()`. Replaces every `agentStatus === 'connected'`
  // check that previously gated the Run button / Detail-card status
  // pill. Keyed on the active query's `requiredCapability` so the
  // pill / Run-button surfaces both "agent offline" AND "picked agent
  // doesn't support this query" cases through ONE signal.
  //
  // The `reason` copy ALWAYS names BOTH knobs the user can turn (e.g.
  // "switch to Fleet Agent mode" in a local-mode error, "switch to
  // Local Agent mode" in a fleet-mode error) so the user always has
  // an out — the previous "Start it from the One Click Ship tab" copy
  // was misleading in fleet mode (the user was on a Mac with no local
  // agent + a working fleet agent picked, yet the gate still surfaced
  // as if the LOCAL agent was the blocker).
  //
  // The top-of-tab banner uses a separate inline check
  // (`agentStatus === 'missing' && !executionMode.isFleet`) since it
  // applies regardless of the active query.
  const queryReady = executionMode.ready(selectedQuery.requiredCapability)

  // 2026-05-09 follow-up — suppress the `localhost:8765/health` poll
  // while the user is in fleet mode. Without this, the browser dev
  // console floods with hundreds of `ERR_CONNECTION_REFUSED` lines
  // per session when the user is on a Mac (no local agent) routing
  // through fleet — every 15s the `useAgentDetection` poller hits
  // `localhost:8765/health` and the browser logs the network failure
  // at the DevTools layer regardless of try/catch in our code (the
  // only way to silence the noise is to NOT make the fetch). The
  // `suppressLocalProbe(token)` registry is module-scoped, so opting
  // out applies to ALL `useAgentDetection()` consumers in the tab —
  // documented trade-off: while inventory is in fleet mode, an
  // Agent Triggers tab open simultaneously also sees `available=false`.
  // Acceptable because (a) the typical user has one SAP-related tab
  // open at a time, and (b) flipping back to local mode immediately
  // re-fires a probe so the local-agent state recovers in <2s.
  useEffect(() => {
    if (!executionMode.isFleet) return
    const token = Symbol('inventory-management-fleet-suppress')
    suppressLocalProbe(token)
    return () => {
      unsuppressLocalProbe(token)
    }
  }, [executionMode.isFleet])

  // ─── Agent detection ───
  // Backed by the shared `useAgentDetection` hook above. `checkAgent` now
  // forces an immediate probe (called after SAP session selection so the
  // user sees session_name update without waiting on the 5s tick).
  const checkAgent = useCallback(async () => {
    await refreshAgentDetection()
  }, [])

  const loadSapSessions = useCallback(async () => {
    try {
      const res = await agentFetch('/sap/sessions', {
        signal: AbortSignal.timeout(3000),
      })
      const data = (await res.json()) as SapSessionsData
      setSapSessions(data)
    } catch {
      setSapSessions(null)
    }
  }, [])

  const selectSapSession = useCallback(
    async (connIdx: number, sessIdx: number) => {
      try {
        await agentFetch('/sap/session', {
          method: 'POST',
          body: JSON.stringify({ conn_idx: connIdx, sess_idx: sessIdx }),
        })
        toast.success('SAP Session switched', {
          description: `conn=${connIdx} sess=${sessIdx}`,
        })
        await loadSapSessions()
        // Re-arm SAP connection state on the agent against the new session
        await agentFetch('/sap/connect', { method: 'POST' })
        await checkAgent()
      } catch (e) {
        toast.error('Session select failed', {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    },
    [loadSapSessions, checkAgent]
  )

  // The 3s polling loop that used to live here was retired in favour of
  // the shared `useAgentDetection` hook (5s cadence, module-scoped, one
  // poller per browser tab). `pollRef` is left in place to keep its
  // ref-shape stable for any other consumers that still reference it.
  useEffect(() => {
    void refreshAgentDetection()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  useEffect(() => {
    if (agentStatus === 'connected') loadSapSessions()
    else setSapSessions(null)
  }, [agentStatus, loadSapSessions])

  // ─── Load input history when query changes ───
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INPUT_HISTORY_KEY)
      const history: Record<string, Record<string, string>> = raw
        ? JSON.parse(raw)
        : {}
      const saved = history[selectedQuery.id] ?? {}
      // Merge with defaults
      const initial: Record<string, string> = {}
      for (const field of selectedQuery.inputs) {
        initial[field.name] = saved[field.name] ?? field.defaultValue ?? ''
      }
      setInputs(initial)
    } catch {
      const initial: Record<string, string> = {}
      for (const field of selectedQuery.inputs) {
        initial[field.name] = field.defaultValue ?? ''
      }
      setInputs(initial)
    }
    setResult(null)
    setCompletionResult(null)
    setCompletionProgress(null)
    setLl01Result(null)
    setLl01Progress(null)
    setTableSearch('')
    setSortBy({ col: null, dir: 'asc' })
    setBatchOpen(false)
    setBatchCsv('')
    setBatchProgress(null)
    setDryRunDialog(null)
    bigBatchConfirmAcknowledged.current = false
  }, [selectedQuery])

  const persistInputs = useCallback(
    (queryId: string, values: Record<string, string>) => {
      try {
        const raw = localStorage.getItem(INPUT_HISTORY_KEY)
        const history: Record<string, Record<string, string>> = raw
          ? JSON.parse(raw)
          : {}
        history[queryId] = values
        localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(history))
      } catch {
        /* ignore */
      }
    },
    []
  )

  // ─── Ensure SAP connection ───
  const ensureSapConnected = async (): Promise<boolean> => {
    if (agentHealth?.sap_connected) return true
    try {
      const r = await agentFetch('/sap/connect', { method: 'POST' })
      const data = await r.json()
      if (data.ok) {
        await checkAgent()
        return true
      }
      toast.error('SAP Connect Failed', { description: data.error })
      return false
    } catch (e) {
      toast.error('Agent Error', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
      return false
    }
  }

  // Recover a fleet LL01 run that the agent completed + persisted to
  // ll01_activity_runs even though its sap_agent_jobs row came back `failed`.
  // This happens on long runs (~5-6 min): the 90s claim lease lapses and the
  // server-side `claim_sap_agent_job` zombie-reaper (migration 291,
  // step='watchdog_max_attempts') flips the row to `failed` ~the same moment
  // the agent's `jobs_complete` lands — so the result never attaches to the
  // job, but the full payload IS already in ll01_activity_runs. We mint the
  // snapshot_run_id on the FE and pass it to the agent, so we can fetch the
  // exact persisted run here. Returns true when recovery succeeded.
  const recoverLl01FromHistory = async (
    snapshotRunId: string
  ): Promise<boolean> => {
    const recovered = await ll01History.loadRun(snapshotRunId)
    if (!recovered || !recovered.ok || recovered.categories.length === 0) {
      return false
    }
    setLl01Result(recovered)
    setLastRunAt(recovered.ran_at)
    setLl01ViewedRunId(null)
    setLl01ViewedRun(null)
    void ll01History.refreshIndex()
    const totalIssues = recovered.categories.reduce((s, c) => s + c.total, 0)
    toast.success('Warehouse Activity Monitor recovered', {
      description: `${recovered.plants.length} plants · ${totalIssues.toLocaleString()} records — recovered the saved run despite a queue timeout.`,
    })
    pushConsole({
      level: 'warning',
      source: 'LL01',
      text: 'Recovered the persisted run after the job queue marked it failed (lease-expiry race). The SAP work + data write completed.',
    })
    return true
  }

  // ─── Run query (data pull) ───
  const runQuery = async () => {
    // Minted per LL01 fleet run so we can recover the persisted run by id if
    // the job row is reaped while the data made it into ll01_activity_runs.
    let ll01SnapshotRunId: string | null = null
    // Validate required fields
    for (const field of selectedQuery.inputs) {
      if (field.required && !(inputs[field.name] ?? '').trim()) {
        toast.error('Missing required field', {
          description: `${field.label} is required.`,
        })
        return
      }
    }
    // Per-query "at least one of" validation. LT24 lets the user query
    // by EITHER material OR to_number — neither is `required: true`
    // because either alone is sufficient — so the standard required
    // gate above can't enforce the constraint. The agent will return
    // an error if both are blank, but we surface it client-side first
    // so the user gets immediate feedback without a 5min queue wait.
    if (selectedQuery.id === 'lt24-history') {
      const hasMaterial = (inputs.material ?? '').trim().length > 0
      const hasTo = (inputs.to_number ?? '').trim().length > 0
      if (!hasMaterial && !hasTo) {
        toast.error('Material or TO Number required', {
          description:
            'Provide either a Material Number or a TO Number — at least one is needed to scope the LT24 search.',
        })
        return
      }
    }
    // Local-mode prerequisite: the on-prem agent must be reachable +
    // authenticated. Fleet mode skips this gate entirely — the work
    // runs on the picked fleet agent's machine; the local agent's
    // status is irrelevant.
    if (!executionMode.isFleet && agentStatus !== 'connected') {
      toast.error('SAP Agent Not Detected', {
        description: 'Start the agent from the One Click Ship tab first.',
      })
      return
    }
    // Fleet-mode pre-checks (a picked agent online + advertising the
    // capability the active query needs). `blockedReason` returns the
    // exact toast description so the user knows which knob to turn.
    if (executionMode.isFleet) {
      const reason = executionMode.blockedReason(
        selectedQuery.requiredCapability
      )
      if (reason) {
        toast.error('Fleet routing blocked', { description: reason })
        return
      }
    }

    setIsRunning(true)
    setResult(null)
    setCompletionResult(null)
    setCompletionProgress(null)
    setLl01Result(null)
    setLl01Progress(null)
    persistInputs(selectedQuery.id, inputs)

    try {
      // Local-mode SAP attach is still relevant — the local fetch
      // hits localhost:8765 and we need the local agent's COM bridge
      // attached to a SAP session. Fleet mode skips this — the
      // remote agent owns its own SAP session attach state.
      if (!executionMode.isFleet) {
        const ready = await ensureSapConnected()
        if (!ready) {
          setIsRunning(false)
          return
        }
      }

      // 2026-05-10 — LX25 Inventory Completion fan-out. Custom dispatch
      // path: posts to `/sap/lx25/inventory-completion` (not the
      // shared `/sap/query` handler endpoint) and stores the result
      // in `completionResult` rather than `result` because the
      // response shape is structurally different (totals + per-
      // warehouse cards rather than columns + rows). The 5-warehouse
      // fan-out runs server-side in a single SAP session loop, so we
      // can't get true mid-flight progress updates — we surface a
      // best-effort "Fetching all 5 warehouses…" placeholder while
      // the call is in flight. See [[Implement-LX25-Inventory-Completion]].
      if (selectedQuery.id === 'lx25-inventory-completion') {
        setCompletionProgress({
          current: 0,
          total: LX25_WAREHOUSES.length,
          label: `Fetching all ${LX25_WAREHOUSES.length} warehouses…`,
        })
        const data = await executionMode.dispatch<InventoryCompletionResult>(
          '/sap/lx25/inventory-completion',
          {},
          {
            capability: selectedQuery.requiredCapability,
            // The 5-warehouse loop typically takes 30-60s end-to-end
            // (~6-12s per warehouse for variant load + execute +
            // export). The default timeout of 5 min in
            // `useExecutionMode.dispatch` covers worst-case, but we
            // bump it explicitly here so a slow Citrix VDA on the
            // fleet path doesn't hit the timeout cliff. Lease budget
            // for the agent's stuck-job-watchdog (default 120s) is
            // a known follow-up — see the implementation doc.
            timeoutMs: 8 * 60 * 1000,
          }
        )
        setCompletionResult(data)
        setLastRunAt(new Date().toISOString())
        setCompletionProgress(null)

        if (data.ok) {
          const totals = data.totals ?? {
            warehouses_succeeded: 0,
            warehouses_failed: 0,
            total_bins: 0,
            executed: 0,
            completion_pct: null,
          }
          const pct =
            typeof totals.completion_pct === 'number'
              ? `${totals.completion_pct.toFixed(1)}%`
              : '—'
          toast.success('Inventory Completion ready', {
            description: `${totals.warehouses_succeeded}/${LX25_WAREHOUSES.length} warehouses ok · ${pct} completion (${(totals.executed ?? 0).toLocaleString()} of ${(totals.total_bins ?? 0).toLocaleString()} bins)`,
          })
          pushConsole({
            level: 'success',
            source: selectedQuery.transaction,
            text: `${selectedQuery.name}: ${pct} across ${totals.warehouses_succeeded}/${LX25_WAREHOUSES.length} warehouses`,
            detail:
              totals.warehouses_failed > 0
                ? `${totals.warehouses_failed} warehouse(s) failed — see card detail`
                : undefined,
          })
        } else {
          toast.error('Inventory Completion failed', {
            description: data.error || 'Unknown error',
          })
          pushConsole({
            level: 'error',
            source: selectedQuery.transaction,
            text: `${selectedQuery.name} failed`,
            detail: data.error,
          })
        }
        setIsRunning(false)
        return
      }

      if (selectedQuery.id === 'll01-warehouse-activity-monitor') {
        if (!orgId) {
          toast.error('Organization required', {
            description: 'Sign in with an organization context to run LL01.',
          })
          setIsRunning(false)
          return
        }
        setLl01Progress({
          running: true,
          plant_index: 0,
          plant_total: LL01_PLANTS.length,
          category_index: 0,
          category_total: 7,
          label: `Fetching all ${LL01_PLANTS.length} plants…`,
          elapsed_sec: 0,
        })
        ll01SnapshotRunId = crypto.randomUUID()
        const data = await executionMode.dispatch<LL01RunResult>(
          '/sap/ll01/warehouse-activity',
          { organization_id: orgId, snapshot_run_id: ll01SnapshotRunId },
          {
            capability: selectedQuery.requiredCapability,
            timeoutMs: 15 * 60 * 1000,
          }
        )
        // Normalize at the dispatch boundary. The fleet path unwraps
        // `{ ok, error, step, ...JobRow.result }` (use-execution-mode.ts) —
        // a failed or result-less job (offline-agent reclaim, claim-lease
        // watchdog, non-LL01 error body) yields an object MISSING
        // `categories` / `plants` / `errors`. The local path has the same
        // gap when the agent returns a non-2xx error body. Either way the
        // Heatmap then white-screens on `result.categories.find(...)`.
        // Coerce to a well-formed LL01RunResult here so every tab receives
        // the typed shape. (See Debug/Fix-MapStatistics-Shape-Drift —
        // normalize at the boundary, not at every call site.)
        const raw = data as Partial<LL01RunResult> & {
          ok: boolean
          error?: string
          step?: string
        }
        const rawErrors = raw.errors ?? []
        // Carry the dispatch-level error string (which lives on `error`/`step`,
        // not in `errors[]`) into `errors[]` on a failed run so the Heatmap's
        // failure banner can explain WHY the grid is empty instead of showing
        // a misleading all-zeros table.
        const normalizedErrors =
          !raw.ok && rawErrors.length === 0 && raw.error
            ? [
                {
                  plant: '*',
                  category: '*',
                  step: raw.step ?? 'run',
                  detail: raw.error,
                },
              ]
            : rawErrors
        const ll01: LL01RunResult = {
          ok: raw.ok,
          payload_version: raw.payload_version,
          snapshot_run_id: raw.snapshot_run_id ?? '',
          ran_at: raw.ran_at ?? new Date().toISOString(),
          agent_id: raw.agent_id ?? '',
          duration_ms: raw.duration_ms ?? 0,
          plants: raw.plants ?? [],
          categories: raw.categories ?? [],
          errors: normalizedErrors,
        }
        setLl01Result(ll01)
        setLastRunAt(new Date().toISOString())
        setLl01Progress(null)
        // Snap back to the live run and refresh the date-picker index so the
        // run the agent just persisted (migration 333) shows up immediately.
        setLl01ViewedRunId(null)
        setLl01ViewedRun(null)
        void ll01History.refreshIndex()

        if (ll01.ok && ll01.categories.length > 0) {
          const totalIssues = ll01.categories.reduce(
            (sum, c) => sum + c.total,
            0
          )
          toast.success('Warehouse Activity Monitor ready', {
            description: `${ll01.plants.length} plants · ${totalIssues.toLocaleString()} total records`,
          })
          pushConsole({
            level: 'success',
            source: selectedQuery.transaction,
            text: `${selectedQuery.name}: ${totalIssues.toLocaleString()} records across ${ll01.plants.length} plants`,
          })
        } else {
          // The job row says failed — but on a long run the agent often DID
          // complete + persist to ll01_activity_runs (lease-expiry reaper
          // raced jobs_complete). Recover the real data by snapshot_run_id
          // before surfacing failure.
          const recovered = ll01SnapshotRunId
            ? await recoverLl01FromHistory(ll01SnapshotRunId)
            : false
          if (!recovered) {
            const detail =
              raw.error || ll01.errors[0]?.detail || 'Unknown error'
            toast.error('Warehouse Activity Monitor failed', {
              description: detail,
            })
            pushConsole({
              level: 'error',
              source: selectedQuery.transaction,
              text: `${selectedQuery.name} failed`,
              detail,
            })
          }
        }
        setIsRunning(false)
        return
      }

      // 2026-05-09 — LT24 personal layout (ctxtLISTV) is rendered
      // outside `selectedQuery.inputs` (it's a user-level preference,
      // not per-query session data — see `LT24_LAYOUT_KEY`). Spread
      // it into `params` here so `handler_lt24` receives it alongside
      // material / warehouse / to_number. Empty ⇒ handler skips the
      // layout step (the agent already trims and treats "" as no-op).
      //
      // 2026-05-09 (later) — also spread the optional BDATU date
      // range (`date_from` / `date_to`) the same way. Both are
      // persisted in their own localStorage keys (LT24_DATE_FROM_KEY
      // / LT24_DATE_TO_KEY) for the same per-browser-preference
      // reason as the layout. Sent as ISO `YYYY-MM-DD` (the native
      // value emitted by `<input type="date">`); the agent's
      // `_format_sap_date` converts ISO → SAP US (MM/DD/YYYY) before
      // writing to ctxtBDATU-LOW / ctxtBDATU-HIGH. Empty values
      // produce the same behaviour as before the fields were
      // added: the handler skips the BDATU writes entirely.
      const dispatchParams =
        selectedQuery.id === 'lt24-history'
          ? {
              ...inputs,
              layout: lt24Layout.trim(),
              date_from: lt24DateFrom.trim(),
              date_to: lt24DateTo.trim(),
            }
          : inputs
      const data = await executionMode.dispatch<QueryResult>(
        '/sap/query',
        {
          handler: selectedQuery.handler,
          params: dispatchParams,
        },
        {
          capability: selectedQuery.requiredCapability,
        }
      )

      setResult(data)
      setLastRunAt(new Date().toISOString())

      if (data.ok) {
        const rowCount = data.total ?? data.rows?.length ?? 0
        toast.success('Query complete', {
          description: `${rowCount} row(s) returned`,
        })
        pushConsole({
          level: 'success',
          source: selectedQuery.transaction,
          text: `${selectedQuery.name}: ${rowCount.toLocaleString()} row(s) returned`,
        })
      } else {
        toast.error('Query failed', {
          description: data.error || 'Unknown error',
        })
        pushConsole({
          level: 'error',
          source: selectedQuery.transaction,
          text: `${selectedQuery.name} failed`,
          detail: data.error,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      // 2026-05-10 — surface the network/agent error in the right
      // result slot so the LX25 Inventory Completion error renders in
      // the InventoryCompletionView placeholder rather than the
      // standard ResultsCard placeholder. Other queries still write
      // into the shared `result` state.
      let suppressErrorToast = false
      if (selectedQuery.id === 'lx25-inventory-completion') {
        setCompletionResult({ ok: false, error: msg })
      } else if (selectedQuery.id === 'll01-warehouse-activity-monitor') {
        // A thrown dispatch (e.g. submitAndWait 15-min timeout) can still mean
        // the agent finished + persisted the run — recover by snapshot_run_id
        // before showing the network error.
        const recovered = ll01SnapshotRunId
          ? await recoverLl01FromHistory(ll01SnapshotRunId)
          : false
        if (recovered) {
          suppressErrorToast = true
        } else {
          setLl01Result({
            ok: false,
            snapshot_run_id: '',
            ran_at: new Date().toISOString(),
            agent_id: '',
            duration_ms: 0,
            plants: [],
            categories: [],
            errors: [
              { plant: '*', category: '*', step: 'network', detail: msg },
            ],
          })
        }
      } else {
        setResult({ ok: false, error: msg })
      }
      if (!suppressErrorToast) {
        toast.error('Request failed', { description: msg })
        pushConsole({
          level: 'error',
          source: 'Agent',
          text: `Network / agent error during ${selectedQuery.name}`,
          detail: msg,
        })
      }
    } finally {
      setIsRunning(false)
      setCompletionProgress(null)
      setLl01Progress(null)
    }
  }

  // ─── Run mutation (single write action) ───
  const runMutation = async () => {
    if (!selectedQuery.mutationEndpoint) return
    for (const field of selectedQuery.inputs) {
      if (field.required && !(inputs[field.name] ?? '').trim()) {
        toast.error('Missing required field', {
          description: `${field.label} is required.`,
        })
        return
      }
    }
    // Local mode requires the local agent to be reachable +
    // authenticated. Fleet mode runs entirely on the remote agent;
    // local-agent status is irrelevant. Note Phase 5 Material Master
    // mutations ALWAYS route through rust-work-service regardless of
    // the toggle — they layer role-gate / lock / rate-limit / audit
    // server-side; the toggle just chooses WHICH agent claims the
    // resulting queue row.
    if (!executionMode.isFleet && agentStatus !== 'connected') {
      toast.error('SAP Agent Not Detected')
      return
    }
    if (executionMode.isFleet) {
      const reason = executionMode.blockedReason(
        selectedQuery.requiredCapability
      )
      if (reason) {
        toast.error('Fleet routing blocked', { description: reason })
        return
      }
    }

    setIsRunning(true)
    persistInputs(selectedQuery.id, inputs)

    // Phase 5 — Material Master mutations route through the
    // rust-work-service `/api/v1/sap-mutations/material-master`
    // endpoint. The route layers role-gate + concurrency lock +
    // per-org rate limit + pre-flight audit + sap_agent_jobs INSERT
    // ahead of the agent call. The agent claims the queued job the
    // same way it claims any queue-mode job; we observe terminal
    // status via the existing `WsEvent::SapJobStatusChanged` push.
    const usePhase5MaterialMasterPath = isPhase5MaterialMasterEndpoint(
      selectedQuery.mutationEndpoint
    )

    // Effective `assigned_agent_id` honours the fleet toggle when
    // active (so the picked fleet agent is the only valid claimant).
    // Otherwise we fall back to the legacy batch-mode "Pin to agent"
    // picker so existing behaviour is preserved when the toggle is
    // local-mode.
    const effectiveAgentId = executionMode.getAssignedAgentId() ?? pinnedAgentId

    try {
      if (usePhase5MaterialMasterPath) {
        const startedAt = Date.now()
        let job_id: string | null = null
        let audit_log_id: string | null = null
        try {
          const enq = await postMaterialMasterMutation(
            buildPhase5MaterialMasterBody(selectedQuery, inputs, {
              pinnedAgentId: effectiveAgentId,
              prevState: null,
            }),
            crypto.randomUUID()
          )
          job_id = enq.job_id
          audit_log_id = enq.audit_log_id
          pushConsole({
            level: 'info',
            source: selectedQuery.transaction,
            text: `Queued Material Master mutation via rust-work-service (job ${enq.job_id.slice(0, 8)}…, audit ${enq.audit_log_id.slice(0, 8)}…)`,
          })
        } catch (err) {
          if (err instanceof SapMutationError) {
            const detail =
              err.status === 429 && err.retryAfterSecs
                ? `${err.message} Retry in ${err.retryAfterSecs}s.`
                : err.message
            toast.error('Material Master mutation rejected', {
              description: detail,
            })
            pushConsole({
              level: 'error',
              source: selectedQuery.transaction,
              text: `${mutationOneLineSummary(selectedQuery, inputs)} — server rejected (${err.code ?? `HTTP ${err.status}`})`,
              detail,
            })
            void logSapAudit({
              transactionCode: selectedQuery.transaction,
              action: handlerNameForQuery(selectedQuery),
              payload: inputs,
              status:
                err.status === 409 || err.status === 429 ? 'warning' : 'error',
              sapMessage: detail,
              agentVersion: agentHealth?.version ?? null,
              durationMs: Date.now() - startedAt,
            })
            setIsRunning(false)
            return
          }
          throw err
        }

        const finalRow = await jobQueue.waitForJob(job_id)
        const data = {
          ok: finalRow.status === 'completed',
          error: finalRow.error || undefined,
          step: finalRow.step || undefined,
          ...((finalRow.result ?? {}) as Record<string, unknown>),
        } as {
          ok?: boolean
          error?: string
          message?: string
          step?: string
          warning?: boolean
          prev_state?: Record<string, unknown>
        } & Record<string, unknown>

        setLastRunAt(new Date().toISOString())

        if (data.ok) {
          toast.success(`${selectedQuery.name} succeeded`, {
            description:
              (data.message as string | undefined) ??
              'Audit row patched on terminal.',
          })
          pushConsole({
            level: 'success',
            source: selectedQuery.transaction,
            text:
              (data.message as string | undefined) ||
              mutationOneLineSummary(selectedQuery, inputs),
            detail: `audit_log_id=${audit_log_id}`,
          })
        } else {
          toast.error(`${selectedQuery.name} failed`, {
            description: data.error ?? 'Unknown error',
          })
          pushConsole({
            level: 'error',
            source: selectedQuery.transaction,
            text: `${mutationOneLineSummary(selectedQuery, inputs)} — failed${data.step ? ` at ${String(data.step).replace(/_/g, ' ')}` : ''}`,
            detail: data.error,
          })
        }

        // The Phase 5 server-side pre-flight audit row is the
        // authoritative record for this mutation; the existing
        // `logSapAudit(...)` insert is suppressed for the Material
        // Master path so we don't double-write. Other endpoints keep
        // the legacy audit log as before.
        setIsRunning(false)
        return
      }

      // Local mode still wants the SAP-attach pre-check; fleet mode
      // delegates that to the picked agent.
      if (!executionMode.isFleet) {
        const ready = await ensureSapConnected()
        if (!ready) {
          setIsRunning(false)
          return
        }
      }
      const startedAt = Date.now()
      const data = await executionMode.dispatch<
        {
          ok?: boolean
          error?: string
          message?: string
          step?: string
          prev_state?: Record<string, unknown>
        } & Record<string, unknown>
      >(selectedQuery.mutationEndpoint, inputs as Record<string, unknown>, {
        capability: selectedQuery.requiredCapability,
      })
      const durationMs = Date.now() - startedAt

      // Phase D #15 — If a dry-run preview ran first (#11) it stashes the
      // pre-mutation snapshot on the agent response under `prev_state` so
      // the reversal engine can later compute the inverse. We forward it
      // straight to the audit row. Until dry-run is wired in this is just
      // undefined and the column stays NULL — flagged "cannot reverse" by
      // the reversal engine.
      const dryRunPrevState =
        (data.prev_state as Record<string, unknown> | undefined) ?? null

      setLastRunAt(new Date().toISOString())

      if (data.ok) {
        toast.success(`${selectedQuery.name} succeeded`, {
          description: data.message ?? 'OK',
        })
        pushConsole({
          level: 'success',
          source: selectedQuery.transaction,
          text:
            (data.message as string | undefined) ||
            mutationOneLineSummary(selectedQuery, inputs),
        })
        void logSapAudit({
          transactionCode: selectedQuery.transaction,
          action: handlerNameForQuery(selectedQuery),
          payload: inputs,
          result: data,
          status: 'success',
          sapMessage: typeof data.message === 'string' ? data.message : null,
          agentVersion: agentHealth?.version ?? null,
          durationMs,
          prevState: dryRunPrevState,
          reversalStatus: 'original',
        })
      } else {
        toast.error(`${selectedQuery.name} failed`, {
          description: data.error ?? 'Unknown error',
        })
        pushConsole({
          level: 'error',
          source: selectedQuery.transaction,
          text: `${mutationOneLineSummary(selectedQuery, inputs)} — failed${data.step ? ` at ${String(data.step).replace(/_/g, ' ')}` : ''}`,
          detail: data.error,
        })
        void logSapAudit({
          transactionCode: selectedQuery.transaction,
          action: handlerNameForQuery(selectedQuery),
          payload: inputs,
          result: data,
          status: data.warning ? 'warning' : 'error',
          step: typeof data.step === 'string' ? data.step : null,
          sapMessage: typeof data.error === 'string' ? data.error : null,
          agentVersion: agentHealth?.version ?? null,
          durationMs,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast.error('Request failed', { description: msg })
      pushConsole({
        level: 'error',
        source: 'Agent',
        text: `Network / agent error during ${selectedQuery.name}`,
        detail: msg,
      })
      void logSapAudit({
        transactionCode: selectedQuery.transaction,
        action: handlerNameForQuery(selectedQuery),
        payload: inputs,
        status: 'error',
        sapMessage: msg,
        agentVersion: agentHealth?.version ?? null,
      })
    } finally {
      setIsRunning(false)
    }
  }

  // Cancel signal for batch run. Mutating ref so the in-flight loop can
  // observe it without a state-stale closure.
  const batchCancelRef = useRef(false)
  // One-shot acknowledgement that the destructive-batch confirm dialog
  // was accepted. Reset whenever the user switches queries below.
  const bigBatchConfirmAcknowledged = useRef(false)

  // ─── Phase D #11 — open the dry-run preview dialog ───
  // Capability gate: when the agent doesn't report the dry-run cap (i.e.
  // it's an older agent that pre-dates Worker-B), we silently skip the
  // preview path and the caller falls back to the existing direct-commit
  // flow.
  // 2026-05-09 follow-up — Preview button availability needs to reach
  // the EFFECTIVE agent (the one that will actually run the dry-run
  // RPC), not just the local agent. `executionMode.ready(cap)` resolves
  // to local OR fleet capabilities depending on the toggle, so a fleet
  // user whose picked Citrix agent has `mm03-read-bin` sees the Preview
  // affordance even when their local agent is missing/lacks the cap.
  const dryRunCapAvailable = Boolean(
    selectedQuery.dryRunEndpoint &&
    executionMode.ready(selectedQuery.dryRunCapability).ok
  )

  const openSingleDryRun = () => {
    if (!selectedQuery.mutationEndpoint || !selectedQuery.dryRunEndpoint) return
    for (const field of selectedQuery.inputs) {
      if (field.required && !(inputs[field.name] ?? '').trim()) {
        toast.error('Missing required field', {
          description: `${field.label} is required.`,
        })
        return
      }
    }
    if (agentStatus !== 'connected') {
      toast.error('SAP Agent Not Detected')
      return
    }
    setDryRunDialog({
      rows: [{ values: { ...inputs } }],
      mode: 'single',
    })
  }

  const openBatchDryRun = () => {
    if (!selectedQuery.mutationEndpoint || !selectedQuery.dryRunEndpoint) return
    if (agentStatus !== 'connected') {
      toast.error('SAP Agent Not Detected')
      return
    }
    const rows = parseBatchCsv(batchCsv, selectedQuery.inputs, inputs)
    if (rows.length === 0) {
      toast.error('Batch is empty', {
        description: 'Paste at least one row in the textarea.',
      })
      return
    }
    const firstInvalid = rows.findIndex((r) => r.missing.length > 0)
    if (firstInvalid >= 0) {
      toast.error(`Row ${firstInvalid + 1} is missing required fields`, {
        description: rows[firstInvalid].missing.join(', '),
      })
      return
    }
    setDryRunDialog({
      rows: rows.map((r) => ({ values: r.values })),
      mode: 'batch',
    })
  }

  /** Confirmation handler invoked by the dry-run dialog. The dialog
   *  hands back the (possibly filtered) row list; we route it to the
   *  existing single/batch commit path. */
  const handleDryRunConfirm = (confirmedRows: DryRunInputRow[]) => {
    const dialog = dryRunDialog
    if (!dialog) return
    setDryRunDialog(null)
    if (dialog.mode === 'single') {
      // For the single-row path the user can only have one row in the
      // dialog. Skip-no-op makes that "0 rows" case — handle gracefully.
      if (confirmedRows.length === 0) return
      void runMutation()
      return
    }
    // Batch path — note how many no-ops we trimmed, then re-enter the
    // existing runner with the filtered set. parseBatchCsv re-attaches
    // the missing[] flag so we keep the same shape `runBatch` expects.
    const skipped = dialog.rows.length - confirmedRows.length
    if (skipped > 0) {
      pushConsole({
        level: 'info',
        source: selectedQuery.transaction,
        text: `[dry-run] Skipped ${skipped} no-op row${skipped !== 1 ? 's' : ''}`,
      })
    }
    const overrideRows = confirmedRows.map((r) => ({
      values: r.values,
      missing: selectedQuery.inputs
        .filter((f) => f.required && !(r.values[f.name] ?? '').trim())
        .map((f) => f.label),
    }))
    void runBatch(overrideRows)
  }

  // ─── Run mutation in batch mode ───
  // `overrideRows` (Phase D #11) lets the dry-run dialog confirm a
  // filtered subset of rows (e.g. with no-ops skipped) without having
  // to round-trip through `batchCsv` re-serialisation.
  const runBatch = async (
    overrideRows?: Array<{ values: Record<string, string>; missing: string[] }>
  ) => {
    if (!selectedQuery.mutationEndpoint) return
    // Local mode requires a reachable + authenticated local agent.
    // Fleet mode skips the gate — the work runs cross-machine on the
    // picked fleet agent. Phase 5 Material Master endpoints ALWAYS
    // route through rust-work-service so the toggle just chooses
    // which agent claims the queue row.
    if (!executionMode.isFleet && agentStatus !== 'connected') {
      toast.error('SAP Agent Not Detected')
      return
    }
    if (executionMode.isFleet) {
      const reason = executionMode.blockedReason(
        selectedQuery.requiredCapability
      )
      if (reason) {
        toast.error('Fleet routing blocked', { description: reason })
        return
      }
    }

    const rows =
      overrideRows ?? parseBatchCsv(batchCsv, selectedQuery.inputs, inputs)
    if (rows.length === 0) {
      toast.error('Batch is empty', {
        description: 'Paste at least one row in the textarea.',
      })
      return
    }
    const firstInvalid = rows.findIndex((r) => r.missing.length > 0)
    if (firstInvalid >= 0) {
      toast.error(`Row ${firstInvalid + 1} is missing required fields`, {
        description: rows[firstInvalid].missing.join(', '),
      })
      return
    }

    // Phase C #7 — confirm large destructive batches before kicking off.
    if (rows.length > 100 && !bigBatchConfirmAcknowledged.current) {
      setBigBatchConfirm({
        rows: rows.length,
        onConfirm: () => {
          bigBatchConfirmAcknowledged.current = true
          setBigBatchConfirm(null)
          // Re-enter the batch runner now that confirmation is granted.
          // Carry the override rows through so we don't reparse the CSV.
          void runBatch(overrideRows)
        },
      })
      return
    }

    // Phase C #4 — persist the just-submitted CSV so users can replay it.
    try {
      localStorage.setItem(
        `${LAST_BATCH_KEY_PREFIX}${selectedQuery.id}`,
        batchCsv
      )
    } catch {
      /* localStorage may be full; ignore */
    }

    batchCancelRef.current = false
    setIsRunning(true)
    setBatchProgress({
      total: rows.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentLabel: '',
      cancelRequested: false,
    })

    pushConsole({
      level: 'info',
      source: selectedQuery.transaction,
      text: `Batch started: ${rows.length} ${selectedQuery.name.toLowerCase()} update(s) ${
        executionMode.isFleet
          ? `via fleet agent ${executionMode.fleetAgent?.hostname || executionMode.fleetAgentId || '(picked)'}`
          : queueMode
            ? 'via queue'
            : 'in-browser'
      }`,
    })

    // Local mode pre-attaches SAP. Fleet mode delegates SAP attach to
    // the picked fleet agent (which manages its own session pin).
    if (!executionMode.isFleet) {
      const ready = await ensureSapConnected()
      if (!ready) {
        setIsRunning(false)
        setBatchProgress(null)
        return
      }
    }

    // Effective `assigned_agent_id` for queue-mode batch rows. Fleet
    // toggle wins over the legacy "Pin to agent" picker so the user's
    // explicit choice on the toggle is always honoured.
    const effectiveAgentId = executionMode.getAssignedAgentId() ?? pinnedAgentId

    let succeeded = 0
    let failed = 0
    for (let i = 0; i < rows.length; i++) {
      if (batchCancelRef.current) {
        pushConsole({
          level: 'warning',
          source: selectedQuery.transaction,
          text: `Batch canceled at ${i}/${rows.length}`,
        })
        break
      }
      const row = rows[i]
      const label =
        row.values.material || row.values.storage_bin || `row ${i + 1}`
      setBatchProgress({
        total: rows.length,
        completed: i,
        succeeded,
        failed,
        currentLabel: label,
        cancelRequested: false,
      })

      const startedAt = Date.now()
      let data: {
        ok?: boolean
        error?: string
        message?: string
        step?: string
        warning?: boolean
        prev_state?: Record<string, unknown>
      } = {}
      let networkError: string | null = null
      let phase5AuditLogId: string | null = null
      try {
        if (isPhase5MaterialMasterEndpoint(selectedQuery.mutationEndpoint)) {
          // Phase 5 — Material Master batch rows route through the
          // rust-work-service `/api/v1/sap-mutations/material-master`
          // endpoint regardless of `queueMode`. The server-side
          // pre-flight (role gate / lock / rate limit / audit) ALWAYS
          // applies on this surface — there's no in-browser bypass.
          // The fleet toggle just decides which agent claims the
          // resulting queue row via `effectiveAgentId`.
          const enq = await postMaterialMasterMutation(
            buildPhase5MaterialMasterBody(selectedQuery, row.values, {
              pinnedAgentId: effectiveAgentId,
              prevState: null,
            }),
            crypto.randomUUID()
          )
          phase5AuditLogId = enq.audit_log_id
          const finalRow = await jobQueue.waitForJob(enq.job_id)
          data = {
            ok: finalRow.status === 'completed',
            error: finalRow.error || undefined,
            step: finalRow.step || undefined,
            ...((finalRow.result ?? {}) as Record<string, unknown>),
          }
        } else if (queueMode || executionMode.isFleet) {
          // Phase A1 — submit via queue and wait for the row to terminate.
          // Fleet mode ALSO routes through the queue (the toggle's
          // entire purpose), so we fold both gates into one branch.
          // The agent that claims is governed by `assigned_agent_id`:
          //   - fleet mode: the picked fleet agent (executionMode wins)
          //   - queue mode: the legacy "Pin to agent" picker
          //   - both: fleet wins (single source of truth)
          const finalRow = await jobQueue.submitAndWait({
            endpoint: selectedQuery.mutationEndpoint!,
            payload: row.values,
            priority: 100,
            assignedAgentId: effectiveAgentId,
          })
          data = {
            ok: finalRow.status === 'completed',
            error: finalRow.error || undefined,
            step: finalRow.step || undefined,
            ...((finalRow.result ?? {}) as Record<string, unknown>),
          }
        } else {
          // Local + non-queue + non-fleet path — direct-fire to the
          // on-prem agent's localhost endpoint. Same shape as before
          // this hook landed; preserved for the user who wants the
          // sub-second latency of the in-process COM bridge.
          data = await executionMode.dispatch(
            selectedQuery.mutationEndpoint,
            row.values as Record<string, unknown>
          )
        }
      } catch (e) {
        if (e instanceof SapMutationError) {
          networkError =
            e.status === 429 && e.retryAfterSecs
              ? `${e.message} Retry in ${e.retryAfterSecs}s.`
              : e.message
        } else {
          networkError = e instanceof Error ? e.message : 'Unknown error'
        }
      }
      const durationMs = Date.now() - startedAt

      // Phase 5 — when the row went through the rust-work-service
      // pre-flight, the server already wrote the authoritative audit
      // row (`status='pending'` → patched to terminal by the
      // sap_jobs_listener PgListener). Suppress the legacy FE-side
      // `logSapAudit` insert for those rows so we don't double-write
      // the audit log. Other endpoints keep the legacy audit log.
      const skipFeAudit = phase5AuditLogId !== null

      if (networkError) {
        failed++
        pushConsole({
          level: 'error',
          source: 'Agent',
          text: `[${i + 1}/${rows.length}] ${label} — request failed`,
          detail: networkError,
        })
        if (!skipFeAudit) {
          void logSapAudit({
            transactionCode: selectedQuery.transaction,
            action: handlerNameForQuery(selectedQuery),
            payload: row.values,
            status: 'error',
            sapMessage: networkError,
            agentVersion: agentHealth?.version ?? null,
            durationMs,
          })
        }
      } else if (data.ok) {
        succeeded++
        pushConsole({
          level: 'success',
          source: selectedQuery.transaction,
          text: `[${i + 1}/${rows.length}] ${mutationOneLineSummary(selectedQuery, row.values)}`,
          detail: data.message,
        })
        // Phase D #15 — forward the dry-run pre-mutation snapshot to the
        // audit row when the agent / job-queue worker returned one.
        // See runMutation above for the same wiring; both code paths
        // need it because either may run an audit row for a given action.
        const dryRunPrevState =
          (data.prev_state as Record<string, unknown> | undefined) ?? null
        if (!skipFeAudit) {
          void logSapAudit({
            transactionCode: selectedQuery.transaction,
            action: handlerNameForQuery(selectedQuery),
            payload: row.values,
            result: data,
            status: 'success',
            sapMessage: typeof data.message === 'string' ? data.message : null,
            agentVersion: agentHealth?.version ?? null,
            durationMs,
            prevState: dryRunPrevState,
            reversalStatus: 'original',
          })
        }
      } else {
        failed++
        pushConsole({
          level: 'error',
          source: selectedQuery.transaction,
          text: `[${i + 1}/${rows.length}] ${label} — failed${data.step ? ` at ${String(data.step).replace(/_/g, ' ')}` : ''}`,
          detail: data.error,
        })
        if (!skipFeAudit) {
          void logSapAudit({
            transactionCode: selectedQuery.transaction,
            action: handlerNameForQuery(selectedQuery),
            payload: row.values,
            result: data,
            status: data.warning ? 'warning' : 'error',
            step: typeof data.step === 'string' ? data.step : null,
            sapMessage: typeof data.error === 'string' ? data.error : null,
            agentVersion: agentHealth?.version ?? null,
            durationMs,
          })
        }
      }

      setBatchProgress({
        total: rows.length,
        completed: i + 1,
        succeeded,
        failed,
        currentLabel: label,
        cancelRequested: batchCancelRef.current,
      })
    }

    pushConsole({
      level: failed === 0 ? 'success' : 'warning',
      source: selectedQuery.transaction,
      text: `Batch finished: ${succeeded} succeeded, ${failed} failed of ${rows.length}`,
    })
    toast[failed === 0 ? 'success' : 'warning'](
      `Batch finished: ${succeeded}/${rows.length} succeeded`,
      { description: failed > 0 ? `${failed} row(s) failed — see console` : '' }
    )
    setIsRunning(false)
    // Keep the progress card on screen so the user can see the final
    // summary; they can dismiss by re-running or switching queries.
  }

  const cancelBatch = () => {
    batchCancelRef.current = true
    setBatchProgress((p) => (p ? { ...p, cancelRequested: true } : p))
  }

  // ─── Resolve column mapping (must come before row filter so the
  // filter can look up cells by friendly title) ───
  const visibleColumns = useMemo<
    Array<{
      id: string
      title: string
      format?: 'number' | 'date' | 'plain'
      className?: string
    }>
  >(() => {
    if (!result?.columns) return []
    if (selectedQuery.columns && selectedQuery.columns.length > 0) {
      const grouped = new Map<string, QueryColumn[]>()
      for (const raw of result.columns) {
        const key = raw.title.trim().toLowerCase()
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(raw)
      }
      const resolved: Array<{
        id: string
        title: string
        format?: 'number' | 'date' | 'plain'
        className?: string
      }> = []
      for (const spec of selectedQuery.columns) {
        const candidates = grouped.get(spec.match.trim().toLowerCase()) ?? []
        const idx = spec.matchIndex ?? 0
        const raw = candidates[idx]
        if (!raw) continue
        resolved.push({
          id: raw.id,
          title: spec.title,
          format: spec.format,
          className: spec.className,
        })
      }
      return resolved
    }
    const hidden = new Set(selectedQuery.hiddenColumns ?? [])
    return result.columns
      .filter((c) => !hidden.has(c.id))
      .map((c) => ({ id: c.id, title: c.title }))
  }, [result, selectedQuery])

  // Lookup helper: fetch a cell by friendly column title. Used by row
  // filters and row actions so they don't depend on positional agent
  // column ids (`c0_0`, `c1_3`) which can shift between SAP layouts.
  const titleToColId = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of visibleColumns) m.set(c.title.toLowerCase(), c.id)
    return m
  }, [visibleColumns])

  // ─── Filter (rowFilter + search) + sort rows ───
  const displayedRows = useMemo(() => {
    if (!result?.rows) return []
    let rows = result.rows
    // Per-query row filter (drops SAP list-output metadata lines).
    if (selectedQuery.rowFilter) {
      const filterFn = selectedQuery.rowFilter
      rows = rows.filter((row) => {
        const value = (specTitle: string): string => {
          const id = titleToColId.get(specTitle.toLowerCase())
          if (!id) return ''
          return String(row[id] ?? '').trim()
        }
        return filterFn(row, value)
      })
    }
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase()
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(q))
      )
    }
    if (sortBy.col) {
      const col = sortBy.col
      rows = [...rows].sort((a, b) => {
        const va = a[col] ?? ''
        const vb = b[col] ?? ''
        // parseSapNumber handles SAP's trailing-minus convention ("2-" = -2)
        const numA = parseSapNumber(va)
        const numB = parseSapNumber(vb)
        const isNumeric = numA !== null && numB !== null
        const cmp = isNumeric
          ? numA - numB
          : String(va).localeCompare(String(vb), undefined, {
              numeric: true,
            })
        return sortBy.dir === 'asc' ? cmp : -cmp
      })
    }
    return rows
  }, [result, tableSearch, sortBy, selectedQuery, titleToColId])

  // Sum-stats computed across the FULL filtered set (not just current page).
  // Uses parseSapNumber so SAP's trailing-minus convention ("2-" = -2)
  // contributes correctly instead of being silently skipped.
  const computedStats = useMemo(() => {
    if (!selectedQuery.stats || !displayedRows.length) return []
    return selectedQuery.stats.map((stat) => {
      const colId = titleToColId.get(stat.sumColumn.toLowerCase())
      let total = 0
      let parsedAny = false
      if (colId) {
        for (const row of displayedRows) {
          const n = parseSapNumber(row[colId])
          if (n !== null) {
            total += n
            parsedAny = true
          }
        }
      }
      return {
        spec: stat,
        value: parsedAny ? total : null,
        formatted: parsedAny
          ? stat.format
            ? stat.format(total)
            : total.toLocaleString(undefined, { maximumFractionDigits: 3 })
          : '—',
      }
    })
  }, [selectedQuery, displayedRows, titleToColId])

  // ─── Pagination (so thousands of rows don't choke the DOM) ───
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * pageSize
  const pageEnd = Math.min(pageStart + pageSize, displayedRows.length)
  const pagedRows = useMemo(
    () => displayedRows.slice(pageStart, pageEnd),
    [displayedRows, pageStart, pageEnd]
  )

  // Reset to first page whenever the source data, filter, or sort changes
  // so users don't end up on an empty page after re-querying.
  useEffect(() => {
    setPage(0)
  }, [result, tableSearch, sortBy.col, sortBy.dir, pageSize])

  // ─── CSV export (exports the FULL filtered set, not just current page) ───
  const exportCsv = () => {
    if (!result?.columns || !result?.rows) return
    const esc = (v: string) => {
      if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
      return v
    }
    // Use the resolved (friendly) columns when configured; fall back to raw.
    const cols =
      visibleColumns.length > 0
        ? visibleColumns
        : result.columns.map((c) => ({ id: c.id, title: c.title }))
    const header = cols.map((c) => esc(c.title)).join(',')
    const lines = displayedRows.map((row) =>
      cols.map((c) => esc(String(row[c.id] ?? ''))).join(',')
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedQuery.id}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported', {
      description: `${displayedRows.length} row(s) to CSV`,
    })
  }

  // 2026-05-09 follow-up — `canRun` now reads the unified readiness
  // signal so fleet-mode users on a Mac with no local agent can still
  // click Run Query when their picked fleet agent is online + capable.
  // Previously this gated on `agentStatus === 'connected'` which was
  // local-only and produced the always-disabled-Run-button bug.
  const canRun = queryReady.ok && !isRunning

  // Phase C #5 — outdated agent banner.
  const agentNeedsUpdate = isAgentOutdated(agentHealth)

  // 2026-05-07 — Inventory Adjustment workflow handler. Triggered by the
  // new "+ Add to Inv. Adjust" LT10 row action via `actionContext`. Calls
  // POST /sap/zmm60/lookup on the local agent, then INSERTs one row into
  // `inventory_adjustment_staging` (migration 288) and invalidates the
  // staging-list cache so the InventoryAdjustmentView re-renders.
  // Surfaces every outcome via toast — the parent doesn't track its own
  // state for in-flight lookups (volume is low, the lookup is slow but
  // not concurrent).
  const handleAddToInventoryAdjustment = useCallback(
    (input: AddToInventoryAdjustmentInput) => {
      if (!orgId) {
        toast.error('Not signed in', {
          description: 'Cannot stage an adjustment row without an org.',
        })
        return
      }
      // Local-mode prerequisites: live local agent + the ZMM60
      // capability advertised on it. Fleet mode delegates the same
      // checks to the picked fleet agent via `executionMode`.
      if (!executionMode.isFleet) {
        if (agentStatus !== 'connected') {
          toast.error('Agent not connected', {
            description: 'Start the SAP agent and reconnect, then try again.',
          })
          return
        }
        if (!hasCapability(agentHealth, 'zmm60-price-lookup')) {
          toast.error('Agent too old', {
            description: `Update to v${LATEST_AGENT_VERSION}+ — capability 'zmm60-price-lookup' is missing.`,
          })
          return
        }
      } else {
        const reason = executionMode.blockedReason('zmm60-price-lookup')
        if (reason) {
          toast.error('Fleet routing blocked', { description: reason })
          return
        }
      }

      const tid = toast.loading(
        `Looking up ${input.material} price via ZMM60…`,
        {
          description: input.plant
            ? `Plant ${input.plant} · stock ${input.totalStock}`
            : `Stock ${input.totalStock}`,
        }
      )

      ;(async () => {
        try {
          let data: {
            ok?: boolean
            material?: string
            unit_value?: number
            currency?: string | null
            raw?: Record<string, unknown> | null
            error?: string
            step?: string
          } = {}
          try {
            data = await executionMode.dispatch<{
              ok?: boolean
              material?: string
              unit_value?: number
              currency?: string | null
              raw?: Record<string, unknown> | null
              error?: string
              step?: string
            }>(
              '/sap/zmm60/lookup',
              {
                material: input.material,
                plant: input.plant || undefined,
              },
              { capability: 'zmm60-price-lookup' }
            )
          } catch (dispatchErr) {
            toast.error('ZMM60 lookup failed', {
              id: tid,
              description:
                dispatchErr instanceof Error
                  ? dispatchErr.message
                  : 'Unknown error',
            })
            return
          }
          if (!data.ok) {
            toast.error('ZMM60 lookup failed', {
              id: tid,
              description: data.error || 'Unknown error',
            })
            return
          }
          if (typeof data.unit_value !== 'number') {
            toast.error('ZMM60 returned no price', {
              id: tid,
              description: `Material ${input.material} may not be valuated for plant ${input.plant || '*'}.`,
            })
            return
          }

          // Build the INSERT payload. `created_by` resolves through
          // `supabase.auth.getUser()` so the DB sees the authenticated
          // user id (matches the RLS check on user_profiles.id).
          const {
            data: { user },
          } = await supabase.auth.getUser()
          const payload: InventoryAdjustmentStagingInsert = {
            organization_id: orgId,
            created_by: user?.id ?? null,
            storage_type: input.storageType || null,
            plant: input.plant || null,
            storage_location: input.storageLocation || null,
            storage_bin: input.storageBin || null,
            material: input.material,
            total_stock: input.totalStock,
            unit_value: data.unit_value,
            currency: data.currency ?? null,
            zmm60_raw: (data.raw ?? null) as Record<string, unknown> | null,
          }

          await appendInventoryAdjustmentRow(payload, () => {
            void queryClient.invalidateQueries({
              queryKey: inventoryAdjustmentStagingQueryKey(orgId),
            })
          })

          toast.success('Added to Inventory Adjustment', {
            id: tid,
            description:
              `${input.material} @ ${data.unit_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${data.currency ?? ''}`.trim(),
          })
        } catch (e) {
          // Defensive — `executionMode.dispatch` already routed
          // routing-class errors through the catch above; this only
          // catches Supabase INSERT failures further down (auth.getUser,
          // appendInventoryAdjustmentRow). Either way the toast id is
          // patched so the loading spinner doesn't get orphaned.
          toast.error('Add to Inv. Adjust failed', {
            id: tid,
            description: e instanceof Error ? e.message : 'Unknown error',
          })
        }
      })()
    },
    [agentHealth, agentStatus, executionMode, orgId, queryClient]
  )

  return (
    <div className='space-y-6'>
      {/* Minimal status strip — replaces the previous full "SAP Agent
          Not Detected" amber card. Only renders when the agent is
          truly missing AND the active mode actually depends on it
          (i.e. fleet mode SUPPRESSES this banner, since the local
          agent is irrelevant when the user has explicitly opted
          into routing through a fleet agent — the previous behaviour
          showed the banner even when fleet routing was working
          fine, which is the bug this section fixes). */}
      {agentStatus === 'missing' && !executionMode.isFleet && (
        <AgentNotDetectedBanner onRetry={checkAgent} />
      )}

      {/* Auto-update banner (Phase C #5). Local-only — about the
          LOCAL agent's installed version. In fleet mode the user's
          local agent's version is irrelevant; the picked fleet agent
          has its own version reported in the toggle dropdown. */}
      {agentStatus === 'connected' &&
        agentNeedsUpdate &&
        !executionMode.isFleet && (
          <Card className='border-amber-500/60 bg-amber-500/5'>
            <CardContent className='flex flex-wrap items-center gap-3 py-3'>
              <ShieldAlert className='h-5 w-5 shrink-0 text-amber-600' />
              <div className='flex-1 text-sm'>
                <span className='font-semibold'>
                  Update your agent — v{LATEST_AGENT_VERSION} available.
                </span>{' '}
                <span className='text-muted-foreground'>
                  You're running v{agentHealth?.version}. New features (job
                  queue, %pc bulk export, audit trail) require an update.
                </span>
              </div>
              <Button asChild size='sm' variant='outline'>
                <a
                  href='https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/OmniFrame_Agent.zip'
                  target='_blank'
                  rel='noreferrer'
                >
                  <Download className='mr-1 h-3.5 w-3.5' />
                  Download
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

      {/* 2026-05-07 enterprise redesign — compact single-row status strip
          replaces the previous bulky AgentStatusBar Card. The strip also
          owns the Console drawer toggle (right-aligned) so the user can
          flip the bottom drawer open without scrolling. */}
      <AgentStatusBar
        status={agentStatus}
        health={agentHealth}
        sessions={sapSessions}
        onRefresh={checkAgent}
        onSelectSession={selectSapSession}
        onRefreshSessions={loadSapSessions}
        consoleOpen={consoleOpen}
        onToggleConsole={() => setConsoleOpen((v) => !v)}
        consoleMessageCount={consoleMessages.length}
        isFleet={executionMode.isFleet}
      />

      {/* 2026-05-09 — Local / Fleet routing toggle. The picked mode
          governs every in-scope inventory action (LT10/MB52/MMBE
          queries, ZMM60 lookup, LT01 transfer, MM02 mutations, LS01N
          create-bin) via `useExecutionMode().dispatch`. SAP Recorder
          and Reversal Engine bypass the toggle (they need the LIVE
          local SAP GUI session) — picking those queries while the
          toggle is in 'fleet' surfaces a "Local-only" pill in the
          Library and a banner in the right pane explaining the
          override. */}
      <InventoryExecutionModeToggle
        mode={executionMode.mode}
        onModeChange={executionMode.setMode}
        fleetAgentId={executionMode.fleetAgentId}
        onFleetAgentChange={executionMode.setFleetAgentId}
        fleetAgents={agentDetection.fleet.agents}
        activeCapability={selectedQuery.requiredCapability}
        activeQueryName={selectedQuery.name}
        disabled={isRunning}
      />

      {/* Query picker + inputs */}
      {/* 2026-05-07 redesign — two-pane workbench. Left rail stacks
          Library (with filter) + Form; right pane is results-first with
          an empty state when nothing has run. Console is decoupled into
          the bottom drawer (rendered below). Tool entries (recorder /
          reversal-engine) keep their full-width single-pane treatment
          since they replace the entire workspace. */}
      {selectedQuery.kind === 'tool' && selectedQuery.toolId === 'recorder' ? (
        <div className='grid gap-3 lg:grid-cols-[360px_1fr]'>
          <QueryLibraryCard
            selectedId={selectedQuery.id}
            onSelect={setSelectedQueryId}
            search={librarySearch}
            onSearchChange={setLibrarySearch}
            fleetModeActive={executionMode.isFleet}
          />
          <div className='space-y-3'>
            {executionMode.isFleet && (
              <LocalOnlyToolBanner toolName='SAP Recorder' />
            )}
            <RecorderPanel
              agentHealth={agentHealth}
              agentConnected={agentStatus === 'connected'}
              agentVersion={agentHealth?.version}
            />
          </div>
        </div>
      ) : selectedQuery.kind === 'tool' &&
        selectedQuery.toolId === 'reversal-engine' ? (
        <div className='grid gap-3 lg:grid-cols-[360px_1fr]'>
          <QueryLibraryCard
            selectedId={selectedQuery.id}
            onSelect={setSelectedQueryId}
            search={librarySearch}
            onSearchChange={setLibrarySearch}
            fleetModeActive={executionMode.isFleet}
          />
          <div className='space-y-3'>
            {executionMode.isFleet && (
              <LocalOnlyToolBanner toolName='Reversal Engine' />
            )}
            <ReversalPanel
              agentHealth={agentHealth}
              agentConnected={agentStatus === 'connected'}
              agentVersion={agentHealth?.version}
            />
          </div>
        </div>
      ) : selectedQuery.kind === 'tool' &&
        selectedQuery.toolId === 'inventory-adjustment' ? (
        <div className='grid items-start gap-3 lg:grid-cols-[320px_1fr]'>
          <div className='lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]'>
            <QueryLibraryCard
              selectedId={selectedQuery.id}
              onSelect={setSelectedQueryId}
              search={librarySearch}
              onSearchChange={setLibrarySearch}
              className='lg:max-h-[calc(100vh-180px)]'
              fleetModeActive={executionMode.isFleet}
            />
          </div>
          <div className='min-w-0'>
            <InventoryAdjustmentView />
          </div>
        </div>
      ) : (
        // 2026-05-09 redesign — unified detail pane. The Query Library
        // sits alone in the left rail; the right pane stacks a single
        // Query Detail Card (identity + description + status row + form
        // + Run CTA + LT01 quick-action chip + Batch panel) on top, and
        // the ResultsCard (or a compact placeholder) below it. Picking a
        // query in the left rail immediately reveals everything needed
        // to run it in the right pane — no scrolling between "what is
        // this query" and "run this query".
        <div className='grid items-start gap-3 lg:grid-cols-[320px_1fr]'>
          {/* Left rail — Query Library only. Sticky so the picker stays
              in view while results scroll long. */}
          <div className='lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]'>
            <QueryLibraryCard
              selectedId={selectedQuery.id}
              onSelect={setSelectedQueryId}
              search={librarySearch}
              onSearchChange={setLibrarySearch}
              className='lg:max-h-[calc(100vh-180px)]'
              fleetModeActive={executionMode.isFleet}
            />
          </div>

          {/* Right pane — Query Detail Card on top, Results below. */}
          <div className='flex min-w-0 flex-col gap-3'>
            <Card className='flex flex-col gap-0 overflow-hidden py-0 shadow-sm'>
              {/* Header: category eyebrow + name + transcode + clamped
                  description. */}
              <CardHeader className='space-y-1 px-6 pt-5 pb-3'>
                <div
                  className={cn(
                    'flex items-center gap-2 text-[10px] font-semibold tracking-widest uppercase',
                    CATEGORY_ACCENT[selectedQuery.category].text
                  )}
                >
                  <selectedQuery.icon className='h-3 w-3' />
                  <span>{categoryLabel(selectedQuery.category)}</span>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <CardTitle className='text-[15px] leading-tight font-semibold'>
                    {selectedQuery.name}
                  </CardTitle>
                  <Badge
                    variant='outline'
                    className='shrink-0 font-mono text-[10px] tracking-wide'
                  >
                    {selectedQuery.transaction}
                  </Badge>
                </div>
                <CardDescription className='line-clamp-2 text-xs'>
                  {selectedQuery.description}
                </CardDescription>
              </CardHeader>

              {/* Status strip: last-run / input count + agent gating
                  callout. Inline rather than its own Card so the
                  identity → status → form flow reads as one column. */}
              <div className='bg-muted/30 text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y px-6 py-2 text-[11px]'>
                {lastRunAt ? (
                  <span>
                    Last run{' '}
                    <span className='text-foreground font-medium'>
                      {new Date(lastRunAt).toLocaleTimeString()}
                    </span>
                  </span>
                ) : (
                  <span className='inline-flex items-center gap-1.5'>
                    <Sparkles className='h-3 w-3' />
                    Not yet run this session
                  </span>
                )}
                {selectedQuery.inputs.length > 0 && (
                  <>
                    <span className='opacity-50'>·</span>
                    <span>
                      <span className='text-foreground font-medium'>
                        {selectedQuery.inputs.length}
                      </span>{' '}
                      input{selectedQuery.inputs.length === 1 ? '' : 's'}
                    </span>
                  </>
                )}
                {/* 2026-05-09 follow-up — per-query readiness pill.
                    Replaces the previous `agentStatus !== 'connected'`
                    check (which was always-true for fleet-mode users
                    on a Mac with no local agent, even when their
                    fleet routing was working). The new
                    `executionMode.ready(requiredCapability)` signal
                    returns false ONLY when the active mode + picked
                    agent + capability combo can't actually dispatch:
                    local agent missing/stale/cap-light in local mode,
                    no fleet pick/offline pick/cap-light pick in fleet
                    mode. Reason copy names BOTH knobs the user can
                    turn so the toggle is always one click away. */}
                {!queryReady.ok && queryReady.reason && (
                  <span className='ml-auto inline-flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 text-amber-700 dark:text-amber-300'>
                    <ShieldAlert className='mt-0.5 h-3 w-3 shrink-0' />
                    <span className='leading-tight'>{queryReady.reason}</span>
                  </span>
                )}
              </div>

              <CardContent className='space-y-4 px-6 py-4'>
                {selectedQuery.inputs.length > 0 && (
                  <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
                    {selectedQuery.inputs.map((field) => (
                      <div key={field.name} className='space-y-1'>
                        <Label htmlFor={`input-${field.name}`}>
                          {field.label}
                          {field.required && (
                            <span className='text-red-500'> *</span>
                          )}
                        </Label>
                        <Input
                          id={`input-${field.name}`}
                          value={inputs[field.name] ?? ''}
                          onChange={(e) =>
                            setInputs((prev) => ({
                              ...prev,
                              [field.name]: e.target.value,
                            }))
                          }
                          placeholder={field.placeholder}
                          disabled={isRunning}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && canRun) runQuery()
                          }}
                        />
                        {field.help && (
                          <p className='text-muted-foreground text-xs'>
                            {field.help}
                          </p>
                        )}
                      </div>
                    ))}
                    {/* 2026-05-09 — LT24 personal layout (ctxtLISTV).
                        Rendered as an additional grid cell ALONGSIDE
                        Material / Warehouse / TO Number (the user's
                        explicit ask). Lives outside `selectedQuery.inputs`
                        because it's a user-level preference (one value
                        per browser, persisted to `LT24_LAYOUT_KEY`)
                        rather than per-query session data the user
                        expects to wipe between runs. Auto-uppercased
                        in the onChange so SAP layout codes (always
                        uppercase) stay canonical regardless of caps
                        lock. Empty value ⇒ `handler_lt24` skips the
                        `ctxtLISTV` write entirely (default SAP layout
                        runs). */}
                    {selectedQuery.id === 'lt24-history' && (
                      <div className='space-y-1'>
                        <Label htmlFor='input-lt24-layout'>
                          Layout (optional)
                        </Label>
                        <Input
                          id='input-lt24-layout'
                          value={lt24Layout}
                          onChange={(e) =>
                            setLt24Layout(e.target.value.toUpperCase())
                          }
                          placeholder='JSINGHX'
                          maxLength={12}
                          disabled={isRunning}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && canRun) runQuery()
                          }}
                        />
                        <p className='text-muted-foreground text-xs'>
                          Optional — your personal SAP layout (ctxtLISTV). e.g.,
                          JSINGHX. Saved per browser.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 2026-05-09 — LT24 BDATU date range. Rendered as a
                    SECOND row directly below the standard input grid
                    (Material / Warehouse / TO Number) plus the
                    Layout cell from the prior block — same reasoning
                    as the Layout field for being OUTSIDE
                    `selectedQuery.inputs` (per-browser preference,
                    persisted to LT24_DATE_FROM_KEY / LT24_DATE_TO_KEY).
                    HTML5 `<input type="date">` gives us a native
                    picker on every modern browser without adding a
                    dependency, and emits ISO `YYYY-MM-DD` regardless
                    of the user's browser locale — the agent's
                    `_format_sap_date` converts ISO → SAP US
                    (MM/DD/YYYY) before the GUI write. Both fields
                    are OPTIONAL: empty values produce the same
                    behaviour as before the fields were added (the
                    handler skips the BDATU writes entirely). The
                    `bg-background` className keeps the native picker
                    on theme-aware shadcn surfaces (the browser
                    default is a light grey that clashes with dark
                    mode). */}
                {selectedQuery.id === 'lt24-history' && (
                  <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
                    <div className='space-y-1'>
                      <Label htmlFor='input-lt24-date-from'>
                        Date From (optional)
                      </Label>
                      <Input
                        id='input-lt24-date-from'
                        type='date'
                        value={lt24DateFrom}
                        max={lt24DateTo || undefined}
                        onChange={(e) => setLt24DateFrom(e.target.value)}
                        disabled={isRunning}
                        className='bg-background'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canRun) runQuery()
                        }}
                      />
                      <p className='text-muted-foreground text-xs'>
                        Earliest BDATU (creation date). Leave blank for no lower
                        bound.
                      </p>
                    </div>
                    <div className='space-y-1'>
                      <Label htmlFor='input-lt24-date-to'>
                        Date To (optional)
                      </Label>
                      <Input
                        id='input-lt24-date-to'
                        type='date'
                        value={lt24DateTo}
                        min={lt24DateFrom || undefined}
                        onChange={(e) => setLt24DateTo(e.target.value)}
                        disabled={isRunning}
                        className='bg-background'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canRun) runQuery()
                        }}
                      />
                      <p className='text-muted-foreground text-xs'>
                        Latest BDATU (creation date). Leave blank for no upper
                        bound.
                      </p>
                    </div>
                    {(lt24DateFrom || lt24DateTo) && (
                      <div className='flex items-end'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-muted-foreground hover:text-foreground h-9 text-xs'
                          onClick={() => {
                            setLt24DateFrom('')
                            setLt24DateTo('')
                          }}
                          disabled={isRunning}
                        >
                          <X className='mr-1 h-3 w-3' />
                          Clear date range
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* 2026-05-10 — LX25 Inventory Completion variant
                    summary. Renders ONLY for the
                    `lx25-inventory-completion` query (which has zero
                    `inputs` because the variants are hardcoded). Shows
                    the user exactly which 5 warehouses + variants
                    will run server-side so the "Run Query" button
                    isn't an opaque commitment — they can see the
                    fan-out target before clicking.
                    
                    The list pulls from the shared `LX25_WAREHOUSES`
                    constant exported by `inventory-completion-view.tsx`
                    so the FE summary and the agent's default fan-out
                    list never drift out of sync. */}
                {selectedQuery.id === 'lx25-inventory-completion' && (
                  <div className='border-border/60 bg-muted/30 rounded-lg border p-3'>
                    <div className='text-muted-foreground mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase'>
                      <Boxes className='h-3 w-3' />
                      <span>
                        Will run {LX25_WAREHOUSES.length} warehouses
                        (sequential)
                      </span>
                    </div>
                    <div className='grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5'>
                      {LX25_WAREHOUSES.map((w) => (
                        <div
                          key={w.warehouse}
                          className='border-border/50 bg-background flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5'
                        >
                          <span className='text-foreground font-mono text-xs font-semibold'>
                            {w.warehouse}
                          </span>
                          <span className='text-muted-foreground font-mono text-[10px]'>
                            {w.variant}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className='text-muted-foreground mt-2 text-[11px] leading-relaxed'>
                      Each warehouse runs LX25 with its dedicated SAP variant. A
                      failing variant won&apos;t abort the rest — failed
                      warehouses are flagged inline in the result.
                    </p>
                  </div>
                )}

                {/* Action row: primary Run + secondary chips (Batch
                    Mode, LT01 quick-action). When the agent is offline
                    the Run button stays disabled with an explanatory
                    title — the inline status callout above carries the
                    same message so users have both surfaces. */}
                <div className='flex flex-wrap items-center gap-2'>
                  {(() => {
                    // 2026-05-09 follow-up — `queryReady` now subsumes
                    // the previous `capMissing` + `offline` derivations
                    // (it returns ok=false for: local agent missing,
                    // local agent unauthenticated, local agent missing
                    // the capability, no fleet pick, fleet pick offline,
                    // fleet pick missing the capability — with reason
                    // copy that always names BOTH knobs the user can
                    // turn). The Run button reads ONE signal in ONE
                    // tooltip — no more divergent surfaces for the
                    // same underlying gate.
                    const disabledReason = !queryReady.ok
                      ? (queryReady.reason ?? '')
                      : ''
                    if (selectedQuery.mutationEndpoint) {
                      const showPreview =
                        Boolean(selectedQuery.dryRunEndpoint) &&
                        dryRunCapAvailable
                      return (
                        <>
                          <Button
                            onClick={runMutation}
                            disabled={!canRun}
                            title={disabledReason || undefined}
                          >
                            {isRunning ? (
                              <>
                                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                                Running...
                              </>
                            ) : (
                              <>
                                <PlayCircle className='mr-2 h-4 w-4' />
                                Run
                              </>
                            )}
                          </Button>
                          {showPreview && (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={openSingleDryRun}
                              disabled={!canRun}
                              title='Read current SAP value(s) before committing'
                            >
                              <Eye className='mr-1 h-3.5 w-3.5' />
                              Preview
                            </Button>
                          )}
                        </>
                      )
                    }
                    return (
                      <>
                        <Button
                          onClick={runQuery}
                          disabled={!canRun}
                          title={disabledReason || undefined}
                        >
                          {isRunning ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Running...
                            </>
                          ) : (
                            <>
                              <PlayCircle className='mr-2 h-4 w-4' />
                              Run Query
                            </>
                          )}
                        </Button>
                        {result?.ok && (
                          <Button
                            variant='outline'
                            onClick={runQuery}
                            disabled={!canRun}
                          >
                            <RefreshCw className='mr-2 h-4 w-4' />
                            Refresh
                          </Button>
                        )}
                      </>
                    )
                  })()}

                  {selectedQuery.id === 'll01-warehouse-activity-monitor' && (
                    <LL01HistoryPicker
                      runs={ll01History.runs}
                      selectedRunId={ll01ViewedRunId}
                      onSelectRun={selectLl01HistoryRun}
                      loading={ll01History.loadingIndex}
                    />
                  )}

                  {selectedQuery.batchable &&
                    selectedQuery.mutationEndpoint && (
                      <Button
                        variant='outline'
                        onClick={() => setBatchOpen((v) => !v)}
                        disabled={isRunning}
                      >
                        <Layers className='mr-2 h-4 w-4' />
                        Batch Mode
                        <ChevronDown
                          className={cn(
                            'ml-1 h-3 w-3 transition-transform',
                            batchOpen && 'rotate-180'
                          )}
                        />
                      </Button>
                    )}

                  {/* LT01 quick-action chip — sm-size outline next to the
                      Run button. Replaces the 2026-05-07 full-width
                      button below the form. Same capability gate +
                      manual-mode prefill.
                      
                      2026-05-09 follow-up — gate now reads through
                      `executionMode.ready('transfer-inventory')` so a
                      fleet-mode user picking an agent that has the
                      `transfer-inventory` capability can open the
                      dialog even when their LOCAL agent is missing or
                      capability-light. The dialog itself routes through
                      the same `executionMode.dispatch` path so the
                      submission honours the toggle. */}
                  {selectedQuery.id === 'lt10-bin-stock' &&
                    (() => {
                      const lt01Ready =
                        executionMode.ready('transfer-inventory')
                      return (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setTransferDialogPrefill({
                              warehouse: inputs.warehouse ?? '',
                              material: '',
                              plant: '',
                              storageLocation: '',
                              sourceStorageType: '',
                              sourceStorageBin: '',
                              manual: true,
                            })
                          }
                          disabled={!lt01Ready.ok}
                          title={
                            lt01Ready.ok
                              ? 'Open the Transfer Inventory dialog to manually enter all parameters'
                              : (lt01Ready.reason ?? undefined)
                          }
                        >
                          <ArrowLeftRight className='mr-1.5 h-3.5 w-3.5' />
                          Transfer Inventory (LT01)
                        </Button>
                      )
                    })()}
                </div>

                {selectedQuery.batchable &&
                  selectedQuery.mutationEndpoint &&
                  batchOpen && (
                    <BatchModePanel
                      query={selectedQuery}
                      csv={batchCsv}
                      onCsvChange={setBatchCsv}
                      onRun={() => runBatch()}
                      onPreviewRun={
                        selectedQuery.dryRunEndpoint && dryRunCapAvailable
                          ? openBatchDryRun
                          : undefined
                      }
                      onCancel={cancelBatch}
                      isRunning={isRunning}
                      progress={batchProgress}
                      canRun={canRun}
                      formInputs={inputs}
                      queueMode={queueMode}
                      onQueueModeChange={setQueueMode}
                      queueAvailable={
                        // 2026-05-09 follow-up — in fleet mode every
                        // batch row routes through the queue regardless
                        // (it IS the fleet path), so the BatchModePanel
                        // shouldn't grey out the queue checkbox. Local
                        // mode keeps the original capability gate.
                        executionMode.isFleet ||
                        hasCapability(agentHealth, 'jobs-queue')
                      }
                      pinnedAgentId={pinnedAgentId}
                      onPinnedAgentIdChange={setPinnedAgentId}
                      onlineAgents={onlineAgents}
                    />
                  )}
              </CardContent>
            </Card>

            {/* Results — surfaces directly below the detail card. When
                nothing has run yet we render a compact placeholder
                (no longer duplicating identity/description, since
                those now live in the detail card above).
                
                2026-05-09 — `lt24-history` overrides the standard
                `<ResultsCard>` with a custom Journey/Timeline view
                (`<TransferOrderHistoryView />`) so the user sees the
                physical movement trail instead of a flat-row table.
                The standard form/dispatch infrastructure above remains
                shared — only the result renderer is swapped.

                2026-05-10 — `lx25-inventory-completion` overrides the
                standard `<ResultsCard>` with the new
                `<InventoryCompletionView />` (aggregate stat card + 5
                per-warehouse cards + detail table). Same shared form/
                dispatch infrastructure — only the renderer differs. */}
            {selectedQuery.id === 'lt24-history' ? (
              <TransferOrderHistoryView
                result={result}
                isRunning={isRunning}
                queryKey={`${selectedQuery.id}|${lastRunAt ?? ''}`}
                queryInputs={inputs}
                onRefresh={result ? runQuery : undefined}
              />
            ) : selectedQuery.id === 'lx25-inventory-completion' ? (
              <InventoryCompletionView
                result={completionResult}
                isRunning={isRunning}
                progress={completionProgress}
                lastRunAt={lastRunAt}
                onRefresh={runQuery}
              />
            ) : selectedQuery.id === 'll01-warehouse-activity-monitor' ? (
              <WarehouseActivityMonitorView
                result={ll01ViewedRun ?? ll01Result}
                isRunning={isRunning}
                progress={ll01Progress}
                lastRunAt={ll01ViewedRun?.ran_at ?? lastRunAt}
                onRefresh={runQuery}
                executionModeIsFleet={executionMode.isFleet}
                isHistorical={ll01ViewedRunId != null}
                historicalLoading={ll01ViewedLoading}
                onExitHistorical={() => void selectLl01HistoryRun(null)}
              />
            ) : result ? (
              <ResultsCard
                query={selectedQuery}
                result={result}
                displayedRows={displayedRows}
                pagedRows={pagedRows}
                visibleColumns={visibleColumns}
                stats={computedStats}
                tableSearch={tableSearch}
                onTableSearch={setTableSearch}
                sortBy={sortBy}
                onSort={(col) =>
                  setSortBy((prev) =>
                    prev.col === col
                      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                      : { col, dir: 'asc' }
                  )
                }
                onExport={exportCsv}
                page={safePage}
                pageSize={pageSize}
                totalPages={totalPages}
                pageStart={pageStart}
                pageEnd={pageEnd}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                actionContext={{
                  queryInputs: inputs,
                  openTransferDialog: setTransferDialogPrefill,
                  openBinBlocksDialog: setBinBlocksDialogPrefill,
                  addToInventoryAdjustment: handleAddToInventoryAdjustment,
                }}
                checkActionReady={executionMode.ready}
              />
            ) : (
              <ResultsEmptyState query={selectedQuery} />
            )}
          </div>
        </div>
      )}

      {/* 2026-05-07 redesign — collapsible bottom console drawer.
          Replaces the third workbench column. State persisted to
          localStorage so the user's preferred drawer state survives a
          page reload. Tool entries (recorder/reversal-engine) push
          activity messages here too, so the drawer stays mounted in
          all branches. */}
      <ConsoleDrawer
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        messages={consoleMessages}
        clearConsole={clearConsole}
        agentFilter={{
          agents: agentDetection.fleet.agents.map((a) => a.id),
          selected: consoleAgentFilter,
          onChange: setConsoleAgentFilter,
        }}
      />

      <TransferInventoryDialog
        prefill={transferDialogPrefill}
        onClose={() => setTransferDialogPrefill(null)}
        onSuccess={() => {
          // Re-run the current query so the table reflects post-transfer
          // bin state. Best-effort: if the user is on a different query
          // by the time it succeeds, no-op.
          void runQuery()
        }}
        pushConsole={pushConsole}
        agentHealth={agentHealth}
        executionMode={executionMode}
      />

      <BinBlocksDialog
        prefill={binBlocksDialogPrefill}
        onClose={() => setBinBlocksDialogPrefill(null)}
        onSuccess={() => {
          void runQuery()
        }}
        pushConsole={pushConsole}
        executionMode={executionMode}
      />

      {/* Phase C #7 — destructive-batch confirm dialog */}
      <Dialog
        open={bigBatchConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setBigBatchConfirm(null)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <ShieldAlert className='h-5 w-5 text-amber-500' />
              Confirm Large Batch
            </DialogTitle>
            <DialogDescription>
              You're about to run{' '}
              <span className='font-mono font-semibold'>
                {bigBatchConfirm?.rows ?? 0}
              </span>{' '}
              {selectedQuery.name.toLowerCase()} updates against SAP. This is
              irreversible. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setBigBatchConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => bigBatchConfirm?.onConfirm()}
            >
              <PlayCircle className='mr-2 h-4 w-4' />
              Yes, run {bigBatchConfirm?.rows ?? 0} updates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase D #11 — Material Master dry-run preview */}
      {dryRunDialog && selectedQuery.dryRunEndpoint && (
        <MaterialMasterDryRunDialog
          open={dryRunDialog !== null}
          onClose={() => setDryRunDialog(null)}
          query={{
            id: selectedQuery.id,
            name: selectedQuery.name,
            transaction: selectedQuery.transaction,
            mutationEndpoint: selectedQuery.mutationEndpoint,
            dryRunEndpoint: selectedQuery.dryRunEndpoint,
            dryRunCapability: selectedQuery.dryRunCapability,
          }}
          rows={dryRunDialog.rows}
          onConfirm={handleDryRunConfirm}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Agent Status Bar
// ──────────────────────────────────────────────────────────────────────

function AgentStatusBar({
  status,
  health,
  sessions,
  onRefresh,
  onSelectSession,
  onRefreshSessions,
  consoleOpen,
  onToggleConsole,
  consoleMessageCount,
  isFleet,
}: {
  status: AgentStatus
  health: AgentHealth | null
  sessions: SapSessionsData | null
  onRefresh: () => void
  onSelectSession: (connIdx: number, sessIdx: number) => void
  onRefreshSessions: () => void
  consoleOpen: boolean
  onToggleConsole: () => void
  consoleMessageCount: number
  /** 2026-05-09 follow-up — when true, the LOCAL agent's status is
   *  informational only (the active routing mode is Fleet, so local
   *  reachability doesn't gate inventory actions). The 'missing' /
   *  'unauthenticated' branches dim their copy and replace the
   *  alarming "Agent offline — start it from the One Click Ship tab"
   *  message with a neutral "Local agent offline · fleet routing
   *  active" line so the user isn't told to fix something that
   *  doesn't actually block them. */
  isFleet: boolean
}) {
  // 2026-05-07 enterprise redesign — single dense row replaces the
  // previous py-3 Card. Same information density as before; tighter
  // height (h-10 ≈ 40px). All four states now render a compact strip
  // with the Console toggle right-aligned so the user can flip the
  // bottom drawer from anywhere on the page.
  const ConsoleToggle = (
    <Button
      size='sm'
      variant={consoleOpen ? 'secondary' : 'outline'}
      className='ml-auto h-7 gap-1.5 px-2.5 text-xs'
      onClick={onToggleConsole}
      title={consoleOpen ? 'Hide SAP console' : 'Show SAP console'}
    >
      <Terminal className='h-3.5 w-3.5' />
      <span className='hidden sm:inline'>Console</span>
      {consoleMessageCount > 0 && (
        <Badge
          variant='secondary'
          className='h-4 min-w-4 px-1 font-mono text-[10px] tabular-nums'
        >
          {consoleMessageCount > 999 ? '999+' : consoleMessageCount}
        </Badge>
      )}
      {consoleOpen ? (
        <ChevronDown className='h-3 w-3' />
      ) : (
        <ChevronUp className='h-3 w-3' />
      )}
    </Button>
  )

  if (status === 'checking') {
    return (
      <div className='bg-card flex h-10 items-center gap-3 rounded-md border px-3 shadow-sm'>
        <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
        <span className='text-sm'>Checking for SAP Agent...</span>
        {ConsoleToggle}
      </div>
    )
  }

  if (status === 'missing') {
    // The minimal `<AgentNotDetectedBanner />` rendered above by the
    // parent tab carries the agent-not-detected message; the strip
    // renders a slim variant so the Console toggle stays accessible.
    //
    // 2026-05-09 follow-up — in fleet mode the local agent's
    // reachability is irrelevant (the user explicitly opted into
    // routing through a remote fleet agent). The strip drops the
    // "start it from the One Click Ship tab" call-to-action and
    // shows neutral copy that frames the local agent as informational
    // only — the toggle's own warning surfaces handle fleet-side
    // gating.
    return (
      <div className='bg-card flex h-10 items-center gap-3 rounded-md border px-3 shadow-sm'>
        <span
          className='inline-block h-2 w-2 shrink-0 rounded-full bg-zinc-400'
          aria-hidden
        />
        <span className='text-muted-foreground text-sm'>
          {isFleet
            ? 'Local agent offline · fleet routing active.'
            : 'Agent offline — start it from the One Click Ship tab.'}
        </span>
        {ConsoleToggle}
      </div>
    )
  }

  // v1.7.2 — process up but token stale (the v1.6.5 detection signal,
  // promoted to a real status here). Surfacing this distinctly tells
  // the user to use the AgentSupabaseStatusButton's "Reconnect Account"
  // pill instead of restarting the agent EXE.
  //
  // 2026-05-09 follow-up — fleet mode neutralises the alarm here too
  // (token-stale on the LOCAL agent doesn't block fleet routing).
  if (status === 'unauthenticated') {
    return (
      <div
        className={cn(
          'flex h-10 items-center gap-3 rounded-md border px-3 shadow-sm',
          isFleet ? 'bg-card' : 'border-yellow-500/60 bg-yellow-500/5'
        )}
      >
        <ShieldAlert
          className={cn(
            'h-4 w-4 shrink-0',
            isFleet
              ? 'text-muted-foreground'
              : 'text-yellow-600 dark:text-yellow-500'
          )}
        />
        <div className='min-w-0 flex-1 truncate text-sm'>
          {isFleet ? (
            <span className='text-muted-foreground'>
              Local agent online · session expired (fleet routing active).
            </span>
          ) : (
            <>
              <span className='font-medium'>
                Agent online — session expired.
              </span>{' '}
              <span className='text-muted-foreground hidden md:inline'>
                Click <strong>Reconnect Account</strong> to mint a fresh token.
              </span>
            </>
          )}
        </div>
        <AgentSupabaseStatusButton size='compact' />
        <Button
          size='sm'
          variant='ghost'
          className='h-7 gap-1 px-2'
          onClick={onRefresh}
        >
          <RefreshCw className='h-3 w-3' />
          <span className='hidden text-xs sm:inline'>Re-check</span>
        </Button>
        {ConsoleToggle}
      </div>
    )
  }

  const allOptions: Array<{
    value: string
    label: string
    connIdx: number
    sessIdx: number
  }> = []
  sessions?.connections.forEach((c) => {
    c.sessions.forEach((s) => {
      allOptions.push({
        value: `${c.index}:${s.index}`,
        label: `${c.label} — ${s.label}`,
        connIdx: c.index,
        sessIdx: s.index,
      })
    })
  })
  const currentValue = sessions
    ? `${sessions.selected_conn}:${sessions.selected_sess}`
    : ''

  // Phase C #2 + #6 — extract the active session's system/client/user so
  // we can render a big, color-coded pill instead of burying it.
  const activeConn = sessions?.connections.find(
    (c) => c.index === sessions?.selected_conn
  )
  const activeSess = activeConn?.sessions.find(
    (s) => s.index === sessions?.selected_sess
  )
  // The session label format is `<systemName> / <transaction>` per
  // /sap/sessions agent endpoint. Extract the system token; treat
  // anything matching /PRD/i as production red, /QAS|QA/i as amber,
  // /DEV|TST/i as green, otherwise neutral.
  const sessionLabel = activeSess?.label ?? ''
  const systemToken = (sessionLabel.split('/')[0] ?? '').trim()
  const envClass = (() => {
    const sys = systemToken.toUpperCase()
    if (/PRD|PROD/.test(sys))
      return 'border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400'
    if (/QAS|QA\b/.test(sys))
      return 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400'
    if (/DEV|TST|TEST/.test(sys))
      return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    return 'border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400'
  })()
  // Pull richer identifiers (client, user) by looking up the connection
  // description label which the agent populates from session.Info.
  const connDescription = activeConn?.label ?? ''

  return (
    <div className='bg-card flex h-10 flex-wrap items-center gap-2 rounded-md border border-emerald-500/40 px-2.5 shadow-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <ShieldCheck className='h-4 w-4 shrink-0 text-emerald-500' />
        {/* Phase C #2 + #6 — big session pill */}
        {systemToken && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold',
              envClass
            )}
            title={`Active SAP session: ${connDescription}`}
          >
            <Warehouse className='h-3.5 w-3.5' />
            <span className='font-mono tracking-wide uppercase'>
              {systemToken}
            </span>
            {connDescription && connDescription !== systemToken && (
              <span className='font-mono text-[10px] opacity-80'>
                {connDescription}
              </span>
            )}
          </div>
        )}
        <div className='flex min-w-0 flex-1 items-center gap-2 text-sm font-medium'>
          SAP Agent Connected
          {health?.version && (
            <span className='text-muted-foreground text-xs font-normal'>
              v{health.version}
            </span>
          )}
          <Badge
            variant='outline'
            className={
              health?.sap_connected
                ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                : 'border-amber-500/50 text-amber-600 dark:text-amber-400'
            }
          >
            SAP GUI: {health?.sap_connected ? 'connected' : 'not connected'}
          </Badge>
          <AgentSupabaseStatusButton size='compact' />
        </div>

        {/* v1.7.9 — pin-aware session picker. When the agent
              advertises `sap-session-pinning` we render the new picker
              (lock icon + criteria pill + checkmark on the pinned row +
              Unpin entry); older agents fall back to the v1.7.8 inline
              <select> so functionality doesn't regress on stale EXEs. */}
        {hasCapability(health, 'sap-session-pinning') ? (
          <div className='flex items-center gap-1'>
            <SapSessionPicker
              sessions={sessions}
              onChanged={async () => {
                await onRefreshSessions()
                onRefresh()
              }}
            />
            <Button
              size='sm'
              variant='ghost'
              className='h-7 w-7 p-0'
              onClick={onRefreshSessions}
              title='Refresh session list'
            >
              <RefreshCw className='h-3 w-3' />
            </Button>
          </div>
        ) : (
          allOptions.length > 0 && (
            <div className='flex items-center gap-1'>
              <Info className='h-3 w-3 shrink-0 text-blue-500' />
              <span className='text-muted-foreground text-xs'>Session:</span>
              <select
                className='border-input bg-background w-80 rounded-md border px-2 py-1 text-xs'
                value={currentValue}
                onChange={(e) => {
                  const [c, s] = e.target.value.split(':').map(Number)
                  onSelectSession(c, s)
                }}
              >
                {allOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Button
                size='sm'
                variant='ghost'
                className='h-7 w-7 p-0'
                onClick={onRefreshSessions}
                title='Refresh session list'
              >
                <RefreshCw className='h-3 w-3' />
              </Button>
            </div>
          )
        )}
      </div>
      {ConsoleToggle}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Query Library Card
// ──────────────────────────────────────────────────────────────────────

/** 2026-05-09 — predicate matching queries that ALWAYS run on the
 *  local agent regardless of the Local/Fleet toggle. SAP Recorder
 *  needs the LIVE local SAP GUI session (it screen-records the user's
 *  own clicks); Reversal Engine returns a synchronous JSON inverse
 *  payload that doesn't fit a queue-claim round-trip without a UI
 *  rework. Both stay on `agentFetch` regardless of toggle state. */
function isLocalOnlyTool(q: QueryDefinition): boolean {
  return (
    q.kind === 'tool' &&
    (q.toolId === 'recorder' || q.toolId === 'reversal-engine')
  )
}

/** 2026-05-09 — explicit banner when the user opens a local-only tool
 *  while the Inventory Management tab toggle is in fleet mode. The
 *  tool itself ignores the toggle (uses `agentFetch` directly), but
 *  without this banner the user might wonder why their queries are
 *  routing to the fleet agent but the Recorder/Reversal Engine isn't.
 */
function LocalOnlyToolBanner({ toolName }: { toolName: string }) {
  return (
    <div className='flex items-start gap-2 rounded-md border border-zinc-400/50 bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-600/50 dark:bg-zinc-900/60 dark:text-zinc-300'>
      <Cpu className='mt-0.5 h-3.5 w-3.5 shrink-0' />
      <div className='flex-1'>
        <div className='font-medium'>{toolName} runs on the local agent</div>
        <div className='mt-0.5 opacity-90'>
          The Local / Fleet toggle above governs every other inventory action,
          but this tool needs the live local SAP GUI session and always uses{' '}
          <code className='font-mono'>localhost:8765</code> regardless of the
          toggle.
        </div>
      </div>
    </div>
  )
}

function QueryLibraryCard({
  selectedId,
  onSelect,
  className,
  search = '',
  onSearchChange,
  fleetModeActive = false,
}: {
  selectedId: string
  onSelect: (id: string) => void
  className?: string
  /** 2026-05-07 redesign — case-insensitive substring filter applied to
   *  query name + transcode. Empty string ⇒ show all. The Library card
   *  hides the filter input entirely when `onSearchChange` is omitted
   *  so existing call-sites without a search container still work. */
  search?: string
  onSearchChange?: (v: string) => void
  /** 2026-05-09 — when true, surface a "Local-only" pill on entries
   *  that bypass the fleet-routing toggle (SAP Recorder, Reversal
   *  Engine). The button stays clickable so the user can still open
   *  the tool — selecting it just doesn't honour the toggle. */
  fleetModeActive?: boolean
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return QUERY_LIBRARY
    return QUERY_LIBRARY.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.transaction.toLowerCase().includes(q)
    )
  }, [search])

  const categories = useMemo(() => {
    const map: Record<string, QueryDefinition[]> = {}
    for (const q of filtered) {
      ;(map[q.category] ??= []).push(q)
    }
    return map
  }, [filtered])

  return (
    <Card className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
      <CardHeader className='gap-2 pb-2'>
        <CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase'>
          <FileSearch className='h-3.5 w-3.5' />
          Query Library
          <Badge
            variant='secondary'
            className='ml-auto font-mono text-[10px] font-normal'
          >
            {filtered.length}
            {filtered.length !== QUERY_LIBRARY.length && (
              <span className='text-muted-foreground/70'>
                {' / '}
                {QUERY_LIBRARY.length}
              </span>
            )}
          </Badge>
        </CardTitle>
        {onSearchChange && (
          <div className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2' />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder='Filter by name or transcode...'
              className='h-8 pr-7 pl-7 text-xs'
              aria-label='Filter queries'
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
                aria-label='Clear filter'
              >
                <X className='h-3 w-3' />
              </button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className='min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3'>
        {filtered.length === 0 ? (
          <div className='text-muted-foreground px-3 py-8 text-center text-xs'>
            No queries match{' '}
            <span className='text-foreground font-mono'>"{search}"</span>.
          </div>
        ) : (
          Object.entries(categories).map(([category, queries]) => {
            const accent =
              CATEGORY_ACCENT[category as QueryDefinition['category']] ??
              CATEGORY_ACCENT.custom
            return (
              <div key={category} className='space-y-0.5'>
                <div className='flex items-center gap-2 px-2 pb-1'>
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      accent.bar
                    )}
                    aria-hidden
                  />
                  <span className='text-muted-foreground/80 text-[10px] font-semibold tracking-widest uppercase'>
                    {categoryLabel(category as QueryDefinition['category'])}
                  </span>
                  <span className='text-muted-foreground/60 ml-auto font-mono text-[10px]'>
                    {queries.length}
                  </span>
                </div>
                {queries.map((q) => {
                  const active = q.id === selectedId
                  const Icon = q.icon
                  const localOnlyInFleet = fleetModeActive && isLocalOnlyTool(q)
                  return (
                    <button
                      key={q.id}
                      onClick={() => onSelect(q.id)}
                      className={cn(
                        'group relative flex w-full items-start gap-2.5 rounded-md py-1.5 pr-2 pl-3 text-left transition-colors',
                        active
                          ? 'bg-accent text-foreground'
                          : 'hover:bg-accent/50 text-foreground/90',
                        // Mute local-only entries while the fleet toggle is
                        // on so the user's eye reads "this is greyed out"
                        // even though the click still works.
                        localOnlyInFleet && !active && 'opacity-50'
                      )}
                      title={
                        localOnlyInFleet
                          ? `${q.name} always runs on the local agent — the Fleet Agent toggle has no effect on this entry.`
                          : undefined
                      }
                    >
                      {/* Category accent stripe — always visible (subtle
                          when inactive, full saturation when active). */}
                      <span
                        className={cn(
                          'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r-full transition-opacity',
                          accent.bar,
                          active
                            ? 'opacity-100'
                            : 'opacity-30 group-hover:opacity-70'
                        )}
                        aria-hidden
                      />
                      <Icon
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0',
                          active
                            ? accent.icon
                            : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <span className='text-[13px] leading-snug font-medium'>
                            {q.name}
                          </span>
                          {localOnlyInFleet && (
                            <Badge
                              variant='outline'
                              className='border-zinc-400/60 px-1 py-0 text-[9px] font-normal tracking-wide text-zinc-600 uppercase dark:text-zinc-400'
                            >
                              Local-only
                            </Badge>
                          )}
                        </div>
                        <div className='text-muted-foreground mt-0.5 font-mono text-[10px] tracking-wide'>
                          {q.transaction}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Results Empty State (compact placeholder beneath the Detail card)
// ──────────────────────────────────────────────────────────────────────

// 2026-05-09 redesign — the previous variant duplicated identity (icon
// halo + eyebrow + name + description) which now lives in the Query
// Detail Card directly above this placeholder. The compact replacement
// is a single dashed-border row that simply reserves space for results
// and points the user back at the form above. Last-run / agent gating
// are surfaced in the Detail card's status row, so they're omitted here
// to avoid double-messaging.
function ResultsEmptyState({ query }: { query: QueryDefinition }) {
  const accent = CATEGORY_ACCENT[query.category] ?? CATEGORY_ACCENT.custom
  return (
    <div className='border-muted-foreground/30 bg-muted/20 text-muted-foreground flex items-center gap-3 rounded-lg border border-dashed px-6 py-6'>
      <div className={cn('rounded-md p-2', accent.bg)}>
        <Layers className={cn('h-4 w-4', accent.icon)} />
      </div>
      <div className='min-w-0 flex-1 text-xs'>
        <div className='text-foreground text-sm font-medium'>
          No results yet
        </div>
        <div>
          Run <span className='font-mono'>{query.transaction}</span> from the
          form above to populate this area.
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Console Drawer (collapsible bottom panel)
// ──────────────────────────────────────────────────────────────────────

function ConsoleDrawer({
  open,
  onClose,
  messages,
  clearConsole,
  agentFilter,
}: {
  open: boolean
  onClose: () => void
  messages: ReturnType<typeof useSapConsole>['messages']
  clearConsole: () => void
  agentFilter: {
    agents: string[]
    selected: string | null
    onChange: (next: string | null) => void
  }
}) {
  if (!open) return null
  return (
    <div className='relative'>
      <SapConsoleCard
        messages={messages}
        onClear={clearConsole}
        className='lg:h-[280px]'
        agentFilter={agentFilter}
      />
      <Button
        size='sm'
        variant='ghost'
        className='absolute top-2 right-2 z-10 h-7 w-7 p-0'
        onClick={onClose}
        aria-label='Hide console'
        title='Hide console'
      >
        <X className='h-3.5 w-3.5' />
      </Button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Results Card (table)
// ──────────────────────────────────────────────────────────────────────

function ResultsCard({
  query,
  result,
  displayedRows,
  pagedRows,
  visibleColumns,
  stats,
  tableSearch,
  onTableSearch,
  sortBy,
  onSort,
  onExport,
  page,
  pageSize,
  totalPages,
  pageStart,
  pageEnd,
  onPageChange,
  onPageSizeChange,
  actionContext,
  checkActionReady,
}: {
  query: QueryDefinition
  result: QueryResult
  displayedRows: Record<string, string>[]
  pagedRows: Record<string, string>[]
  visibleColumns: Array<{
    id: string
    title: string
    format?: 'number' | 'date' | 'plain'
    className?: string
  }>
  stats: Array<{
    spec: QueryStatSpec
    value: number | null
    formatted: string
  }>
  tableSearch: string
  onTableSearch: (v: string) => void
  sortBy: { col: string | null; dir: 'asc' | 'desc' }
  onSort: (col: string) => void
  onExport: () => void
  page: number
  pageSize: number
  totalPages: number
  pageStart: number
  pageEnd: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
  actionContext: QueryActionContext
  /** 2026-05-09 follow-up — readiness probe for row-action capability
   *  gating. The dropdown items in `<RowActionsMenu>` previously gated
   *  on `hasCapability(agentHealth, action.requiredCapability)` which
   *  consulted the LOCAL agent — a fleet-mode user with a working
   *  picked agent saw every row action greyed out as "needs update"
   *  even though their actual claimant was perfectly capable. The new
   *  probe routes through `executionMode.ready(cap)` so the row-action
   *  gate lines up with the rest of the tab's gating. */
  checkActionReady: (capability?: string) => {
    ok: boolean
    reason: string | null
  }
}) {
  if (!result.ok) {
    return (
      <Card className='border-red-500/50'>
        <CardContent className='space-y-2 py-4'>
          <div className='flex items-center gap-2'>
            <XCircle className='h-5 w-5 text-red-500' />
            <span className='text-sm font-medium'>Query failed</span>
          </div>
          <div className='rounded bg-red-50 p-3 font-mono text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400'>
            {result.error}
          </div>
        </CardContent>
      </Card>
    )
  }

  const totalRows = result.rows?.length ?? 0
  const filteredCount = displayedRows.length
  const isEmpty = totalRows === 0

  return (
    <Card className='border-emerald-500/40'>
      <CardHeader className='space-y-2 pb-3'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <CheckCircle2 className='h-4 w-4 text-emerald-500' />
            {query.name} Results
            <Badge variant='outline' className='font-mono text-xs'>
              {totalRows} row{totalRows !== 1 ? 's' : ''}
            </Badge>
            {filteredCount !== totalRows && (
              <Badge variant='secondary' className='text-xs'>
                filtered: {filteredCount}
              </Badge>
            )}
          </CardTitle>
          <div className='flex items-center gap-2'>
            <div className='relative'>
              <Search className='text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2' />
              <Input
                value={tableSearch}
                onChange={(e) => onTableSearch(e.target.value)}
                placeholder='Search rows...'
                className='h-8 w-52 pl-7 text-xs'
              />
              {tableSearch && (
                <button
                  onClick={() => onTableSearch('')}
                  className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
                  aria-label='Clear search'
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </div>
            <Button size='sm' variant='outline' onClick={onExport}>
              <Download className='mr-1 h-3 w-3' />
              CSV
            </Button>
          </div>
        </div>
        {result.meta && (
          <div className='text-muted-foreground flex flex-wrap gap-2 text-xs'>
            {Object.entries(result.meta).map(([k, v]) => (
              <Badge
                key={k}
                variant='secondary'
                className='font-mono text-[10px]'
              >
                {k}: {String(v)}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      {stats.length > 0 && !isEmpty && (
        <div className='border-b px-4 pt-1 pb-4'>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {stats.map(({ spec, formatted }) => {
              const Icon = spec.icon
              return (
                <div
                  key={spec.id}
                  className='bg-muted/30 flex items-center gap-3 rounded-lg border p-3'
                >
                  {Icon && (
                    <div
                      className={cn(
                        'bg-background rounded-md p-2',
                        spec.accentClass ?? 'text-foreground'
                      )}
                    >
                      <Icon className='h-4 w-4' />
                    </div>
                  )}
                  <div className='min-w-0 flex-1'>
                    <div className='text-muted-foreground text-xs'>
                      {spec.label}
                    </div>
                    <div
                      className={cn(
                        'text-lg leading-tight font-semibold tabular-nums',
                        spec.accentClass
                      )}
                    >
                      {formatted}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <CardContent className='p-0'>
        {isEmpty ? (
          <div className='text-muted-foreground py-10 text-center text-sm'>
            No rows returned. Try different inputs.
          </div>
        ) : (
          // Single scroll container handling BOTH x and y so horizontal
          // scrolling stays fluid. The inline `&>div` selector neutralises
          // shadcn `<Table>`'s built-in `overflow-x-auto` wrapper, which
          // otherwise creates a competing horizontal scroll context that
          // makes wheel/trackpad gestures stutter.
          //
          // `overscroll-contain` prevents scroll-chaining to the page,
          // `will-change: scroll-position` hints the browser to optimise
          // the scroll-paint pipeline.
          <div
            className='max-h-[600px] overflow-auto overscroll-contain *:data-[slot=table-container]:overflow-visible!'
            style={{ willChange: 'scroll-position', contain: 'paint' }}
          >
            <Table>
              <TableHeader className='bg-muted/30 sticky top-0 z-10'>
                <TableRow>
                  {/* Selection / row-actions header */}
                  {query.rowActions && query.rowActions.length > 0 && (
                    <TableHead className='bg-muted/30 sticky left-0 z-20 w-[120px] text-xs whitespace-nowrap'>
                      Selection
                    </TableHead>
                  )}
                  {visibleColumns.map((col) => {
                    const isSorted = sortBy.col === col.id
                    const SortIcon = isSorted
                      ? sortBy.dir === 'asc'
                        ? ArrowUpAZ
                        : ArrowDownAZ
                      : ArrowUpDown
                    return (
                      <TableHead
                        key={col.id}
                        onClick={() => onSort(col.id)}
                        className='hover:bg-muted cursor-pointer text-xs whitespace-nowrap select-none'
                      >
                        <span className='inline-flex items-center gap-1'>
                          {col.title}
                          <SortIcon
                            className={`h-3 w-3 ${
                              isSorted
                                ? 'text-primary'
                                : 'text-muted-foreground/50'
                            }`}
                          />
                        </span>
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((row, idx) => (
                  <TableRow key={pageStart + idx} className='hover:bg-muted/40'>
                    {query.rowActions && query.rowActions.length > 0 && (
                      <TableCell className='bg-background sticky left-0 z-10 w-[120px] whitespace-nowrap'>
                        <RowActionsMenu
                          row={row}
                          actions={query.rowActions}
                          visibleColumns={visibleColumns}
                          actionContext={actionContext}
                          checkActionReady={checkActionReady}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((col) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          'font-mono text-xs whitespace-nowrap',
                          col.format === 'number' && 'text-right tabular-nums',
                          col.className
                        )}
                      >
                        {formatCellValue(row[col.id], col.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {!isEmpty && displayedRows.length > pageSize && (
        <div className='border-t px-4 py-2'>
          <div className='flex flex-wrap items-center justify-between gap-3 text-xs'>
            <div className='text-muted-foreground'>
              Showing{' '}
              <span className='text-foreground font-medium'>
                {pageStart + 1}
                {'–'}
                {pageEnd}
              </span>{' '}
              of{' '}
              <span className='text-foreground font-medium'>
                {displayedRows.length.toLocaleString()}
              </span>{' '}
              rows
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground'>Rows per page:</span>
              <select
                className='border-input bg-background rounded-md border px-1.5 py-0.5 text-xs'
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {[50, 100, 250, 500, 1000].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <Button
                size='sm'
                variant='outline'
                className='h-7 w-7 p-0'
                disabled={page === 0}
                onClick={() => onPageChange(0)}
                aria-label='First page'
              >
                «
              </Button>
              <Button
                size='sm'
                variant='outline'
                className='h-7 w-7 p-0'
                disabled={page === 0}
                onClick={() => onPageChange(page - 1)}
                aria-label='Previous page'
              >
                ‹
              </Button>
              <span className='text-muted-foreground tabular-nums'>
                Page {page + 1} / {totalPages}
              </span>
              <Button
                size='sm'
                variant='outline'
                className='h-7 w-7 p-0'
                disabled={page >= totalPages - 1}
                onClick={() => onPageChange(page + 1)}
                aria-label='Next page'
              >
                ›
              </Button>
              <Button
                size='sm'
                variant='outline'
                className='h-7 w-7 p-0'
                disabled={page >= totalPages - 1}
                onClick={() => onPageChange(totalPages - 1)}
                aria-label='Last page'
              >
                »
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Row-action dropdown
// ──────────────────────────────────────────────────────────────────────

function RowActionsMenu({
  row,
  actions,
  visibleColumns,
  actionContext,
  checkActionReady,
}: {
  row: Record<string, string>
  actions: QueryRowAction[]
  visibleColumns: Array<{ id: string; title: string }>
  actionContext: QueryActionContext
  /** 2026-05-09 follow-up — see `ResultsCard.checkActionReady` for
   *  rationale. Honours the Local/Fleet toggle so a fleet-mode user
   *  with a capable picked agent doesn't see every row action greyed
   *  out as "needs update". */
  checkActionReady: (capability?: string) => {
    ok: boolean
    reason: string | null
  }
}) {
  // Allow the action handler to look up cell values by friendly title.
  const value = (specTitle: string): string => {
    const col = visibleColumns.find(
      (c) => c.title.toLowerCase() === specTitle.toLowerCase()
    )
    if (!col) return ''
    return String(row[col.id] ?? '').trim()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='sm' variant='outline' className='h-7 gap-1 px-2 text-xs'>
          Actions
          <ChevronDown className='h-3 w-3' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-56'>
        {actions.map((action) => {
          const Icon = action.icon
          // Phase B8 — capability gating per row action.
          // 2026-05-09 follow-up — `checkActionReady` consults the
          // EFFECTIVE agent (local OR picked fleet) instead of the
          // local agent only.
          const readiness = checkActionReady(action.requiredCapability)
          const blocked = !readiness.ok
          return (
            <DropdownMenuItem
              key={action.id}
              disabled={blocked}
              onSelect={() => {
                if (blocked) return
                action.onClick(row, value, actionContext)
              }}
              className='text-xs'
              title={blocked ? (readiness.reason ?? undefined) : undefined}
            >
              {Icon && <Icon className='mr-2 h-3.5 w-3.5' />}
              {action.label}
              {blocked && (
                <span className='text-muted-foreground ml-auto text-[10px]'>
                  blocked
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Cell formatting
// ──────────────────────────────────────────────────────────────────────

/**
 * Parse a number from SAP's list output, accounting for SAP-specific
 * conventions:
 *   - Trailing minus sign: "2-" means -2
 *   - Comma thousands separators: "1,234" → 1234
 *   - Padding whitespace
 *   - Leading minus sign (just in case)
 *
 * Returns null when the value is blank or not parseable.
 */
/** Build a one-line summary of a mutation submission for the SAP
 *  Console. Shows the most identifying inputs first (material, bin,
 *  storage-type defaults) then everything else. Optional fields that
 *  are blank-on-purpose render as "name=(cleared)" so the intent is
 *  unambiguous. */
/** Map a query's mutation endpoint to its agent-side handler name so
 *  audit log rows are uniform across all entry points (browser, batch,
 *  queue). Falls back to the transaction code when no mapping exists. */
function handlerNameForQuery(query: QueryDefinition): string {
  const map: Record<string, string> = {
    '/sap/material-master-bin': 'material_master_bin',
    '/sap/material-master-storage-types': 'material_master_storage_types',
    '/sap/create-storage-bin': 'create_storage_bin',
    '/sap/transfer-inventory': 'transfer_inventory',
    '/sap/bin-blocks': 'set_bin_blocks',
    '/sap/confirm-to': 'confirm_transfer_order',
    '/sap/process-shipment': 'process_shipment',
  }
  if (query.mutationEndpoint && map[query.mutationEndpoint]) {
    return map[query.mutationEndpoint]
  }
  return (query.handler || query.transaction || 'unknown').toLowerCase()
}

/** Phase 5 — Material Master endpoints that route through the rust-
 *  work-service `/api/v1/sap-mutations/material-master` endpoint. The
 *  server adds the role gate, concurrency lock, rate limit, and
 *  pre-flight audit row before the `sap_agent_jobs` INSERT — so even
 *  a stolen JWT or a runaway batch loop is bounded server-side. See
 *  `Implementations/Implement-Rust-Work-Service-Phase5.md`. */
const PHASE5_MATERIAL_MASTER_ENDPOINTS: ReadonlySet<string> = new Set([
  '/sap/material-master-bin',
  '/sap/material-master-storage-types',
])

/** True when `mutationEndpoint` is one of the Material Master endpoints
 *  that the Phase 5 work-service wrapper guards. */
function isPhase5MaterialMasterEndpoint(endpoint: string | undefined): boolean {
  return endpoint != null && PHASE5_MATERIAL_MASTER_ENDPOINTS.has(endpoint)
}

/** Build the request body for the Phase 5 work-service endpoint from
 *  the FE's flat `inputs` map. The work-service splits `material` /
 *  `plant` / `warehouse` / `storage_type` out as structural fields
 *  and treats the rest as MM02 column overrides — `null` is a
 *  meaningful "clear this column" value (e.g. blanking a storage
 *  bin). */
function buildPhase5MaterialMasterBody(
  selectedQuery: QueryDefinition,
  inputs: Record<string, string>,
  opts: {
    pinnedAgentId: string | null
    prevState?: Record<string, unknown> | null
  }
): MaterialMasterMutationBody {
  const fields: Record<string, string | null> = {}
  for (const field of selectedQuery.inputs) {
    if (
      field.name === 'material' ||
      field.name === 'plant' ||
      field.name === 'warehouse' ||
      field.name === 'storage_type'
    ) {
      continue
    }
    const raw = inputs[field.name]
    fields[field.name] = raw == null || raw === '' ? null : raw
  }
  return {
    material: (inputs.material ?? '').trim(),
    plant: (inputs.plant ?? '').trim(),
    warehouse:
      typeof inputs.warehouse === 'string' && inputs.warehouse.trim() !== ''
        ? inputs.warehouse.trim()
        : undefined,
    storage_type:
      typeof inputs.storage_type === 'string' &&
      inputs.storage_type.trim() !== ''
        ? inputs.storage_type.trim()
        : undefined,
    fields,
    assigned_agent_id: opts.pinnedAgentId,
    prev_state: opts.prevState ?? undefined,
    endpoint: selectedQuery.mutationEndpoint,
    transaction_code: selectedQuery.transaction,
    action: handlerNameForQuery(selectedQuery),
  }
}

function mutationOneLineSummary(
  query: QueryDefinition,
  inputs: Record<string, string>
): string {
  const priority = [
    'material',
    'storage_bin',
    'removal_storage_type',
    'placement_storage_type',
    'plant',
    'warehouse',
    'storage_type',
    'org_storage_type',
  ]
  // Fields where blank means "explicitly cleared" rather than "skipped".
  const clearableOptional = new Set([
    'storage_bin',
    'removal_storage_type',
    'placement_storage_type',
  ])
  const parts: string[] = []
  const has = (name: string) => query.inputs.some((f) => f.name === name)
  for (const key of priority) {
    if (!has(key)) continue
    if (inputs[key]) {
      parts.push(`${key.replace(/_/g, ' ')}=${inputs[key]}`)
    } else if (clearableOptional.has(key)) {
      parts.push(`${key.replace(/_/g, ' ')}=(cleared)`)
    }
  }
  for (const f of query.inputs) {
    if (priority.includes(f.name)) continue
    if (inputs[f.name])
      parts.push(`${f.name.replace(/_/g, ' ')}=${inputs[f.name]}`)
  }
  return `${query.name}: ${parts.join(' · ')}`
}

/** Parse a CSV-like batch input string into rows of {input.name: value}.
 *
 *  Supports three flavours so spreadsheets paste cleanly:
 *
 *   1. **Header row** — if the first non-comment row is a list of valid
 *      input field names (any case), columns map by name. Subsequent
 *      rows can include any subset of fields in any order.
 *
 *   2. **Positional** — without a header, columns map left-to-right
 *      against the query's input list (legacy behaviour).
 *
 *   3. **Form fallback** — any field absent from the CSV row (because
 *      it wasn't in the header, or its cell was blank) inherits the
 *      value the user typed into the form's main inputs above. So you
 *      can set Plant once at the top, paste a 4-column CSV without
 *      Plant, and every row gets the form's Plant value.
 *
 *  Both tabs and commas are accepted as separators.
 */
function parseBatchCsv(
  raw: string,
  inputs: QueryInputField[],
  formInputs: Record<string, string>
): Array<{ values: Record<string, string>; missing: string[] }> {
  const splitCells = (s: string) => s.split(/\s*[,\t]\s*/).map((c) => c.trim())

  const lines = raw.split(/\r?\n/)
  const dataLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    dataLines.push(trimmed)
  }
  if (dataLines.length === 0) return []

  // Header detection: every cell on the first row matches an input name.
  const inputByName = new Map<string, QueryInputField>()
  for (const f of inputs) inputByName.set(f.name.toLowerCase(), f)

  const firstCells = splitCells(dataLines[0])
  let headerNames: string[] | null = null
  if (
    firstCells.length > 0 &&
    firstCells.every((c) => c.length > 0 && inputByName.has(c.toLowerCase()))
  ) {
    headerNames = firstCells.map((c) => c.toLowerCase())
    dataLines.shift()
  }

  const out: Array<{ values: Record<string, string>; missing: string[] }> = []
  for (const line of dataLines) {
    const cells = splitCells(line)
    const values: Record<string, string> = {}

    if (headerNames) {
      headerNames.forEach((name, i) => {
        const field = inputByName.get(name)
        if (field) values[field.name] = cells[i] ?? ''
      })
    } else {
      inputs.forEach((field, i) => {
        values[field.name] = cells[i] ?? ''
      })
    }

    // Fallback: any blank/missing field inherits the form's current value.
    for (const field of inputs) {
      if (!(values[field.name] ?? '').trim()) {
        const formValue = (formInputs[field.name] ?? '').trim()
        if (formValue) values[field.name] = formValue
      }
      values[field.name] ??= ''
    }

    const missing = inputs
      .filter((f) => f.required && !(values[f.name] ?? '').trim())
      .map((f) => f.label)
    out.push({ values, missing })
  }
  return out
}

function parseSapNumber(raw: string | undefined): number | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  // Detect trailing minus (SAP convention: 1234.56-) and rewrite to leading
  let normalized = v.replace(/,/g, '')
  if (/-\s*$/.test(normalized) && !normalized.startsWith('-')) {
    normalized = '-' + normalized.replace(/-\s*$/, '').trim()
  }
  const n = Number(normalized)
  return Number.isNaN(n) ? null : n
}

function formatCellValue(
  raw: string | undefined,
  format: 'number' | 'date' | 'plain' | undefined
): string {
  const v = (raw ?? '').trim()
  if (!v) return ''
  if (format === 'number') {
    const n = parseSapNumber(v)
    if (n !== null) {
      return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
    }
    return v
  }
  if (format === 'date') {
    // SAP list output dates often look like "11/25/2025" — leave alone
    // unless we recognise a different format. Preserves blanks.
    return v
  }
  return v
}

// ──────────────────────────────────────────────────────────────────────
// Transfer Inventory Dialog (LT01)
// ──────────────────────────────────────────────────────────────────────

interface TransferInventoryResponse {
  ok: boolean
  message?: string
  to_number?: string
  error?: string
  step?: string
  warning?: boolean
}

function TransferInventoryDialog({
  prefill,
  onClose,
  onSuccess,
  pushConsole,
  agentHealth,
  executionMode,
}: {
  prefill: TransferInventoryPrefill | null
  onClose: () => void
  onSuccess: (toNumber: string | undefined) => void
  pushConsole: PushConsole
  agentHealth: AgentHealth | null
  /** 2026-05-09 — fleet-routing toggle. The dialog forwards LT01 to
   *  `dispatch('/sap/transfer-inventory', payload)` so a fleet-mode
   *  user's LT01 runs on the picked Citrix agent's pinned SAP session
   *  instead of the local agent. */
  executionMode: ReturnType<typeof useExecutionMode>
}) {
  const open = prefill !== null
  const manual = prefill?.manual === true
  const [quantity, setQuantity] = useState('')
  const [destStorageType, setDestStorageType] = useState('')
  const [destStorageBin, setDestStorageBin] = useState('')
  const [movementType, setMovementType] = useState('999')
  const [batch, setBatch] = useState('')
  // v2.0.1 LT01 expanded form — four optional fields that mirror the
  // SAP initial-screen controls LTAP-BESTQ / LTAP-SOBKZ / RL03T-LSONR
  // / LTAP-LDEST. All four default to "" so the standard own-stock /
  // unrestricted / default-printer flow keeps working unchanged.
  // `specialStockNumber` is disabled until `specialStockIndicator` is
  // set — SAP rejects an LSONR value when SOBKZ is blank, so the UI
  // mirrors that constraint. `printDestination` is independent of the
  // SOBKZ chain (always editable when the capability is present).
  const [stockCategory, setStockCategory] = useState('')
  const [specialStockIndicator, setSpecialStockIndicator] = useState('')
  const [specialStockNumber, setSpecialStockNumber] = useState('')
  const [printDestination, setPrintDestination] = useState('')
  // Manual-mode source fields — only used when `prefill.manual === true`.
  // For row-driven opens these stay empty and the read-only summary
  // block renders straight from `prefill.*` instead.
  const [manualWarehouse, setManualWarehouse] = useState('')
  const [manualMaterial, setManualMaterial] = useState('')
  const [manualPlant, setManualPlant] = useState('')
  const [manualStorageLocation, setManualStorageLocation] = useState('')
  const [manualSourceStorageType, setManualSourceStorageType] = useState('')
  const [manualSourceStorageBin, setManualSourceStorageBin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<TransferInventoryResponse | null>(null)

  // Capability gate: older agents (< v2.0.1) silently drop the new
  // fields because Pydantic ignores unknown keys, but a missing
  // capability lets us surface a tooltip so the user knows the values
  // they're entering won't reach SAP. We still RENDER the inputs
  // (collapsing them on capability miss would be confusing); we just
  // disable + label the section as "agent too old".
  const supportsStockFields = hasCapability(agentHealth, 'lt01-stock-fields')

  // Clear LSONR whenever SOBKZ becomes empty so the disabled input
  // doesn't carry over a stale value the user can't see/edit.
  useEffect(() => {
    if (!specialStockIndicator) {
      setSpecialStockNumber('')
    }
  }, [specialStockIndicator])

  useEffect(() => {
    if (prefill) {
      setQuantity('')
      setDestStorageType(prefill.sourceStorageType)
      setDestStorageBin('')
      setMovementType('999')
      setBatch('')
      // v2.0.1 follow-up — prefill BESTQ/SOBKZ/LSONR from the source
      // row. Treat missing / blank / SAP-padded-space cells as
      // "not present" via trim. Auto-uppercase to match the input
      // behaviour (the inputs themselves uppercase on type, but
      // prefilled values bypass onChange). LDEST is intentionally
      // left blank — it's a per-action printer override, not a row
      // attribute.
      const prefilledStockCategory = (prefill.sourceStockCategory ?? '')
        .trim()
        .toUpperCase()
      const prefilledSpecialStockIndicator = (
        prefill.sourceSpecialStockIndicator ?? ''
      )
        .trim()
        .toUpperCase()
      // LSONR keeps its original casing (sales orders are numeric;
      // project / handling-unit ids like "I.LJL83A" are mixed-case).
      // Only meaningful if SOBKZ is non-empty — older rows without
      // the Special Stock Number column pass undefined here.
      const prefilledSpecialStockNumber = prefilledSpecialStockIndicator
        ? (prefill.sourceSpecialStockNumber ?? '').trim()
        : ''
      setStockCategory(prefilledStockCategory)
      setSpecialStockIndicator(prefilledSpecialStockIndicator)
      setSpecialStockNumber(prefilledSpecialStockNumber)
      setPrintDestination('')
      setManualWarehouse(prefill.warehouse)
      setManualMaterial(prefill.material)
      setManualPlant(prefill.plant)
      setManualStorageLocation(prefill.storageLocation)
      setManualSourceStorageType(prefill.sourceStorageType)
      setManualSourceStorageBin(prefill.sourceStorageBin)
      setResult(null)
    }
  }, [prefill])

  // Effective source values — manual mode reads from the editable
  // local state, row-driven mode reads from the immutable prefill.
  const effectiveWarehouse = manual
    ? manualWarehouse
    : (prefill?.warehouse ?? '')
  const effectiveMaterial = manual ? manualMaterial : (prefill?.material ?? '')
  const effectivePlant = manual ? manualPlant : (prefill?.plant ?? '')
  const effectiveStorageLocation = manual
    ? manualStorageLocation
    : (prefill?.storageLocation ?? '')
  const effectiveSourceStorageType = manual
    ? manualSourceStorageType
    : (prefill?.sourceStorageType ?? '')
  const effectiveSourceStorageBin = manual
    ? manualSourceStorageBin
    : (prefill?.sourceStorageBin ?? '')

  const handleSubmit = async () => {
    if (!prefill) return
    if (manual) {
      if (!effectiveMaterial.trim()) {
        toast.error('Material is required')
        return
      }
      if (!effectiveSourceStorageType.trim()) {
        toast.error('Source storage type is required')
        return
      }
      if (!effectiveSourceStorageBin.trim()) {
        toast.error('Source bin is required')
        return
      }
    }
    if (!quantity.trim()) {
      toast.error('Quantity is required')
      return
    }
    if (!destStorageType.trim()) {
      toast.error('Destination storage type is required')
      return
    }
    if (!destStorageBin.trim()) {
      toast.error('Destination bin is required')
      return
    }

    // Fleet-mode pre-check — surface a clean error before submitting
    // a row that no agent can claim. Local mode skips this; the local
    // agent's reachability is owned by `agentStatus`.
    if (executionMode.isFleet) {
      const reason = executionMode.blockedReason('transfer-inventory')
      if (reason) {
        toast.error('Fleet routing blocked', { description: reason })
        return
      }
    }

    setSubmitting(true)
    setResult(null)
    try {
      const startedAt = Date.now()
      const data = await executionMode.dispatch<TransferInventoryResponse>(
        '/sap/transfer-inventory',
        {
          warehouse: effectiveWarehouse.trim(),
          material: effectiveMaterial.trim(),
          quantity: quantity.trim(),
          plant: effectivePlant.trim(),
          storage_location: effectiveStorageLocation.trim(),
          batch: batch.trim(),
          source_storage_type: effectiveSourceStorageType.trim(),
          source_storage_bin: effectiveSourceStorageBin.trim(),
          dest_storage_type: destStorageType.trim(),
          dest_storage_bin: destStorageBin.trim(),
          movement_type: movementType.trim() || '999',
          // v2.0.1 expanded LT01 fields. The agent's
          // `TransferInventoryRequest` defaults each to "" so older
          // agents that don't yet declare `lt01-stock-fields` simply
          // ignore unknown keys (Pydantic extra='ignore'). The handler
          // skips the SAP control whenever the value is empty, so
          // sending blank strings is safe and idempotent.
          stock_category: stockCategory.trim().toUpperCase(),
          special_stock_indicator: specialStockIndicator.trim().toUpperCase(),
          special_stock_number: specialStockIndicator.trim()
            ? specialStockNumber.trim()
            : '',
          print_destination: printDestination.trim().toUpperCase(),
        },
        { capability: 'transfer-inventory' }
      )
      const durationMs = Date.now() - startedAt
      setResult(data)
      if (data.ok) {
        toast.success(
          data.to_number
            ? `Transfer Order ${data.to_number} created`
            : 'Transfer Order created',
          { description: data.message ?? '' }
        )
        pushConsole({
          level: 'success',
          source: 'LT01',
          text: data.to_number
            ? `Transfer Order ${data.to_number} created — ${effectiveMaterial.trim()} qty ${quantity.trim()} from ${effectiveSourceStorageBin.trim()} → ${destStorageBin.trim()}`
            : `Transfer Order created — ${effectiveMaterial.trim()} qty ${quantity.trim()} from ${effectiveSourceStorageBin.trim()} → ${destStorageBin.trim()}`,
          detail: data.message,
        })
        void logSapAudit({
          transactionCode: 'LT01',
          action: 'transfer_inventory',
          payload: {
            warehouse: effectiveWarehouse.trim(),
            material: effectiveMaterial.trim(),
            quantity: quantity.trim(),
            source_storage_bin: effectiveSourceStorageBin.trim(),
            dest_storage_bin: destStorageBin.trim(),
          },
          result: data,
          status: 'success',
          sapMessage: data.message ?? null,
          durationMs,
        })
        onSuccess(data.to_number)
        setTimeout(() => onClose(), 800)
      } else {
        toast.error('Transfer Inventory failed', {
          description: data.error ?? 'Unknown error',
        })
        void logSapAudit({
          transactionCode: 'LT01',
          action: 'transfer_inventory',
          payload: {
            warehouse: effectiveWarehouse.trim(),
            material: effectiveMaterial.trim(),
            quantity: quantity.trim(),
            source_storage_bin: effectiveSourceStorageBin.trim(),
            dest_storage_bin: destStorageBin.trim(),
          },
          result: data,
          status: data.warning ? 'warning' : 'error',
          step: data.step ?? null,
          sapMessage: data.error ?? null,
          durationMs,
        })
        pushConsole({
          level: 'error',
          source: 'LT01',
          text: `Transfer failed for ${effectiveMaterial.trim() || '(no material)'} from ${effectiveSourceStorageBin.trim() || '(no bin)'}`,
          detail: data.error ?? 'Unknown error',
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setResult({ ok: false, error: msg })
      toast.error('Transfer Inventory request failed', { description: msg })
      pushConsole({
        level: 'error',
        source: 'Agent',
        text: `Transfer Inventory request failed`,
        detail: msg,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose()
      }}
    >
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ArrowLeftRight className='h-5 w-5' />
            Transfer Inventory
            <Badge variant='outline' className='font-mono text-xs'>
              LT01
            </Badge>
            {manual && (
              <Badge
                variant='secondary'
                className='font-mono text-[10px] tracking-wide'
              >
                Manual entry
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {manual
              ? 'Create a Transfer Order by manually entering source and destination bin details. Use this when you need to move stock without first running an LT10 query.'
              : 'Create a Transfer Order to move stock between bins. Source bin details are pre-filled from the selected row; enter the quantity and destination below.'}
          </DialogDescription>
        </DialogHeader>

        {prefill && (
          <div className='space-y-4'>
            {manual ? (
              /* Manual-mode source block — fully editable. */
              <div className='grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-material'>
                    Material <span className='text-red-500'>*</span>
                  </Label>
                  <Input
                    id='lt01-manual-material'
                    value={manualMaterial}
                    onChange={(e) => setManualMaterial(e.target.value)}
                    placeholder='000000000000123456'
                    disabled={submitting}
                    autoFocus
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-warehouse'>Warehouse</Label>
                  <Input
                    id='lt01-manual-warehouse'
                    value={manualWarehouse}
                    onChange={(e) => setManualWarehouse(e.target.value)}
                    placeholder='WH5'
                    disabled={submitting}
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-src-typ'>
                    Source Storage Type <span className='text-red-500'>*</span>
                  </Label>
                  <Input
                    id='lt01-manual-src-typ'
                    value={manualSourceStorageType}
                    onChange={(e) => setManualSourceStorageType(e.target.value)}
                    placeholder='110'
                    disabled={submitting}
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-src-bin'>
                    Source Bin <span className='text-red-500'>*</span>
                  </Label>
                  <Input
                    id='lt01-manual-src-bin'
                    value={manualSourceStorageBin}
                    onChange={(e) => setManualSourceStorageBin(e.target.value)}
                    placeholder='K1-53-06-1'
                    disabled={submitting}
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-plant'>Plant</Label>
                  <Input
                    id='lt01-manual-plant'
                    value={manualPlant}
                    onChange={(e) => setManualPlant(e.target.value)}
                    placeholder='1000'
                    disabled={submitting}
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-manual-sloc'>Storage Location</Label>
                  <Input
                    id='lt01-manual-sloc'
                    value={manualStorageLocation}
                    onChange={(e) => setManualStorageLocation(e.target.value)}
                    placeholder='0001'
                    disabled={submitting}
                  />
                </div>
              </div>
            ) : (
              /* Read-only source block (row-driven open). */
              <div className='bg-muted/30 grid gap-3 rounded-md border p-3 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>
                    Material
                  </Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.material || '—'}
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>
                    Warehouse
                  </Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.warehouse || '—'}
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>
                    From Storage Type
                  </Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.sourceStorageType || '—'}
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>
                    From Bin
                  </Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.sourceStorageBin || '—'}
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>Plant</Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.plant || '—'}
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label className='text-muted-foreground text-xs'>
                    Storage Location
                  </Label>
                  <div className='font-mono text-sm font-medium'>
                    {prefill.storageLocation || '—'}
                  </div>
                </div>
              </div>
            )}

            {/* Editable target block */}
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label htmlFor='lt01-qty'>
                  Quantity <span className='text-red-500'>*</span>
                </Label>
                <Input
                  id='lt01-qty'
                  type='number'
                  inputMode='decimal'
                  step='any'
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder='1'
                  disabled={submitting}
                  autoFocus={!manual}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='lt01-mvt'>Movement Type</Label>
                <Input
                  id='lt01-mvt'
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value)}
                  placeholder='999'
                  disabled={submitting}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='lt01-dst-typ'>
                  Dest. Storage Type <span className='text-red-500'>*</span>
                </Label>
                <Input
                  id='lt01-dst-typ'
                  value={destStorageType}
                  onChange={(e) => setDestStorageType(e.target.value)}
                  placeholder='110'
                  disabled={submitting}
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='lt01-dst-bin'>
                  Dest. Bin <span className='text-red-500'>*</span>
                </Label>
                <Input
                  id='lt01-dst-bin'
                  value={destStorageBin}
                  onChange={(e) => setDestStorageBin(e.target.value)}
                  placeholder='K1-53-06-1'
                  disabled={submitting}
                />
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <Label htmlFor='lt01-batch'>
                  Batch{' '}
                  <span className='text-muted-foreground text-xs font-normal'>
                    (optional — only for batch-managed materials)
                  </span>
                </Label>
                <Input
                  id='lt01-batch'
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder=''
                  disabled={submitting}
                />
              </div>
            </div>

            {/* v2.0.1 — Stock Category / Special Stock / Special Stock
                Number. Three optional initial-screen fields needed for
                non-default LT01 flows (blocked stock, vendor consign,
                project stock, etc). Disabled with an explanatory note
                when the agent doesn't advertise `lt01-stock-fields` so
                the user knows the values would be silently dropped.
                LSONR is gated on SOBKZ being non-empty per SAP rules. */}
            <div className='space-y-2 rounded-md border border-dashed p-3'>
              <div className='flex items-center justify-between'>
                <div className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                  Stock attributes{' '}
                  <span className='text-muted-foreground/70 font-normal normal-case'>
                    (optional — leave blank for unrestricted own stock)
                  </span>
                </div>
                {!supportsStockFields && (
                  <Badge
                    variant='outline'
                    className='text-[10px] font-normal'
                    title='Agent does not advertise lt01-stock-fields capability — values will be ignored. Update agent to v2.0.1+.'
                  >
                    Requires agent v2.0.1+
                  </Badge>
                )}
              </div>
              <div className='grid gap-3 sm:grid-cols-3'>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-stock-cat'>Stock Category</Label>
                  <Input
                    id='lt01-stock-cat'
                    value={stockCategory}
                    onChange={(e) =>
                      setStockCategory(e.target.value.toUpperCase().slice(0, 1))
                    }
                    placeholder='S / Q / R'
                    maxLength={1}
                    disabled={submitting || !supportsStockFields}
                    className='font-mono uppercase'
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-spst-ind'>Special Stock</Label>
                  <Input
                    id='lt01-spst-ind'
                    value={specialStockIndicator}
                    onChange={(e) =>
                      setSpecialStockIndicator(
                        e.target.value.toUpperCase().slice(0, 1)
                      )
                    }
                    placeholder='E / K / Q / V / W'
                    maxLength={1}
                    disabled={submitting || !supportsStockFields}
                    className='font-mono uppercase'
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='lt01-spst-no'>Special Stock No.</Label>
                  <Input
                    id='lt01-spst-no'
                    value={specialStockNumber}
                    onChange={(e) => setSpecialStockNumber(e.target.value)}
                    placeholder={
                      specialStockIndicator
                        ? 'Sales order / vendor / project'
                        : 'Set Special Stock first'
                    }
                    disabled={
                      submitting ||
                      !supportsStockFields ||
                      !specialStockIndicator
                    }
                    className='font-mono'
                  />
                </div>
                {/* v2.0.1 follow-up — Print Destination spans the full
                    row below the 3-up grid. Independent of the SOBKZ
                    chain (always editable when capability present). */}
                <div className='space-y-1 sm:col-span-3'>
                  <Label htmlFor='lt01-print-dest'>
                    Print Destination{' '}
                    <span className='text-muted-foreground text-xs font-normal'>
                      — optional, overrides default printer (e.g.{' '}
                      <code className='font-mono'>PG44</code>)
                    </span>
                  </Label>
                  <Input
                    id='lt01-print-dest'
                    value={printDestination}
                    onChange={(e) =>
                      setPrintDestination(e.target.value.toUpperCase())
                    }
                    placeholder='PG44'
                    maxLength={4}
                    disabled={submitting || !supportsStockFields}
                    className='font-mono uppercase'
                  />
                </div>
              </div>
            </div>

            {/* Result strip */}
            {result && (
              <div
                className={cn(
                  'rounded-md border p-3 text-xs',
                  result.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400'
                )}
              >
                {result.ok ? (
                  <div className='flex items-center gap-2'>
                    <CheckCircle2 className='h-4 w-4' />
                    <span>
                      {result.to_number
                        ? `Transfer Order ${result.to_number} created`
                        : 'Transfer Order created'}
                    </span>
                    {result.message && (
                      <span className='text-muted-foreground ml-2'>
                        — {result.message}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className='flex items-start gap-2'>
                    <XCircle className='mt-0.5 h-4 w-4 shrink-0' />
                    <div>
                      <div className='font-medium'>
                        {result.step
                          ? `Failed at ${result.step.replace(/_/g, ' ')}`
                          : 'Failed'}
                      </div>
                      <div className='font-mono opacity-80'>
                        {result.error ?? 'Unknown error'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type='button' onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <ArrowLeftRight className='mr-2 h-4 w-4' />
            )}
            Create Transfer Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Bin Blocks Dialog (LS02N)
// ──────────────────────────────────────────────────────────────────────

interface BinBlocksResponse {
  ok: boolean
  message?: string
  error?: string
  step?: string
  warning?: boolean
  putaway_block?: boolean
  stock_removal_block?: boolean
}

function BinBlocksDialog({
  prefill,
  onClose,
  onSuccess,
  pushConsole,
  executionMode,
}: {
  prefill: BinBlocksPrefill | null
  onClose: () => void
  onSuccess: () => void
  pushConsole: PushConsole
  /** 2026-05-09 — fleet-routing toggle. The dialog forwards LS02N to
   *  `dispatch('/sap/bin-blocks', payload)` so a fleet-mode user's
   *  bin-block toggle lands on the picked Citrix agent's pinned SAP
   *  session. */
  executionMode: ReturnType<typeof useExecutionMode>
}) {
  const open = prefill !== null
  const [putawayBlocked, setPutawayBlocked] = useState(false)
  const [stockRemovalBlocked, setStockRemovalBlocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<BinBlocksResponse | null>(null)

  // Sync local state with the row's current block flags whenever
  // a new prefill arrives.
  useEffect(() => {
    if (prefill) {
      setPutawayBlocked(prefill.putawayBlocked)
      setStockRemovalBlocked(prefill.stockRemovalBlocked)
      setResult(null)
    }
  }, [prefill])

  const dirty =
    !!prefill &&
    (putawayBlocked !== prefill.putawayBlocked ||
      stockRemovalBlocked !== prefill.stockRemovalBlocked)

  const handleSubmit = async () => {
    if (!prefill) return
    if (executionMode.isFleet) {
      const reason = executionMode.blockedReason('bin-blocks')
      if (reason) {
        toast.error('Fleet routing blocked', { description: reason })
        return
      }
    }
    setSubmitting(true)
    setResult(null)
    try {
      const startedAt = Date.now()
      const data = await executionMode.dispatch<BinBlocksResponse>(
        '/sap/bin-blocks',
        {
          warehouse: prefill.warehouse,
          storage_type: prefill.storageType,
          storage_bin: prefill.storageBin,
          putaway_block: putawayBlocked,
          stock_removal_block: stockRemovalBlocked,
        },
        { capability: 'bin-blocks' }
      )
      const durationMs = Date.now() - startedAt
      setResult(data)
      if (data.ok) {
        const desc = `${prefill.storageBin} — Put: ${putawayBlocked ? 'blocked' : 'open'} · Stock removal: ${stockRemovalBlocked ? 'blocked' : 'open'}`
        toast.success('Bin blocks updated', { description: desc })
        pushConsole({
          level: 'success',
          source: 'LS02N',
          text: `Bin ${prefill.storageBin} (${prefill.storageType}) updated`,
          detail: desc,
        })
        void logSapAudit({
          transactionCode: 'LS02N',
          action: 'set_bin_blocks',
          payload: {
            warehouse: prefill.warehouse,
            storage_type: prefill.storageType,
            storage_bin: prefill.storageBin,
            putaway_block: putawayBlocked,
            stock_removal_block: stockRemovalBlocked,
          },
          result: data,
          status: 'success',
          sapMessage: data.message ?? null,
          durationMs,
        })
        onSuccess()
        setTimeout(() => onClose(), 800)
      } else {
        toast.error('Bin blocks update failed', {
          description: data.error ?? 'Unknown error',
        })
        pushConsole({
          level: 'error',
          source: 'LS02N',
          text: `Failed to update bin ${prefill.storageBin}`,
          detail: data.error ?? 'Unknown error',
        })
        void logSapAudit({
          transactionCode: 'LS02N',
          action: 'set_bin_blocks',
          payload: {
            warehouse: prefill.warehouse,
            storage_type: prefill.storageType,
            storage_bin: prefill.storageBin,
            putaway_block: putawayBlocked,
            stock_removal_block: stockRemovalBlocked,
          },
          result: data,
          status: data.warning ? 'warning' : 'error',
          step: data.step ?? null,
          sapMessage: data.error ?? null,
          durationMs,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setResult({ ok: false, error: msg })
      toast.error('Bin blocks request failed', { description: msg })
      pushConsole({
        level: 'error',
        source: 'Agent',
        text: `Bin blocks request failed`,
        detail: msg,
      })
      void logSapAudit({
        transactionCode: 'LS02N',
        action: 'set_bin_blocks',
        payload: {
          warehouse: prefill.warehouse,
          storage_type: prefill.storageType,
          storage_bin: prefill.storageBin,
          putaway_block: putawayBlocked,
          stock_removal_block: stockRemovalBlocked,
        },
        status: 'error',
        sapMessage: msg,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose()
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldOff className='h-5 w-5' />
            Bin Blocks
            <Badge variant='outline' className='font-mono text-xs'>
              LS02N
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Toggle the putaway and stock-removal block flags on this storage
            bin. Current state is loaded from the row.
          </DialogDescription>
        </DialogHeader>

        {prefill && (
          <div className='space-y-4'>
            {/* Read-only bin info */}
            <div className='bg-muted/30 grid gap-3 rounded-md border p-3 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label className='text-muted-foreground text-xs'>
                  Warehouse
                </Label>
                <div className='font-mono text-sm font-medium'>
                  {prefill.warehouse || '—'}
                </div>
              </div>
              <div className='space-y-1'>
                <Label className='text-muted-foreground text-xs'>
                  Storage Type
                </Label>
                <div className='font-mono text-sm font-medium'>
                  {prefill.storageType || '—'}
                </div>
              </div>
              <div className='space-y-1'>
                <Label className='text-muted-foreground text-xs'>
                  Storage Bin
                </Label>
                <div className='font-mono text-sm font-medium'>
                  {prefill.storageBin || '—'}
                </div>
              </div>
              <div className='space-y-1'>
                <Label className='text-muted-foreground text-xs'>
                  Material
                </Label>
                <div className='font-mono text-sm font-medium'>
                  {prefill.material || '—'}
                </div>
              </div>
            </div>

            {/* Block toggles */}
            <div className='space-y-3'>
              <BinBlockToggle
                id='ls02n-putaway'
                label='Putaway Block'
                description='Prevents new stock from being put away into this bin.'
                checked={putawayBlocked}
                onChange={setPutawayBlocked}
                wasChecked={prefill.putawayBlocked}
                disabled={submitting}
              />
              <BinBlockToggle
                id='ls02n-removal'
                label='Stock Removal Block'
                description='Prevents stock from being picked / withdrawn from this bin.'
                checked={stockRemovalBlocked}
                onChange={setStockRemovalBlocked}
                wasChecked={prefill.stockRemovalBlocked}
                disabled={submitting}
              />
            </div>

            {/* Result strip */}
            {result && (
              <div
                className={cn(
                  'rounded-md border p-3 text-xs',
                  result.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400'
                )}
              >
                {result.ok ? (
                  <div className='flex items-center gap-2'>
                    <CheckCircle2 className='h-4 w-4' />
                    <span>{result.message ?? 'Bin updated'}</span>
                  </div>
                ) : (
                  <div className='flex items-start gap-2'>
                    <XCircle className='mt-0.5 h-4 w-4 shrink-0' />
                    <div>
                      <div className='font-medium'>
                        {result.step
                          ? `Failed at ${result.step.replace(/_/g, ' ')}`
                          : 'Failed'}
                      </div>
                      <div className='font-mono opacity-80'>
                        {result.error ?? 'Unknown error'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={handleSubmit}
            disabled={submitting || !dirty}
            title={!dirty ? 'No changes to save' : ''}
          >
            {submitting ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <ShieldOff className='mr-2 h-4 w-4' />
            )}
            Save Block Flags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BinBlockToggle({
  id,
  label,
  description,
  checked,
  onChange,
  wasChecked,
  disabled,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  wasChecked: boolean
  disabled?: boolean
}) {
  const changed = checked !== wasChecked
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border p-3',
        changed && 'border-amber-500/50 bg-amber-500/5'
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className='mt-0.5'
      />
      <div className='flex-1 space-y-0.5'>
        <Label
          htmlFor={id}
          className='cursor-pointer text-sm leading-tight font-medium'
        >
          {label}
          {changed && (
            <Badge
              variant='outline'
              className='ml-2 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400'
            >
              {wasChecked ? 'unblock' : 'block'}
            </Badge>
          )}
        </Label>
        <p className='text-muted-foreground text-xs'>{description}</p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Batch Mode Panel — CSV input + progress bar for sequential mutations
// ──────────────────────────────────────────────────────────────────────

function BatchModePanel({
  query,
  csv,
  onCsvChange,
  onRun,
  onPreviewRun,
  onCancel,
  isRunning,
  progress,
  canRun,
  formInputs,
  queueMode,
  onQueueModeChange,
  queueAvailable,
  pinnedAgentId,
  onPinnedAgentIdChange,
  onlineAgents,
}: {
  query: QueryDefinition
  csv: string
  onCsvChange: (v: string) => void
  onRun: () => void
  /** Phase D #11 — when set, the primary action becomes "Preview & Run
   *  Batch (N)" which opens the dry-run dialog before committing.
   *  The original direct-commit Run is moved into a caret menu. When
   *  undefined (no `dryRunEndpoint` configured, or capability missing),
   *  the panel falls back to the legacy single-button layout. */
  onPreviewRun?: () => void
  onCancel: () => void
  isRunning: boolean
  progress: {
    total: number
    completed: number
    succeeded: number
    failed: number
    currentLabel: string
    cancelRequested: boolean
  } | null
  canRun: boolean
  formInputs: Record<string, string>
  /** Phase A1 — when true, runBatch routes via sap_agent_jobs. */
  queueMode: boolean
  onQueueModeChange: (v: boolean) => void
  /** Disabled when the running agent doesn't report jobs-queue. */
  queueAvailable: boolean
  /** Phase D #13 — optional sap_agents.id pin for queue-mode runs. */
  pinnedAgentId: string | null
  onPinnedAgentIdChange: (v: string | null) => void
  /** Online agents for the pin picker. Picker hides itself when empty. */
  onlineAgents: Array<{
    id: string
    hostname: string | null
    citrix_session: string | null
  }>
}) {
  const headerLine = query.inputs.map((f) => f.name).join(',')

  // Phase C #4 — load the last batch CSV for this query, if any.
  const lastBatchKey = `${LAST_BATCH_KEY_PREFIX}${query.id}`
  const [lastBatchAvailable, setLastBatchAvailable] = useState(false)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(lastBatchKey)
      setLastBatchAvailable(Boolean(stored && stored.trim()))
    } catch {
      setLastBatchAvailable(false)
    }
  }, [lastBatchKey])
  const handleRepeatLast = () => {
    try {
      const stored = localStorage.getItem(lastBatchKey)
      if (stored) {
        onCsvChange(stored)
        toast.success('Last batch reloaded', {
          description: `Restored ${stored.split(/\r?\n/).filter((l) => l.trim()).length} line(s)`,
        })
      }
    } catch {
      toast.error('Could not load last batch')
    }
  }
  // Live-parse so the row count matches what runBatch will execute (skips
  // header rows, comments, blanks).
  const parsedRows = useMemo(
    () => parseBatchCsv(csv, query.inputs, formInputs),
    [csv, query.inputs, formInputs]
  )
  const rowCount = parsedRows.length
  const missingRequiredOnAnyRow = parsedRows.some((r) => r.missing.length > 0)
  const firstMissingRow = parsedRows.findIndex((r) => r.missing.length > 0)
  const firstMissingMsg =
    firstMissingRow >= 0
      ? `Row ${firstMissingRow + 1} missing: ${parsedRows[firstMissingRow].missing.join(', ')}`
      : ''

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.warning('Clipboard is empty')
        return
      }
      onCsvChange(text)
      toast.success('Clipboard pasted')
    } catch {
      toast.error('Could not read clipboard', {
        description:
          'Browser blocked clipboard access. Click the textarea and press Ctrl+V (or Cmd+V) instead.',
      })
    }
  }
  const pct = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0

  return (
    <div className='bg-muted/20 mt-3 space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-sm font-medium'>
          <Layers className='h-4 w-4' />
          Batch Mode
          <Badge variant='secondary' className='font-mono text-xs'>
            {rowCount} row{rowCount !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className='flex items-center gap-2'>
          {/* Phase A1 — queue mode toggle */}
          <label
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
              queueMode
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-input',
              !queueAvailable && 'opacity-50'
            )}
            title={
              !queueAvailable
                ? 'Agent does not report jobs-queue capability — update agent to enable'
                : queueMode
                  ? 'Queue mode: batches survive page reloads'
                  : 'Browser mode: batch state lives only in this tab'
            }
          >
            <input
              type='checkbox'
              className='h-3 w-3'
              checked={queueMode && queueAvailable}
              disabled={isRunning || !queueAvailable}
              onChange={(e) => onQueueModeChange(e.target.checked)}
            />
            Run via Queue
          </label>
          {/* Phase D #13 — Pin picker. Hidden unless queue mode is on
              AND there's at least one online agent to pick. The
              "Any agent" entry clears the pin. */}
          {queueMode && queueAvailable && onlineAgents.length > 0 && (
            <select
              className={cn(
                'border-input bg-background h-7 rounded-md border px-1.5 text-[11px]',
                pinnedAgentId &&
                  'border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300'
              )}
              value={pinnedAgentId ?? ''}
              disabled={isRunning}
              onChange={(e) => onPinnedAgentIdChange(e.target.value || null)}
              title='Pin every job in this batch to a specific agent (sap_agents.id). Useful when one Citrix box has the right SAP system / warehouse data for the run.'
            >
              <option value=''>Any agent</option>
              {onlineAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  Pin → {agent.hostname || agent.id}
                  {agent.citrix_session ? ` (${agent.citrix_session})` : ''}
                </option>
              ))}
            </select>
          )}
          {lastBatchAvailable && (
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={handleRepeatLast}
              disabled={isRunning}
              title='Reload the last batch CSV submitted for this query'
            >
              <Repeat className='mr-1 h-3 w-3' />
              Repeat last
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            onClick={handlePasteFromClipboard}
            disabled={isRunning}
            title='Read clipboard contents into the textarea'
          >
            <Download className='mr-1 h-3 w-3' />
            Paste from Clipboard
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs'
            onClick={() => onCsvChange('')}
            disabled={isRunning || !csv}
            title='Clear textarea'
          >
            <X className='mr-1 h-3 w-3' />
            Clear
          </Button>
        </div>
      </div>

      <div className='text-muted-foreground space-y-0.5 text-[11px]'>
        <div>
          <span className='font-medium'>Tab- or comma-separated.</span> Paste
          straight from a spreadsheet — Excel/Sheets uses tabs.
        </div>
        <div>
          Optional first row may be a header naming the columns:
          <code className='bg-muted ml-1 rounded px-1 font-mono'>
            {headerLine}
          </code>
          . Any field omitted from a row inherits the form's value above.
        </div>
      </div>

      <textarea
        className={cn(
          'border-input bg-background min-h-[120px] w-full rounded-md border px-2 py-1.5 font-mono text-xs',
          'focus:ring-ring focus:ring-2 focus:outline-none',
          'disabled:opacity-50'
        )}
        spellCheck={false}
        placeholder={
          // Show the recommended header + a single example line. Keep it
          // minimal — overlong placeholders are noise.
          `${headerLine}\n${query.inputs
            .map((f) => f.placeholder ?? '')
            .join(',')}`
        }
        value={csv}
        onChange={(e) => onCsvChange(e.target.value)}
        disabled={isRunning}
      />

      {missingRequiredOnAnyRow && !isRunning && (
        <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'>
          <ShieldAlert className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <div>
            <div className='font-medium'>{firstMissingMsg}</div>
            <div className='text-amber-700/80 dark:text-amber-400/80'>
              Either add the field to your CSV (use a header line so the column
              order can vary), or fill it in the form above so all rows inherit
              it.
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className='space-y-1.5'>
          <div className='flex items-center justify-between text-xs'>
            <div className='flex items-center gap-2'>
              {isRunning ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin text-blue-500' />
              ) : progress.failed === 0 ? (
                <CheckCircle2 className='h-3.5 w-3.5 text-emerald-500' />
              ) : (
                <ShieldAlert className='h-3.5 w-3.5 text-amber-500' />
              )}
              <span className='font-medium'>
                {progress.completed} / {progress.total}
              </span>
              <span className='text-muted-foreground'>({pct}%)</span>
              {isRunning && progress.currentLabel && (
                <span className='text-muted-foreground'>
                  · current:{' '}
                  <span className='font-mono'>{progress.currentLabel}</span>
                </span>
              )}
            </div>
            <div className='flex items-center gap-2 text-xs'>
              <span className='text-emerald-600 dark:text-emerald-400'>
                ✓ {progress.succeeded}
              </span>
              <span className='text-red-600 dark:text-red-400'>
                ✗ {progress.failed}
              </span>
            </div>
          </div>
          <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300',
                progress.failed === 0 && !isRunning
                  ? 'bg-emerald-500'
                  : isRunning
                    ? 'bg-blue-500'
                    : 'bg-amber-500'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress.cancelRequested && (
            <div className='text-xs text-amber-600 dark:text-amber-400'>
              Cancellation requested — finishing current row…
            </div>
          )}
        </div>
      )}

      <div className='flex items-center gap-2'>
        {onPreviewRun ? (
          // Phase D #11 — split button: primary action runs the dry-run
          // preview first; the caret menu keeps the legacy "skip preview"
          // path for users who already trust their CSV.
          <div className='inline-flex items-stretch'>
            <Button
              onClick={onPreviewRun}
              disabled={!canRun || rowCount === 0}
              className='rounded-r-none'
            >
              {isRunning ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Running batch…
                </>
              ) : (
                <>
                  <Eye className='mr-2 h-4 w-4' />
                  Preview &amp; Run Batch ({rowCount})
                </>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='default'
                  disabled={!canRun || rowCount === 0 || isRunning}
                  className='rounded-l-none border-l border-l-white/20 px-2'
                  title='More run options'
                >
                  <ChevronDown className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  onClick={onRun}
                  disabled={!canRun || rowCount === 0}
                >
                  <PlayCircle className='mr-2 h-4 w-4' />
                  Run Batch without Preview ({rowCount})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button onClick={onRun} disabled={!canRun || rowCount === 0}>
            {isRunning ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Running batch…
              </>
            ) : (
              <>
                <PlayCircle className='mr-2 h-4 w-4' />
                Run Batch ({rowCount})
              </>
            )}
          </Button>
        )}
        {isRunning && (
          <Button variant='outline' onClick={onCancel}>
            <X className='mr-2 h-4 w-4' />
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
