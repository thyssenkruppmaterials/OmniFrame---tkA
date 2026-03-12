/**
 * Properties Panel Component
 * Item configuration panel for the template builder
 */
import { useEffect, useState } from 'react'
import { X, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ITEM_TYPE_CONFIG, type ItemType } from './types'

interface PropertiesPanelProps {
  item: StandardWorkItem | null
  onItemChange: (item: StandardWorkItem) => void
  onClose: () => void
  className?: string
}

export function PropertiesPanel({
  item,
  onItemChange,
  onClose,
  className,
}: PropertiesPanelProps) {
  const [localItem, setLocalItem] = useState<StandardWorkItem | null>(null)
  const [optionsText, setOptionsText] = useState('')

  useEffect(() => {
    if (item) {
      setLocalItem({ ...item })
      setOptionsText(item.options?.map((o) => o.label).join('\n') || '')
    } else {
      setLocalItem(null)
      setOptionsText('')
    }
  }, [item])

  const handleChange = <K extends keyof StandardWorkItem>(
    field: K,
    value: StandardWorkItem[K]
  ) => {
    if (!localItem) return
    const updated = { ...localItem, [field]: value }
    setLocalItem(updated)
    onItemChange(updated)
  }

  const handleOptionsChange = (text: string) => {
    setOptionsText(text)
    const options = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => ({
        value: line.trim().toLowerCase().replace(/\s+/g, '_'),
        label: line.trim(),
      }))
    handleChange('options', options)
  }

  const handleValidationChange = (field: string, value: number | undefined) => {
    if (!localItem) return
    const updated = {
      ...localItem,
      validation_rules: {
        ...localItem.validation_rules,
        [field]: value,
      },
    }
    setLocalItem(updated)
    onItemChange(updated)
  }

  if (!localItem) {
    return (
      <div
        className={cn(
          'text-muted-foreground flex h-full flex-col items-center justify-center',
          className
        )}
      >
        <Settings2 className='mb-2 h-8 w-8 opacity-50' />
        <p className='text-sm'>Select an item to edit</p>
        <p className='mt-1 text-xs'>Click on any item in the canvas</p>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-muted-foreground text-sm font-semibold tracking-wider uppercase'>
          Item Properties
        </h3>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6'
          onClick={onClose}
        >
          <X className='h-4 w-4' />
        </Button>
      </div>

      <ScrollArea className='-mr-4 flex-1 pr-4'>
        <div className='space-y-6'>
          {/* Basic Info */}
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='item_title'>Title *</Label>
              <Input
                id='item_title'
                value={localItem.item_title}
                onChange={(e) => handleChange('item_title', e.target.value)}
                placeholder='Item title...'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='item_description'>Description</Label>
              <Textarea
                id='item_description'
                value={localItem.item_description || ''}
                onChange={(e) =>
                  handleChange('item_description', e.target.value)
                }
                placeholder='Additional details...'
                rows={2}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='item_type'>Type</Label>
              <Select
                value={localItem.item_type}
                onValueChange={(value) =>
                  handleChange('item_type', value as ItemType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ITEM_TYPE_CONFIG).map(([type, config]) => (
                    <SelectItem key={type} value={type}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Type-specific Options */}
          {(localItem.item_type === 'select' ||
            localItem.item_type === 'multi_select') && (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='options'>Options (one per line)</Label>
                <Textarea
                  id='options'
                  value={optionsText}
                  onChange={(e) => handleOptionsChange(e.target.value)}
                  placeholder='Option 1&#10;Option 2&#10;Option 3'
                  rows={4}
                />
              </div>
            </div>
          )}

          {localItem.item_type === 'number' && (
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label htmlFor='min'>Min Value</Label>
                  <Input
                    id='min'
                    type='number'
                    value={
                      (localItem.validation_rules?.min as number | undefined) ??
                      ''
                    }
                    onChange={(e) =>
                      handleValidationChange(
                        'min',
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )
                    }
                    placeholder='No min'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='max'>Max Value</Label>
                  <Input
                    id='max'
                    type='number'
                    value={
                      (localItem.validation_rules?.max as number | undefined) ??
                      ''
                    }
                    onChange={(e) =>
                      handleValidationChange(
                        'max',
                        e.target.value ? parseFloat(e.target.value) : undefined
                      )
                    }
                    placeholder='No max'
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Help & Placeholder */}
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='help_text'>Help Text</Label>
              <Input
                id='help_text'
                value={localItem.help_text || ''}
                onChange={(e) => handleChange('help_text', e.target.value)}
                placeholder='Additional guidance...'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='placeholder'>Placeholder</Label>
              <Input
                id='placeholder'
                value={localItem.placeholder || ''}
                onChange={(e) => handleChange('placeholder', e.target.value)}
                placeholder='Input placeholder...'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='default_value'>Default Value</Label>
              <Input
                id='default_value'
                value={localItem.default_value || ''}
                onChange={(e) => handleChange('default_value', e.target.value)}
                placeholder='Default value...'
              />
            </div>
          </div>

          <Separator />

          {/* Settings */}
          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor='is_required'>Required</Label>
                <p className='text-muted-foreground text-xs'>
                  Must be completed before submission
                </p>
              </div>
              <Switch
                id='is_required'
                checked={localItem.is_required}
                onCheckedChange={(checked) =>
                  handleChange('is_required', checked)
                }
              />
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
