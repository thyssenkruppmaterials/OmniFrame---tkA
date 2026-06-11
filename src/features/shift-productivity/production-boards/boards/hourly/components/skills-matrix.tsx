// Created and developed by Jai Singh
/**
 * Mini skills matrix shown inside the AssociateIdCard.
 *
 * Renders the canonical skill list as a row of compact monogram tiles
 * (one per skill). Each tile shows three states:
 *
 *   primary       — the associate's assigned position resolves to this skill
 *   demonstrated  — the associate has at least one event of this skill today
 *   none          — neither
 *
 * The matrix wraps a single TooltipProvider so the row only registers one
 * provider regardless of how many associates render — Radix is happy to
 * share a provider across triggers.
 */
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CANONICAL_SKILLS,
  getSkillState,
  type AssociateSkills,
  type SkillDef,
  type SkillState,
} from '../lib/skills'
import type { BoardDensity } from '../lib/types'

const STATE_CLASSES: Record<SkillState, string> = {
  primary:
    'bg-emerald-500 text-white border border-emerald-600 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
  demonstrated:
    'bg-emerald-500/30 text-emerald-50 border border-emerald-500/50 dark:bg-emerald-500/25 dark:text-emerald-100',
  none: 'bg-muted/50 text-muted-foreground/40 border border-border/40',
}

const TILE_SIZE: Record<BoardDensity, string> = {
  normal: 'h-4 w-4 rounded-[3px] text-[8px]',
  tv: 'h-6 w-6 rounded-md text-[10px] font-bold',
}

const TOOLTIP_BY_STATE: Record<SkillState, string> = {
  primary: 'Primary skill',
  demonstrated: 'Active today',
  none: 'No activity',
}

export interface SkillsMatrixProps {
  skills: AssociateSkills
  density?: BoardDensity
  className?: string
}

export function SkillsMatrix({
  skills,
  density = 'normal',
  className,
}: SkillsMatrixProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn('flex items-center gap-0.5', className)}
        data-component='skills-matrix'
        data-density={density}
        aria-label='Skill matrix'
      >
        {CANONICAL_SKILLS.map((skill) => (
          <SkillTile
            key={skill.id}
            skill={skill}
            state={getSkillState(skills, skill.id)}
            density={density}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}

function SkillTile({
  skill,
  state,
  density,
}: {
  skill: SkillDef
  state: SkillState
  density: BoardDensity
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role='img'
          aria-label={`${skill.label}: ${TOOLTIP_BY_STATE[state]}`}
          data-state={state}
          className={cn(
            'flex shrink-0 items-center justify-center font-semibold tabular-nums select-none',
            TILE_SIZE[density],
            STATE_CLASSES[state]
          )}
        >
          {skill.code}
        </span>
      </TooltipTrigger>
      <TooltipContent side='top' className='text-xs'>
        <div className='font-medium'>{skill.label}</div>
        <div className='text-[10px] opacity-80'>{TOOLTIP_BY_STATE[state]}</div>
      </TooltipContent>
    </Tooltip>
  )
}

// Created and developed by Jai Singh
