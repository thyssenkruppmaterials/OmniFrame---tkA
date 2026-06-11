// Created and developed by Jai Singh
/**
 * Board registry — single source of truth for the six top-level boards.
 *
 * Lazy-loaded so each board's bundle is only fetched when its tab is
 * activated (this also keeps the parent `feature-shift-productivity`
 * chunk small).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  IconAlertTriangle,
  IconBriefcase,
  IconClockHour4,
  IconLayoutGrid,
  IconSpeakerphone,
  IconUsersGroup,
  type Icon,
} from '@tabler/icons-react'

export type BoardSlug =
  | 'hourly'
  | 'sqcdp'
  | 'announcements'
  | 'hr_news'
  | 'jobs'
  | 'safety_alerts'

export interface BoardProps {
  /** True when ?tv=1 is on. Each board is responsible for its own TV chrome. */
  isTv: boolean
  onExitTv: () => void
  onEnterTv: () => void
}

export interface BoardDef {
  slug: BoardSlug
  title: string
  description: string
  Icon: Icon
  Component: LazyExoticComponent<ComponentType<BoardProps>>
}

// Each board's index file default-exports a component matching `BoardProps`.
// Lazy-loading shaves the per-board JSX out of the parent chunk and into a
// per-board chunk that loads on first navigation.
const HourlyBoard = lazy(() => import('../boards/hourly/hourly-board'))
const SqcdpBoard = lazy(() => import('../boards/sqcdp/sqcdp-board'))
const AnnouncementsBoard = lazy(
  () => import('../boards/announcements/announcements-board')
)
const HrNewsBoard = lazy(() => import('../boards/hr-news/hr-news-board'))
const JobsBoard = lazy(() => import('../boards/jobs/jobs-board'))
const SafetyAlertsBoard = lazy(
  () => import('../boards/safety-alerts/safety-alerts-board')
)

export const BOARDS: readonly BoardDef[] = [
  {
    slug: 'hourly',
    title: 'Hourly',
    description: 'Per-associate × per-hour completion grid.',
    Icon: IconClockHour4,
    Component: HourlyBoard,
  },
  {
    slug: 'sqcdp',
    title: 'SQCDP',
    description:
      'Safety / Quality / Cost / Delivery / Production scorecards + active problems.',
    Icon: IconLayoutGrid,
    Component: SqcdpBoard,
  },
  {
    slug: 'announcements',
    title: 'Announcements',
    description: 'Floor-wide announcements, news, and call-outs.',
    Icon: IconSpeakerphone,
    Component: AnnouncementsBoard,
  },
  {
    slug: 'hr_news',
    title: 'HR News',
    description: 'Per-branch and company-wide HR communications.',
    Icon: IconUsersGroup,
    Component: HrNewsBoard,
  },
  {
    slug: 'jobs',
    title: 'Jobs',
    description: 'Internal and external job postings.',
    Icon: IconBriefcase,
    Component: JobsBoard,
  },
  {
    slug: 'safety_alerts',
    title: 'Safety Alerts',
    description: 'Active safety alerts with optional acknowledgement.',
    Icon: IconAlertTriangle,
    Component: SafetyAlertsBoard,
  },
] as const

export const BOARD_SLUGS: readonly BoardSlug[] = BOARDS.map((b) => b.slug)

export function isBoardSlug(value: string): value is BoardSlug {
  return (BOARD_SLUGS as readonly string[]).includes(value)
}

export function findBoard(slug: BoardSlug): BoardDef {
  return BOARDS.find((b) => b.slug === slug) ?? BOARDS[0]
}

// Created and developed by Jai Singh
