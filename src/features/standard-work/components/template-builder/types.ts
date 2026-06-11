// Created and developed by Jai Singh
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
  | 'photo'
  | 'signature'

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
    description: 'Yes / No completion item',
    icon: 'Check',
    defaultTitle: 'New Checkbox Item',
  },
  text: {
    label: 'Text Input',
    description: 'Free-text response',
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
  photo: {
    label: 'Photo',
    description: 'Capture or upload an image',
    icon: 'Camera',
    defaultTitle: 'New Photo Item',
  },
  signature: {
    label: 'Signature',
    description: 'Capture an inline signature',
    icon: 'PenTool',
    defaultTitle: 'New Signature Item',
  },
}

/** Convenience: item types that store their value as a JSON array string. */
export const ARRAY_VALUE_ITEM_TYPES: ItemType[] = ['multi_select']

/** Convenience: item types whose response lives in `file_url` rather than `response_value`. */
export const FILE_VALUE_ITEM_TYPES: ItemType[] = ['photo', 'signature']

/** Stable section ID generator -- avoids collisions when two sections slug
 * to the same string (e.g. "Pre-Op" and "Pre Op"). */
export function generateSectionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `section-${crypto.randomUUID()}`
  }
  return `section-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Created and developed by Jai Singh
