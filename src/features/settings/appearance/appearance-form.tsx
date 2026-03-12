import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { fonts } from '@/config/fonts'
import {
  Check,
  ChevronDown,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_LIGHT_TOKENS,
  DEFAULT_DARK_TOKENS,
  RADIUS_VALUES,
  deriveDarkFromLight,
  deriveLightFromDark,
  getPaletteModeForBackground,
  normalizePresetToThemeTokens,
  radiusToCSS,
  type AppearancePreferencesV2,
  type ThemeMode,
  type CustomBehavior,
  type PaletteMode,
  type RadiusPreset,
  type ThemeTokens,
} from '@/lib/theme/appearance-preferences'
import { type ThemePreset } from '@/lib/theme/presets'
import { getAllPresets } from '@/lib/theme/presets'
import { cn } from '@/lib/utils'
import { useFont, FONT_FAMILY_MAP } from '@/context/font-context'
import { useTheme } from '@/context/theme-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ColorTokenField } from '@/components/theme/color-token-field'
import { ShadcnBaseColorSelector } from '@/components/theme/shadcn-base-color-selector'
import { ThemeImportExport } from '@/components/theme/theme-import-export'
import { ThemeLivePreview } from '@/components/theme/theme-live-preview'
import { ThemePresetSelector } from '@/components/theme/theme-preset-selector'

type EditorSection =
  | 'mode'
  | 'customBehavior'
  | 'coreColors'
  | 'advancedColors'
  | 'typography'
  | 'shape'

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function getPreferredEditPalette(
  prefs: AppearancePreferencesV2,
  fallback: PaletteMode
): PaletteMode {
  if (prefs.theme !== 'custom') return fallback
  if (prefs.customBehavior === 'light' || prefs.customBehavior === 'dark') {
    return prefs.customBehavior
  }
  return fallback
}

function buildPresetPalettes(preset: ThemePreset): {
  preferredSlot: PaletteMode
  light: ThemeTokens
  dark: ThemeTokens
} {
  const preferredSlot = getPaletteModeForBackground(preset.colors.background)
  if (preferredSlot === 'dark') {
    const dark = normalizePresetToThemeTokens(preset.colors, 'dark')
    return {
      preferredSlot,
      dark,
      light: deriveLightFromDark(dark),
    }
  }

  const light = normalizePresetToThemeTokens(preset.colors, 'light')
  return {
    preferredSlot,
    light,
    dark: deriveDarkFromLight(light),
  }
}

export function AppearanceForm() {
  const { activePalette, preferences, setPreferences } = useTheme()
  const { font, setFont } = useFont()

  const [draft, setDraft] = useState<AppearancePreferencesV2>(() => ({
    ...preferences,
    font,
  }))
  const [appliedSnapshot, setAppliedSnapshot] =
    useState<AppearancePreferencesV2>(() => ({ ...preferences, font }))
  const [editPalette, setEditPalette] = useState<'light' | 'dark'>(() =>
    getPreferredEditPalette({ ...preferences, font }, activePalette)
  )
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isDirty = !deepEqual(draft, appliedSnapshot)
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  useBlocker({
    shouldBlockFn: () => {
      if (!isDirtyRef.current) return false
      return !window.confirm('You have unsaved changes. Discard?')
    },
  })

  useEffect(() => {
    const snapshot = { ...preferences, font }
    if (deepEqual(snapshot, appliedSnapshot)) return

    if (isDirtyRef.current) {
      toast.info(
        'Appearance settings changed outside the editor. Local draft was refreshed.'
      )
    }

    setAppliedSnapshot(snapshot)
    setDraft(snapshot)
    setEditPalette(getPreferredEditPalette(snapshot, activePalette))
  }, [preferences, font, activePalette])

  const currentTokens = draft.customPalettes[editPalette]

  const updateToken = useCallback(
    (key: keyof ThemeTokens, value: string) => {
      setDraft((prev) => ({
        ...prev,
        customPalettes: {
          ...prev.customPalettes,
          [editPalette]: {
            ...prev.customPalettes[editPalette],
            [key]: value,
          },
        },
      }))
    },
    [editPalette]
  )

  const handleApply = () => {
    setPreferences(draft)
    if (draft.font !== font) setFont(draft.font)
    setAppliedSnapshot(draft)
    toast.success('Appearance preferences applied.')
  }

  const handleDiscard = () => {
    setDraft(appliedSnapshot)
    setEditPalette(getPreferredEditPalette(appliedSnapshot, activePalette))
    toast.info('Changes discarded.')
  }

  const handleResetSection = (section: EditorSection) => {
    setDraft((prev) => {
      const next = { ...prev }
      switch (section) {
        case 'mode':
          next.theme = DEFAULT_PREFERENCES.theme
          break
        case 'customBehavior':
          next.customBehavior = DEFAULT_PREFERENCES.customBehavior
          break
        case 'coreColors':
        case 'advancedColors':
          next.customPalettes = {
            ...next.customPalettes,
            [editPalette]:
              editPalette === 'dark'
                ? DEFAULT_DARK_TOKENS
                : DEFAULT_LIGHT_TOKENS,
          }
          break
        case 'typography':
          next.font = DEFAULT_PREFERENCES.font
          break
        case 'shape':
          next.radius = DEFAULT_PREFERENCES.radius
          break
      }
      return next
    })
  }

  const handleResetAll = () => {
    setDraft({ ...DEFAULT_PREFERENCES })
    setEditPalette('light')
    toast.info('All settings reset to defaults.')
  }

  const handlePresetApply = (preset: ThemePreset) => {
    const palettes = buildPresetPalettes(preset)
    setEditPalette(palettes.preferredSlot)
    setDraft((prev) => ({
      ...prev,
      theme: 'custom',
      customBehavior: palettes.preferredSlot,
      customPalettes: {
        light: palettes.light,
        dark: palettes.dark,
      },
    }))
  }

  const handleBaseColorApply = (result: {
    baseColor: string
    palettes: { light: ThemeTokens; dark: ThemeTokens }
  }) => {
    setDraft((prev) => ({
      ...prev,
      theme: 'custom',
      customPalettes: {
        light: result.palettes.light,
        dark: result.palettes.dark,
      },
    }))
  }

  const themeModes: {
    value: ThemeMode
    label: string
    icon: typeof Sun
    desc: string
  }[] = [
    {
      value: 'light',
      label: 'Light',
      icon: Sun,
      desc: 'Light background with dark text',
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: Moon,
      desc: 'Dark background with light text',
    },
    {
      value: 'system',
      label: 'System',
      icon: Sun,
      desc: 'Follow your OS preference',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: Palette,
      desc: 'Create your own color scheme',
    },
  ]

  return (
    <div className='flex gap-8'>
      <div className='min-w-0 flex-1 space-y-6'>
        {/* Sticky Toolbar -- always rendered to reserve space and avoid layout shift */}
        <div
          className={cn(
            'bg-background/95 sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border p-3 shadow-sm backdrop-blur transition-all',
            isDirty
              ? 'opacity-100'
              : 'pointer-events-none h-0 overflow-hidden border-0 p-0 opacity-0'
          )}
        >
          <p className='text-muted-foreground text-sm'>
            You have unsaved changes
          </p>
          <div className='flex gap-2'>
            <Button variant='ghost' size='sm' onClick={handleDiscard}>
              <Undo2 className='mr-1.5 h-3.5 w-3.5' />
              Discard
            </Button>
            <Button size='sm' onClick={handleApply}>
              <Save className='mr-1.5 h-3.5 w-3.5' />
              Apply
            </Button>
          </div>
        </div>

        {/* Theme Mode */}
        <SectionCard
          title='Theme Mode'
          description='Choose how the application looks'
          onReset={() => handleResetSection('mode')}
        >
          <div
            role='radiogroup'
            className='grid grid-cols-2 gap-3 sm:grid-cols-4'
          >
            {themeModes.map(({ value, label, icon: Icon, desc }) => (
              <button
                key={value}
                type='button'
                role='radio'
                aria-checked={draft.theme === value}
                onClick={() => {
                  setDraft((prev) => ({ ...prev, theme: value }))
                  if (value === 'custom') {
                    setEditPalette(
                      getPreferredEditPalette(draft, activePalette)
                    )
                  }
                }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-all hover:shadow-sm',
                  draft.theme === value
                    ? 'border-primary bg-primary/5'
                    : 'border-muted hover:border-accent'
                )}
              >
                <Icon className='h-5 w-5' />
                <span className='text-sm font-medium'>{label}</span>
                <span className='text-muted-foreground text-[11px] leading-tight'>
                  {desc}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Custom Theme Sections */}
        {draft.theme === 'custom' && (
          <>
            {/* Custom Behavior */}
            <SectionCard
              title='Custom Theme Behavior'
              description='How should the custom theme behave at runtime?'
              onReset={() => handleResetSection('customBehavior')}
            >
              <div role='radiogroup' className='flex flex-wrap gap-3'>
                {[
                  {
                    value: 'follow-system' as CustomBehavior,
                    label: 'Follow System',
                    desc: 'Switch automatically',
                  },
                  {
                    value: 'light' as CustomBehavior,
                    label: 'Always Light',
                    desc: 'Force light mode',
                  },
                  {
                    value: 'dark' as CustomBehavior,
                    label: 'Always Dark',
                    desc: 'Force dark mode',
                  },
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type='button'
                    role='radio'
                    aria-checked={draft.customBehavior === value}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        customBehavior: value,
                      }))
                    }
                    className={cn(
                      'flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all',
                      draft.customBehavior === value
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-accent'
                    )}
                  >
                    <div>
                      <span className='text-sm font-medium'>{label}</span>
                      <span className='text-muted-foreground ml-2 text-xs'>
                        {desc}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Edit Palette Toggle */}
            <div className='flex items-center gap-3'>
              <span className='text-sm font-medium'>Editing palette:</span>
              <div className='bg-muted inline-flex rounded-lg p-1'>
                <button
                  type='button'
                  onClick={() => setEditPalette('light')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-all',
                    editPalette === 'light'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Sun className='h-3.5 w-3.5' />
                  Light
                </button>
                <button
                  type='button'
                  onClick={() => setEditPalette('dark')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-all',
                    editPalette === 'dark'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Moon className='h-3.5 w-3.5' />
                  Dark
                </button>
              </div>
            </div>

            {/* Theme Builder */}
            <Card>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <div className='space-y-1'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <Sparkles className='text-primary h-4 w-4' />
                      Theme Builder
                    </CardTitle>
                    <CardDescription>
                      Generate themes from base colors or presets
                    </CardDescription>
                  </div>
                  <Badge variant='secondary' className='gap-1'>
                    <Palette className='h-3 w-3' />
                    {getAllPresets().length} Options
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue='shadcn' className='space-y-4'>
                  <TabsList className='grid w-full grid-cols-2'>
                    <TabsTrigger value='shadcn' className='gap-2'>
                      <Sparkles className='h-3.5 w-3.5' />
                      Base Colors
                    </TabsTrigger>
                    <TabsTrigger value='presets' className='gap-2'>
                      <Palette className='h-3.5 w-3.5' />
                      Presets
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value='shadcn' className='mt-4'>
                    <ShadcnBaseColorSelector
                      activePalette={editPalette}
                      onColorApply={handleBaseColorApply}
                    />
                  </TabsContent>
                  <TabsContent value='presets' className='mt-4'>
                    <ThemePresetSelector
                      activeColors={currentTokens}
                      onPresetApply={handlePresetApply}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Core Colors */}
            <SectionCard
              title='Core Colors'
              description='Primary, background, and text colors'
              onReset={() => handleResetSection('coreColors')}
            >
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <ColorTokenField
                  label='Primary'
                  value={currentTokens.primary}
                  onChange={(v) => updateToken('primary', v)}
                />
                <ColorTokenField
                  label='Background'
                  value={currentTokens.background}
                  onChange={(v) => updateToken('background', v)}
                />
                <ColorTokenField
                  label='Foreground'
                  value={currentTokens.foreground}
                  onChange={(v) => updateToken('foreground', v)}
                  contrastAgainst={currentTokens.background}
                />
                <ColorTokenField
                  label='Card'
                  value={currentTokens.card}
                  onChange={(v) => updateToken('card', v)}
                />
                <ColorTokenField
                  label='Destructive'
                  value={currentTokens.destructive}
                  onChange={(v) => updateToken('destructive', v)}
                />
              </div>
            </SectionCard>

            {/* Advanced Colors */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <Card>
                <CardHeader>
                  <CollapsibleTrigger className='flex w-full items-center justify-between'>
                    <div className='space-y-1 text-left'>
                      <CardTitle className='text-base'>
                        Advanced Colors
                      </CardTitle>
                      <CardDescription>
                        Secondary, accent, border, ring, and chart colors
                      </CardDescription>
                    </div>
                    <ChevronDown
                      className={cn(
                        'text-muted-foreground h-5 w-5 transition-transform',
                        showAdvanced && 'rotate-180'
                      )}
                    />
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className='space-y-4 pt-0'>
                    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                      <ColorTokenField
                        label='Secondary'
                        value={currentTokens.secondary}
                        onChange={(v) => updateToken('secondary', v)}
                      />
                      <ColorTokenField
                        label='Accent'
                        value={currentTokens.accent}
                        onChange={(v) => updateToken('accent', v)}
                      />
                      <ColorTokenField
                        label='Muted'
                        value={currentTokens.muted}
                        onChange={(v) => updateToken('muted', v)}
                      />
                      <ColorTokenField
                        label='Border'
                        value={currentTokens.border}
                        onChange={(v) => updateToken('border', v)}
                      />
                      <ColorTokenField
                        label='Ring'
                        value={currentTokens.ring}
                        onChange={(v) => updateToken('ring', v)}
                      />
                    </div>
                    <Separator />
                    <Label className='text-sm font-medium'>Chart Colors</Label>
                    <div className='grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5'>
                      {([1, 2, 3, 4, 5] as const).map((n) => {
                        const key = `chart${n}` as keyof ThemeTokens
                        return (
                          <ColorTokenField
                            key={key}
                            label={`Chart ${n}`}
                            value={currentTokens[key]}
                            onChange={(v) => updateToken(key, v)}
                          />
                        )
                      })}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </>
        )}

        {/* Typography */}
        <SectionCard
          title='Typography'
          description='Choose the font for the interface'
          onReset={() => handleResetSection('typography')}
        >
          <div role='radiogroup' className='flex flex-wrap gap-3'>
            {fonts.map((f) => (
              <button
                key={f}
                type='button'
                role='radio'
                aria-checked={draft.font === f}
                onClick={() => setDraft((prev) => ({ ...prev, font: f }))}
                className={cn(
                  'flex items-center gap-2 rounded-lg border-2 px-4 py-3 capitalize transition-all',
                  draft.font === f
                    ? 'border-primary bg-primary/5'
                    : 'border-muted hover:border-accent'
                )}
                style={{ fontFamily: FONT_FAMILY_MAP[f] }}
              >
                <span className='text-sm font-medium'>{f}</span>
                {draft.font === f && <Check className='h-3.5 w-3.5' />}
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Shape */}
        <SectionCard
          title='Border Radius'
          description='Control the roundness of UI elements'
          onReset={() => handleResetSection('shape')}
        >
          <div role='radiogroup' className='flex flex-wrap gap-3'>
            {(Object.entries(RADIUS_VALUES) as [RadiusPreset, string][]).map(
              ([preset, value]) => (
                <button
                  key={preset}
                  type='button'
                  role='radio'
                  aria-checked={draft.radius === preset}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, radius: preset }))
                  }
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border-2 px-5 py-3 transition-all',
                    draft.radius === preset
                      ? 'border-primary bg-primary/5'
                      : 'border-muted hover:border-accent'
                  )}
                >
                  <div
                    className='bg-primary h-8 w-8'
                    style={{ borderRadius: value }}
                  />
                  <span className='text-xs font-medium capitalize'>
                    {preset}
                  </span>
                </button>
              )
            )}
          </div>
        </SectionCard>

        {/* Import / Export */}
        <ThemeImportExport
          currentPrefs={draft}
          onImport={(prefs) => {
            setDraft(prefs)
            setEditPalette(getPreferredEditPalette(prefs, activePalette))
          }}
        />

        {/* Bottom Actions */}
        <div className='flex flex-wrap gap-3 pb-8'>
          <Button onClick={handleApply} disabled={!isDirty}>
            <Save className='mr-1.5 h-4 w-4' />
            Apply Changes
          </Button>
          <Button variant='outline' onClick={handleDiscard} disabled={!isDirty}>
            <Undo2 className='mr-1.5 h-4 w-4' />
            Discard
          </Button>
          <Button variant='ghost' onClick={handleResetAll}>
            <RotateCcw className='mr-1.5 h-4 w-4' />
            Reset All to Defaults
          </Button>
        </div>
      </div>

      {/* Live Preview - sticky sidebar on xl screens */}
      <div className='hidden w-80 shrink-0 xl:block'>
        <div className='sticky top-0'>
          <ThemeLivePreview
            tokens={currentTokens}
            mode={editPalette}
            font={FONT_FAMILY_MAP[draft.font]}
            radius={radiusToCSS(draft.radius)}
            className='max-h-[calc(100vh-12rem)] overflow-y-auto'
          />
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  description,
  onReset,
  children,
}: {
  title: string
  description: string
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div className='space-y-1'>
            <CardTitle className='text-base'>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {onReset && (
            <Button variant='ghost' size='sm' onClick={onReset}>
              <RotateCcw className='mr-1 h-3 w-3' />
              Reset
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
