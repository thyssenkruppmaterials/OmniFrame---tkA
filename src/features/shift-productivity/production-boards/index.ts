// Created and developed by Jai Singh
/**
 * Production Boards Feature Module
 *
 * Multi-board TV-display surface. The page chrome lives at the root; each
 * board lives under `boards/<slug>/`. The hourly board (the original
 * v1–v5 work) is the canonical example and the only board with a real
 * data hook today; the other five boards (SQCDP, Announcements, HR News,
 * Jobs, Safety Alerts) shipped in v6.
 */
export { ProductionBoardsPage } from './production-boards-page'

// Top-level page chrome (shared across boards)
export { TvFrame } from './components/tv-frame'
export { TvClock } from './components/tv-clock'
export { BoardTabs } from './components/board-tabs'
export { BoardShell } from './components/board-shell'
export { BoardEditToggle } from './components/board-edit-toggle'
export { useBoardEditMode } from './hooks/use-board-edit-mode'

// Hourly-specific (re-exported so external imports stay stable)
export { HourlyCompletionBoard } from './boards/hourly/components/hourly-completion-board'
export { BoardLegend } from './boards/hourly/components/board-legend'
export { BoardHeader } from './boards/hourly/components/board-header'
export { BoardMetrics } from './boards/hourly/components/board-metrics'
export { AssociateIdCard } from './boards/hourly/components/associate-id-card'
export { SkillsMatrix } from './boards/hourly/components/skills-matrix'
export { AreaChapterOverlay } from './boards/hourly/components/area-chapter-overlay'
export { AreaTransitionFrame } from './boards/hourly/components/area-transition-frame'
export {
  accentHexFor,
  accentHexForKey,
  accentRgbaFor,
  AREA_COLOR_HEX,
  NEUTRAL_FALLBACK_HEX,
} from './boards/hourly/lib/area-color'
export {
  useHourlyProductivity,
  type ProductionBoardsFilters,
} from './boards/hourly/hooks/use-hourly-productivity'
export { useScreenWakeLock } from './hooks/use-screen-wake-lock'
export { useBoardSearchParam } from './hooks/use-board-search-param'
export { useCanEditBoards } from './hooks/use-can-edit-boards'
export { useBoardPosts } from './hooks/use-board-posts'
export { useBranches } from './hooks/use-branches'
export { useBoardWorkingAreas } from './hooks/use-board-working-areas'
export { PostCard } from './components/post-card'
export { PostComposerDialog } from './components/post-composer-dialog'
export { BentoBoardShell } from './components/bento/bento-board-shell'
export { BentoGrid } from './components/bento/bento-grid'
export { CardRenderer } from './components/bento/card-renderer'
export { BoardCardVariantPicker } from './components/bento/card-variant-picker'

// v2 aesthetic overhaul primitives (2026-05-17).
export { BoardAtmosphere } from './components/bento/board-atmosphere'
export { BoardEmptyState } from './components/bento/board-empty-state'
export { BoardFilterChips } from './components/bento/board-filter-chips'
export { BoardHeader as BentoBoardHeader } from './components/bento/board-header'
export { LivePulse } from './components/bento/live-pulse'
export {
  accentFor,
  gradientCss,
  meshConicCss,
  type BoardKindAccent,
} from './components/bento/board-kind-accent'
export {
  CARD_VARIANTS,
  VARIANT_DEFAULT_SIZE,
  VARIANT_LABEL,
  VARIANT_DESCRIPTION,
  parseCardVariant,
  parseVariantConfig,
  type BentoBoardKind,
  type BentoPostKind,
  type BoardCard,
  type CardLayoutRow,
  type CardVariant,
  type VariantConfig,
} from './components/bento/card-variant'
export { useBoardCardLayouts } from './hooks/use-board-card-layouts'
export {
  BOARDS,
  BOARD_SLUGS,
  findBoard,
  isBoardSlug,
  type BoardDef,
  type BoardProps,
  type BoardSlug,
} from './lib/boards'

export type {
  AssociateRow,
  AssociateSkills,
  AreaColorKey,
  BoardMetrics as BoardMetricsValue,
  HourBucket,
  HourCellState,
  HourTargets,
  HourTypeBreakdown,
  BoardDensity,
  SkillId,
  SkillState,
  TargetRamp,
} from './boards/hourly/lib/types'

export {
  CANONICAL_SKILLS,
  deriveAreaColor,
  getSkillLabel,
  getSkillState,
  mapEventTypeToSkill,
  mapPositionToSkill,
} from './boards/hourly/lib/skills'

export {
  BOARD_CLOSING_HOUR,
  BOARD_HOURS,
  BOARD_OPENING_HOUR,
  bucketEventsByHour,
  collectDemonstratedSkills,
  computeBoardMetrics,
  computeHoursElapsed,
  getHourCellState,
  getCurrentBoardHour,
  getCurrentHour,
  getLocalHour,
  formatHour,
  getAllHours,
  isWithinBoardHours,
  parseClockTime,
  isHourWithinShift,
  effectiveTargetForBucket,
  rampForTargetAchievement,
  summariseBucket,
} from './boards/hourly/lib/hour-bucket'

// Created and developed by Jai Singh
