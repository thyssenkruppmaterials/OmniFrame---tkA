// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// LayersPanel — show/hide layers to declutter complex layouts.
// ---------------------------------------------------------------------------
// Toggles structural groups (racks/zones/aisles/assets/grid/weather) and each
// scene-object category. Hidden layers are filtered out of the 3D render.
import { Eye, EyeOff, Layers, X } from 'lucide-react'

const SCENE_LAYERS: { key: string; label: string }[] = [
  { key: 'racks', label: 'Racks' },
  { key: 'zones', label: 'Zones' },
  { key: 'rooms', label: 'Rooms & Offices' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'vehicles', label: 'Vehicles & Fleet' },
  { key: 'storage', label: 'Storage' },
  { key: 'structure', label: 'Structure' },
  { key: 'decor', label: 'Decor' },
  { key: 'aisles', label: 'Aisles' },
  { key: 'assets', label: 'Live assets' },
  { key: 'grid', label: 'Floor grid' },
  { key: 'weather', label: 'Weather' },
]

interface LayersPanelProps {
  hiddenLayers: Record<string, boolean>
  onToggleLayer: (key: string) => void
  onClose: () => void
}

export function LayersPanel({
  hiddenLayers,
  onToggleLayer,
  onClose,
}: LayersPanelProps) {
  return (
    <div className='bg-card/95 absolute top-16 left-4 z-10 flex max-h-[calc(100%-7rem)] w-56 flex-col rounded-lg border shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between border-b px-3 py-2'>
        <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
          <Layers className='h-4 w-4' /> Layers
        </h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close layers'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>
      <div className='flex-1 overflow-y-auto p-1.5'>
        {SCENE_LAYERS.map(({ key, label }) => {
          const hidden = !!hiddenLayers[key]
          return (
            <button
              key={key}
              type='button'
              onClick={() => onToggleLayer(key)}
              aria-pressed={!hidden}
              className='hover:bg-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors'
            >
              <span
                className={
                  hidden
                    ? 'text-muted-foreground line-through'
                    : 'text-foreground'
                }
              >
                {label}
              </span>
              {hidden ? (
                <EyeOff className='text-muted-foreground h-3.5 w-3.5' />
              ) : (
                <Eye className='h-3.5 w-3.5' />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
