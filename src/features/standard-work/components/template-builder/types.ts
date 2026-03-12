/**
 * Template Builder Types
 */
import type { StandardWorkItem } from '@/hooks/use-standard-work'

export type ItemType =
  | 'checkbox'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'time'

export interface DragItem {
  id: string
  type: 'palette-item' | 'canvas-item'
  itemType?: ItemType
  data?: Partial<StandardWorkItem>
}

export interface Section {
  id: string
  name: string
  items: StandardWorkItem[]
  isCollapsed?: boolean
}

export interface BuilderState {
  sections: Section[]
  selectedItemId: string | null
  isDragging: boolean
  previewMode: boolean
}

export const ITEM_TYPE_CONFIG: Record<
  ItemType,
  {
    label: string
    description: string
    icon: string
    defaultTitle: string
  }
> = {
  checkbox: {
    label: 'Checkbox',
    description: 'Yes/No completion item',
    icon: 'Check',
    defaultTitle: 'New Checkbox Item',
  },
  text: {
    label: 'Text Input',
    description: 'Free text response',
    icon: 'Type',
    defaultTitle: 'New Text Item',
  },
  number: {
    label: 'Number',
    description: 'Numeric value input',
    icon: 'Hash',
    defaultTitle: 'New Number Item',
  },
  select: {
    label: 'Dropdown',
    description: 'Single selection from options',
    icon: 'List',
    defaultTitle: 'New Dropdown Item',
  },
  multi_select: {
    label: 'Multi-Select',
    description: 'Multiple selections from options',
    icon: 'ListChecks',
    defaultTitle: 'New Multi-Select Item',
  },
  date: {
    label: 'Date',
    description: 'Date picker',
    icon: 'Calendar',
    defaultTitle: 'New Date Item',
  },
  time: {
    label: 'Time',
    description: 'Time picker',
    icon: 'Clock',
    defaultTitle: 'New Time Item',
  },
}
