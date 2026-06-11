// Created and developed by Jai Singh
import { Sparkles } from 'lucide-react'
import {
  SHADCN_BASE_COLORS,
  generateShadcnTheme,
  shadcnThemeToCustomColors,
  shadcnThemeToDualTokens,
  type ShadcnBaseColor,
} from '@/lib/theme/shadcn-color-generator'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-context'
import { Label } from '@/components/ui/label'

interface ShadcnBaseColorSelectorProps {
  activePalette?: 'light' | 'dark'
  onColorApply?: (result: {
    baseColor: ShadcnBaseColor
    palettes: ReturnType<typeof shadcnThemeToDualTokens>
  }) => void
  onColorSelect?: (baseColor: ShadcnBaseColor) => void
  className?: string
}

export function ShadcnBaseColorSelector({
  activePalette = 'light',
  onColorApply,
  onColorSelect,
  className,
}: ShadcnBaseColorSelectorProps) {
  const { setCustomColors, setTheme } = useTheme()

  const handleColorClick = (baseColor: ShadcnBaseColor) => {
    const generatedTheme = generateShadcnTheme(baseColor)
    const palettes = shadcnThemeToDualTokens(generatedTheme)

    if (onColorApply) {
      onColorApply({ baseColor, palettes })
    } else {
      const colors = shadcnThemeToCustomColors(generatedTheme, activePalette)
      setCustomColors(colors)
      setTheme('custom')
    }

    onColorSelect?.(baseColor)
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className='space-y-2'>
        <Label className='flex items-center gap-2 text-base'>
          <Sparkles className='text-primary h-4 w-4' />
          Pick a Base Color
        </Label>
        <p className='text-muted-foreground text-sm'>
          Choose a base color and we'll generate a complete theme automatically,
          following shadcn/ui's methodology.
        </p>
      </div>

      <div className='grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6'>
        {Object.entries(SHADCN_BASE_COLORS).map(([key, colorData]) => {
          const baseColor = key as ShadcnBaseColor

          return (
            <button
              key={key}
              type='button'
              className='group hover:border-accent flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 transition-all hover:shadow-md'
              onClick={() => handleColorClick(baseColor)}
            >
              <div
                className='h-10 w-10 rounded-full shadow-sm transition-transform group-hover:scale-110'
                style={{ backgroundColor: colorData.hex }}
              />
              <span className='text-xs font-medium'>{colorData.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
