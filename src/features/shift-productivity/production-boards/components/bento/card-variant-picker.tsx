// Created and developed by Jai Singh
/**
 * Variant picker mounted inside the post composer's Details tab.
 *
 * A radio-group of 5 small visual previews. The active variant
 * controls both `card_variant` and `variant_config` (via the
 * conditional rotate-interval slider for `gallery`).
 *
 * The composer's persistence layer carries these two fields through
 * to `production_board_card_layouts` via a sibling upsert path —
 * the picker doesn't talk to the DB itself.
 */
import {
  IconLayoutCards,
  IconLayoutColumns,
  IconLayoutGrid,
  IconLayoutList,
  IconQuote,
  type Icon,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
  CARD_VARIANTS,
  GALLERY_DEFAULT_INTERVAL_S,
  GALLERY_MAX_INTERVAL_S,
  GALLERY_MIN_INTERVAL_S,
  VARIANT_DESCRIPTION,
  VARIANT_LABEL,
  type CardVariant,
  type GalleryVariantConfig,
  type VariantConfig,
} from './card-variant'

const VARIANT_ICON: Record<CardVariant, Icon> = {
  classic: IconLayoutCards,
  banner: IconLayoutList,
  gallery: IconLayoutGrid,
  spotlight: IconLayoutColumns,
  quote: IconQuote,
}

export interface BoardCardVariantPickerProps {
  value: CardVariant
  onChange: (next: CardVariant) => void
  config: VariantConfig
  onConfigChange: (next: VariantConfig) => void
  /** Hides the picker entirely. Used by the composer for kinds we don't */
  /** want to expose variants on (none today — all four kinds support all */
  /** five variants — but the prop keeps the door open). */
  hidden?: boolean
  disabled?: boolean
}

export function BoardCardVariantPicker({
  value,
  onChange,
  config,
  onConfigChange,
  hidden,
  disabled,
}: BoardCardVariantPickerProps) {
  if (hidden) return null

  const galleryConfig = config as GalleryVariantConfig
  const interval =
    galleryConfig.rotate_interval_seconds ?? GALLERY_DEFAULT_INTERVAL_S

  return (
    <div className='flex flex-col gap-3'>
      <div
        role='radiogroup'
        aria-label='Card layout variant'
        className='grid grid-cols-2 gap-2 sm:grid-cols-5'
      >
        {CARD_VARIANTS.map((variant) => {
          const Icon = VARIANT_ICON[variant]
          const active = variant === value
          return (
            <button
              key={variant}
              type='button'
              role='radio'
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(variant)}
              className={cn(
                'group flex flex-col items-start gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border/60 bg-background hover:border-border/80 hover:bg-muted/40',
                disabled && 'cursor-not-allowed opacity-60'
              )}
              data-variant={variant}
              data-active={active ? 'true' : 'false'}
            >
              <VariantPreview variant={variant} active={active} />
              <span className='flex items-center gap-1.5 text-xs font-medium'>
                <Icon className='h-3.5 w-3.5' aria-hidden />
                {VARIANT_LABEL[variant]}
              </span>
            </button>
          )
        })}
      </div>
      <p className='text-muted-foreground text-xs'>
        {VARIANT_DESCRIPTION[value]}
      </p>

      {value === 'gallery' && (
        <div className='border-border/40 bg-background flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
          <div className='flex flex-col'>
            <Label htmlFor='gallery-interval' className='mt-0!'>
              Slide interval
            </Label>
            <p className='text-muted-foreground text-xs'>
              Seconds each image stays visible before crossfading.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <input
              id='gallery-interval'
              type='range'
              min={GALLERY_MIN_INTERVAL_S}
              max={GALLERY_MAX_INTERVAL_S}
              step={1}
              value={interval}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n))
                  onConfigChange({
                    rotate_interval_seconds: Math.max(
                      GALLERY_MIN_INTERVAL_S,
                      Math.min(GALLERY_MAX_INTERVAL_S, Math.round(n))
                    ),
                  })
              }}
              disabled={disabled}
              className='accent-primary h-1.5 w-40'
              aria-label='Slide interval seconds'
            />
            <span className='text-foreground/90 w-10 text-right text-sm tabular-nums'>
              {interval}s
            </span>
          </div>
        </div>
      )}

      {value === 'banner' && (
        <BannerCoverPositionRow
          value={(config as { cover_position?: string }).cover_position}
          onChange={(pos) => onConfigChange({ cover_position: pos })}
          disabled={disabled}
        />
      )}
    </div>
  )
}

function BannerCoverPositionRow({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined
  onChange: (pos: 'top' | 'center' | 'bottom') => void
  disabled?: boolean
}) {
  const options: { id: 'top' | 'center' | 'bottom'; label: string }[] = [
    { id: 'top', label: 'Top' },
    { id: 'center', label: 'Center' },
    { id: 'bottom', label: 'Bottom' },
  ]
  const active = value === 'top' || value === 'bottom' ? value : 'center'
  return (
    <div className='border-border/40 bg-background flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
      <div className='flex flex-col'>
        <Label className='mt-0!'>Cover focus</Label>
        <p className='text-muted-foreground text-xs'>
          Which third of the image to anchor when cropping.
        </p>
      </div>
      <div className='flex items-center gap-1'>
        {options.map((opt) => (
          <button
            key={opt.id}
            type='button'
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              active === opt.id
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border/50 bg-background text-muted-foreground hover:text-foreground'
            )}
            data-active={active === opt.id ? 'true' : 'false'}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Tiny visual sketch of each variant for the picker. */
function VariantPreview({
  variant,
}: {
  variant: CardVariant
  active: boolean
}) {
  const base =
    'flex h-12 w-full overflow-hidden rounded-sm border border-border/40 bg-muted/30'
  switch (variant) {
    case 'classic':
      return (
        <div className={base}>
          <span className='w-1 bg-sky-500/80' />
          <div className='flex flex-1 flex-col gap-0.5 p-1.5'>
            <span className='bg-foreground/60 h-1.5 w-2/3 rounded' />
            <span className='bg-foreground/30 h-1 w-full rounded' />
            <span className='bg-foreground/30 h-1 w-3/4 rounded' />
          </div>
        </div>
      )
    case 'banner':
      return (
        <div
          className={cn(
            base,
            'flex-col bg-linear-to-br from-amber-500/40 to-rose-500/40'
          )}
        >
          <span className='mt-auto block h-2.5 w-2/3 rounded bg-white/80' />
          <span className='mt-0.5 mb-1.5 ml-1.5 block h-1 w-1/2 rounded bg-white/60' />
        </div>
      )
    case 'gallery':
      return (
        <div className={cn(base, 'grid grid-cols-3 grid-rows-2 gap-px')}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'bg-foreground/20',
                i % 3 === 0 && 'bg-emerald-500/30',
                i % 5 === 0 && 'bg-sky-500/30'
              )}
            />
          ))}
        </div>
      )
    case 'spotlight':
      return (
        <div className={cn(base, 'flex-row gap-1.5 p-1.5')}>
          <span className='h-full w-6 rounded-md bg-amber-500/40' />
          <div className='flex flex-1 flex-col gap-0.5'>
            <span className='bg-foreground/60 h-1.5 w-2/3 rounded' />
            <span className='bg-foreground/30 h-1 w-full rounded' />
            <span className='mt-1 h-2 w-1/2 rounded bg-amber-500/40' />
          </div>
        </div>
      )
    case 'quote':
      return (
        <div className={cn(base, 'items-center justify-center p-1.5')}>
          <span className='text-foreground/40 font-serif text-2xl italic'>
            “”
          </span>
        </div>
      )
  }
}

// Created and developed by Jai Singh
