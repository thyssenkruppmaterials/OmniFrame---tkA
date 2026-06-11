// Created and developed by Jai Singh
/**
 * Template List Row
 *
 * Dense table row used by the list/table view of the Templates listing.
 * Pairs with `TemplateCard` so users can flip between Grid (visual) and
 * List (scannable) without losing context.
 */
import {
  Archive,
  Blocks,
  CalendarClock,
  Clock,
  Copy,
  Edit,
  FileText,
  MapPin,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkTemplate } from '@/hooks/use-standard-work'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TableCell, TableRow } from '@/components/ui/table'

interface TemplateListRowProps {
  template: StandardWorkTemplate
  areaName?: string
  onOpenBuilder: () => void
  onOpenAssignment: () => void
  onOpenScheduling: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
}

const STATUS_TONE: Record<
  StandardWorkTemplate['status'],
  { dot: string; text: string; label: string }
> = {
  active: {
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    label: 'Active',
  },
  draft: {
    dot: 'bg-muted-foreground/60',
    text: 'text-muted-foreground',
    label: 'Draft',
  },
  archived: {
    dot: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
    label: 'Archived',
  },
  deprecated: {
    dot: 'bg-destructive',
    text: 'text-destructive',
    label: 'Deprecated',
  },
}

export function TemplateListRow({
  template,
  areaName,
  onOpenBuilder,
  onOpenAssignment,
  onOpenScheduling,
  onEdit,
  onDuplicate,
  onArchive,
}: TemplateListRowProps) {
  const tone = STATUS_TONE[template.status] ?? STATUS_TONE.draft

  return (
    <TableRow
      className='hover:bg-muted/50 cursor-pointer'
      onClick={onOpenBuilder}
    >
      <TableCell className='py-2'>
        <div className='flex items-center gap-3'>
          <div
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md'
            style={{ backgroundColor: `${template.color}14` }}
          >
            <FileText
              className='h-3.5 w-3.5'
              style={{ color: template.color }}
              aria-hidden='true'
            />
          </div>
          <div className='min-w-0'>
            <p className='truncate text-sm font-medium'>
              {template.template_name}
            </p>
            {template.template_code ? (
              <p className='text-muted-foreground/80 truncate font-mono text-[10px]'>
                {template.template_code}
              </p>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className='py-2'>
        <span className={cn('flex items-center gap-1.5 text-xs', tone.text)}>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', tone.dot)}
            aria-hidden='true'
          />
          {tone.label}
        </span>
      </TableCell>
      <TableCell className='py-2'>
        <Badge variant='outline' className='h-5 text-[10px] capitalize'>
          {template.frequency.replace('_', ' ')}
        </Badge>
      </TableCell>
      <TableCell className='py-2 text-center text-xs tabular-nums'>
        {template.items_count ?? 0}
      </TableCell>
      <TableCell className='py-2 text-center'>
        <span className='text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums'>
          <Clock className='h-3 w-3' aria-hidden='true' />~
          {template.estimated_duration_minutes}m
        </span>
      </TableCell>
      <TableCell className='py-2'>
        {areaName ? (
          <span className='text-muted-foreground inline-flex items-center gap-1 truncate text-xs'>
            <MapPin className='h-3 w-3 shrink-0' aria-hidden='true' />
            <span className='truncate'>{areaName}</span>
          </span>
        ) : (
          <span className='text-muted-foreground/60 text-xs'>—</span>
        )}
      </TableCell>
      <TableCell className='py-2'>
        <div
          className='flex items-center justify-end gap-1'
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={onOpenBuilder}
            aria-label={`Build: ${template.template_name}`}
            title='Build'
          >
            <Blocks className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={onOpenAssignment}
            aria-label={`Assign: ${template.template_name}`}
            title='Assign'
          >
            <UserPlus className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={onOpenScheduling}
            aria-label={`Schedule: ${template.template_name}`}
            title='Schedule'
          >
            <CalendarClock className='h-3.5 w-3.5' aria-hidden='true' />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`More actions: ${template.template_name}`}
                className='h-7 w-7'
              >
                <MoreHorizontal className='h-4 w-4' aria-hidden='true' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={onEdit}>
                <Edit className='mr-2 h-4 w-4' />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className='mr-2 h-4 w-4' />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onArchive}
                className='text-destructive focus:text-destructive'
              >
                <Archive className='mr-2 h-4 w-4' />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

// Created and developed by Jai Singh
