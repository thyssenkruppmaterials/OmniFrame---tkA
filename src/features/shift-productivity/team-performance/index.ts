// Created and developed by Jai Singh
/**
 * Team Performance Feature Module
 * Export all components and hooks for the Team Performance Dashboard
 * Created: December 20, 2025
 * Updated: January 1, 2026 - Added ActivityGantt components
 * Updated: January 2, 2026 - Added AddEventDialog and ManageEventsDialog for timeline events
 */

// Main Dashboard
export {
  TeamPerformanceDashboard,
  default as TeamPerformanceDashboardDefault,
} from './team-performance-dashboard'

// Components
export { KPICard, PulseIndicator, StatsRow } from './components/kpi-card'
export {
  AssociatePerformanceRow,
  AssociateList,
  AvatarGroup,
} from './components/associate-performance-row'
export {
  DepartmentCard,
  AreaCard,
  DepartmentGrid,
  AreaGrid,
} from './components/department-card'
export {
  PerformanceBarChart,
  EfficiencyLineChart,
  TasksAreaChart,
  CombinedPerformanceChart,
  Sparkline,
} from './components/performance-chart'
export {
  ActivityGantt,
  ActivityGanttCompact,
  ActivityLegend,
  type OvertimeMarker,
} from './components/activity-gantt'
export { AddEventDialog } from './components/add-event-dialog'
export { ManageEventsDialog } from './components/manage-events-dialog'
export { ManageOvertimeDialog } from './components/manage-overtime-dialog'
export { RealTimeView } from './components/real-time-view'
export { HistoricalView } from './components/historical-view'

// Hooks
export { useTeamPerformance } from './hooks/use-team-performance'

// Types
export * from './types/team-performance.types'

// Created and developed by Jai Singh
