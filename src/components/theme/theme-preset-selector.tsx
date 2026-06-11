// Created and developed by Jai Singh
import { useMemo, useState } from 'react'
import { Check, Grid2x2, LayoutList, Search } from 'lucide-react'
import {
  PRESET_CATEGORIES,
  getAllPresets,
  getPresetsByCategory,
  type ThemePreset,
} from '@/lib/theme/presets'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface ThemePresetSelectorProps {
  activeColors?: Partial<{
    primary: string
    background: string
    foreground: string
    secondary: string
    accent: string
    border: string
    destructive: string
  }>
  onPresetApply?: (preset: ThemePreset) => void
  onPresetSelect?: (preset: ThemePreset) => void
  className?: string
}

export function ThemePresetSelector({
  activeColors,
  onPresetApply,
  onPresetSelect,
  className,
}: ThemePresetSelectorProps) {
  const { setCustomColors, setTheme, customColors } = useTheme()
  const [selectedCategory, setSelectedCategory] = useState<
    'all' | ThemePreset['category']
  >('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact')

  const displayPresets = useMemo(() => {
    const base =
      selectedCategory === 'all'
        ? getAllPresets()
        : getPresetsByCategory(selectedCategory as ThemePreset['category'])

    if (!searchQuery.trim()) return base

    const q = searchQuery.toLowerCase()
    return base.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    )
  }, [selectedCategory, searchQuery])

  const handlePresetClick = (preset: ThemePreset) => {
    if (onPresetApply) {
      onPresetApply(preset)
    } else {
      setCustomColors(preset.colors)
      setTheme('custom')
    }
    onPresetSelect?.(preset)
  }

  const isPresetActive = (preset: ThemePreset) => {
    const colors = activeColors ?? customColors
    return (
      colors.primary === preset.colors.primary &&
      colors.background === preset.colors.background &&
      colors.foreground === preset.colors.foreground &&
      colors.secondary === preset.colors.secondary &&
      colors.accent === preset.colors.accent &&
      colors.border === preset.colors.border &&
      colors.destructive === preset.colors.destructive
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className='flex items-center gap-3'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search presets...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>
        <div className='bg-muted flex rounded-md p-0.5'>
          <Button
            variant='ghost'
            size='icon'
            className={cn(
              'h-7 w-7',
              viewMode === 'compact' && 'bg-background shadow-sm'
            )}
            onClick={() => setViewMode('compact')}
          >
            <Grid2x2 className='h-3.5 w-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className={cn(
              'h-7 w-7',
              viewMode === 'detailed' && 'bg-background shadow-sm'
            )}
            onClick={() => setViewMode('detailed')}
          >
            <LayoutList className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>

      <div role='radiogroup' className='flex flex-wrap gap-1.5'>
        {PRESET_CATEGORIES.map((category) => (
          <button
            key={category.value}
            type='button'
            role='radio'
            aria-checked={selectedCategory === category.value}
            onClick={() =>
              setSelectedCategory(category.value as typeof selectedCategory)
            }
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-all',
              selectedCategory === category.value
                ? 'border-primary bg-primary/10 font-medium'
                : 'hover:bg-muted border-transparent'
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      {displayPresets.length === 0 && (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          No presets match your search.
        </div>
      )}

      {viewMode === 'compact' ? (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
          {displayPresets.map((preset) => {
            const isActive = isPresetActive(preset)
            return (
              <button
                key={preset.id}
                type='button'
                onClick={() => handlePresetClick(preset)}
                className={cn(
                  'group relative flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-all hover:shadow-md',
                  isActive
                    ? 'border-primary ring-primary/20 ring-2'
                    : 'hover:border-accent'
                )}
              >
                {isActive && (
                  <div className='bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 rounded-full p-0.5'>
                    <Check className='h-3 w-3' />
                  </div>
                )}
                <div
                  className='h-5 w-full rounded-sm'
                  style={{
                    background: preset.preview
                      ? `linear-gradient(to right, ${preset.preview.gradientFrom}, ${preset.preview.gradientTo})`
                      : preset.colors.primary,
                  }}
                />
                <div className='grid grid-cols-7 gap-px'>
                  {Object.values(preset.colors).map((color, i) => (
                    <div
                      key={i}
                      className='h-3 rounded-sm'
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className='flex items-center gap-1.5'>
                  <span className='text-sm'>{preset.emoji}</span>
                  <span className='truncate text-xs font-medium'>
                    {preset.name}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          {displayPresets.map((preset) => {
            const isActive = isPresetActive(preset)
            return (
              <Card
                key={preset.id}
                className={cn(
                  'relative cursor-pointer transition-all hover:shadow-md',
                  isActive && 'ring-primary ring-2 ring-offset-2'
                )}
                onClick={() => handlePresetClick(preset)}
              >
                {isActive && (
                  <div className='bg-primary text-primary-foreground absolute -top-2 -right-2 z-10 rounded-full p-1'>
                    <Check className='h-3.5 w-3.5' />
                  </div>
                )}
                <CardContent className='flex flex-col gap-2.5 p-3'>
                  <div className='flex items-start gap-2'>
                    <span className='mt-0.5 text-xl'>{preset.emoji}</span>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <h3 className='text-sm font-semibold'>{preset.name}</h3>
                        <Badge
                          variant='secondary'
                          className='h-4 px-1.5 py-0 text-[10px] capitalize'
                        >
                          {preset.category}
                        </Badge>
                      </div>
                      <p className='text-muted-foreground line-clamp-1 text-xs'>
                        {preset.description}
                      </p>
                    </div>
                  </div>
                  <div
                    className='h-5 rounded-md shadow-sm'
                    style={{
                      background: preset.preview
                        ? `linear-gradient(to right, ${preset.preview.gradientFrom}, ${preset.preview.gradientTo})`
                        : preset.colors.primary,
                    }}
                  />
                  <div className='grid grid-cols-7 gap-0.5'>
                    {Object.values(preset.colors).map((color, i) => (
                      <div
                        key={i}
                        className='border-border/50 h-4 rounded-sm border'
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className='text-muted-foreground text-center text-xs'>
        {displayPresets.length} preset{displayPresets.length !== 1 ? 's' : ''}{' '}
        available
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
