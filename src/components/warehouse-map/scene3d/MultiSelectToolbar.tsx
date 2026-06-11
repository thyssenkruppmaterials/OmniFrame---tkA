// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// MultiSelectToolbar — batch operations for 2+ selected scene objects.
// ---------------------------------------------------------------------------
// Align (6 edges), distribute (2 axes), duplicate, recolor, delete. Bottom-
// center DOM overlay; every action is one undoable command in the shell.
import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Copy,
  Trash2,
  X,
} from 'lucide-react'
import type { AlignEdge } from './geometry'

interface MultiSelectToolbarProps {
  count: number
  onAlign: (edge: AlignEdge) => void
  onDistribute: (axis: 'x' | 'z') => void
  onDuplicate: () => void
  onRecolor: (color: string) => void
  onDelete: () => void
  onClear: () => void
}

const ALIGN_BTNS: { edge: AlignEdge; Icon: typeof Copy; title: string }[] = [
  { edge: 'left', Icon: AlignHorizontalJustifyStart, title: 'Align left' },
  {
    edge: 'centerX',
    Icon: AlignHorizontalJustifyCenter,
    title: 'Align center (X)',
  },
  { edge: 'right', Icon: AlignHorizontalJustifyEnd, title: 'Align right' },
  { edge: 'top', Icon: AlignVerticalJustifyStart, title: 'Align top' },
  {
    edge: 'centerZ',
    Icon: AlignVerticalJustifyCenter,
    title: 'Align center (Z)',
  },
  { edge: 'bottom', Icon: AlignVerticalJustifyEnd, title: 'Align bottom' },
]

export function MultiSelectToolbar({
  count,
  onAlign,
  onDistribute,
  onDuplicate,
  onRecolor,
  onDelete,
  onClear,
}: MultiSelectToolbarProps) {
  const btn =
    'text-muted-foreground hover:bg-muted flex items-center rounded-md p-1.5 transition-colors'
  return (
    <div className='bg-card/95 absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border p-1 shadow-lg backdrop-blur-sm'>
      <span className='text-muted-foreground px-2 text-xs font-medium tabular-nums'>
        {count} selected
      </span>
      <div className='bg-border mx-0.5 h-5 w-px' />
      {ALIGN_BTNS.map(({ edge, Icon, title }) => (
        <button
          key={edge}
          type='button'
          onClick={() => onAlign(edge)}
          title={title}
          className={btn}
        >
          <Icon className='h-4 w-4' />
        </button>
      ))}
      <div className='bg-border mx-0.5 h-5 w-px' />
      <button
        type='button'
        onClick={() => onDistribute('x')}
        title='Distribute horizontally'
        className={btn}
      >
        <AlignHorizontalDistributeCenter className='h-4 w-4' />
      </button>
      <button
        type='button'
        onClick={() => onDistribute('z')}
        title='Distribute vertically'
        className={btn}
      >
        <AlignVerticalDistributeCenter className='h-4 w-4' />
      </button>
      <div className='bg-border mx-0.5 h-5 w-px' />
      <label className={btn} title='Recolor all'>
        <input
          type='color'
          onChange={(e) => onRecolor(e.target.value)}
          className='h-4 w-4 cursor-pointer border-0 bg-transparent p-0'
        />
      </label>
      <button
        type='button'
        onClick={onDuplicate}
        title='Duplicate all'
        className={btn}
      >
        <Copy className='h-4 w-4' />
      </button>
      <button
        type='button'
        onClick={onDelete}
        title='Delete all'
        className='flex items-center rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-50'
      >
        <Trash2 className='h-4 w-4' />
      </button>
      <div className='bg-border mx-0.5 h-5 w-px' />
      <button
        type='button'
        onClick={onClear}
        title='Clear selection'
        className={btn}
      >
        <X className='h-4 w-4' />
      </button>
    </div>
  )
}

// Created and developed by Jai Singh
