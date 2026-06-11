// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// ViewWidgets — DOM scale bar + compass, fed by view-info.store.
// ---------------------------------------------------------------------------
import { useMemo } from 'react'
import { useViewInfo } from './view-info.store'

const NICE_METERS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

export function ScaleBar() {
  const mpp = useViewInfo((s) => s.metersPerPixel)
  const { widthPx, label } = useMemo(() => {
    if (!mpp || !isFinite(mpp)) return { widthPx: 0, label: '' }
    let meters = NICE_METERS[0]
    for (const n of NICE_METERS) if (n / mpp <= 140) meters = n
    return {
      widthPx: Math.round(meters / mpp),
      label: meters >= 1 ? `${meters} m` : `${Math.round(meters * 100)} cm`,
    }
  }, [mpp])

  if (widthPx <= 0) return null
  return (
    <div
      className='bg-card/85 flex flex-col items-center gap-0.5 rounded-md border px-2 py-1 shadow-sm backdrop-blur-sm'
      role='img'
      aria-label={`Scale: ${label}`}
    >
      <div
        className='border-foreground/70 h-1.5 border-r border-b border-l'
        style={{ width: widthPx }}
      />
      <span className='text-muted-foreground text-[10px] tabular-nums'>
        {label}
      </span>
    </div>
  )
}

export function Compass() {
  const north = useViewInfo((s) => s.northDeg)
  return (
    <div
      className='bg-card/85 relative h-9 w-9 rounded-full border shadow-sm backdrop-blur-sm'
      title='Compass (N = top of plan)'
      role='img'
      aria-label='Compass'
    >
      <div
        className='absolute inset-0'
        style={{ transform: `rotate(${north}deg)` }}
      >
        <span className='absolute top-0.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-500'>
          N
        </span>
        <span className='bg-foreground/60 absolute top-1 left-1/2 h-2.5 w-px -translate-x-1/2' />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
