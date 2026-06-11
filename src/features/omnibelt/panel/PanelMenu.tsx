// Created and developed by Jai Singh
/**
 * OmniBelt — Panel header overflow menu
 *
 * Small dropdown housed in the panel's top-right corner. Surfaces
 * the controls that don't deserve a dedicated tile:
 *   - Skin picker (pill / orb / skystrip — all three enabled)
 *   - Hide toggle (writes `userHidden` on the store)
 *
 * Pin-to-corner lives on the pill's right-click menu — discoverable
 * via the footnote at the bottom of this menu rather than a separate
 * disabled item that confused users in the v1 rollout.
 *
 * Anchored via Radix `DropdownMenu` so collision logic + keyboard
 * navigation come free. Selecting a skin writes to the per-user
 * Zustand store; the host lazy-imports the matching chunk from
 * `SKIN_REGISTRY` and the morph plays via the shared
 * `layoutId='omnibelt-host'` on every skin's root motion node.
 *
 * Architecture note (2026-05-24 post-launch):
 *   The menu's content is split out as `<PanelMenuContent />` so the
 *   Compass Orb skin can mount the same skin picker under its own
 *   trigger button. Without this, picking the Orb skin trapped the
 *   user — the Orb suppresses the standard Panel (which is where the
 *   default trigger lives), so there was no UI path back to Pill or
 *   SkyStrip. See `Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker.md`.
 */
import {
  IconLayoutGrid,
  IconPalette,
  IconDotsVertical,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { OMNIBELT_OVERLAY_Z } from '../lib/overlays'
import { useOmnibeltStore, type Skin } from '../store/omnibeltStore'

type SkinOption = {
  value: Skin
  label: string
  subtitle: string
}

const SKIN_OPTIONS: ReadonlyArray<SkinOption> = [
  {
    value: 'pill',
    label: 'Pill (default)',
    subtitle: 'Default pill dock',
  },
  {
    value: 'orb',
    label: 'Orb',
    subtitle: 'Radial fan from corner orb',
  },
  {
    value: 'skystrip',
    label: 'Sky Strip',
    subtitle: 'Top-center status morph',
  },
]

/**
 * Body of the panel overflow menu — designed to be embedded inside
 * any `<DropdownMenuContent>` shell. Renders the skin radio group,
 * the visibility checkbox, and the pin-to-corner footnote without
 * any chrome of its own so the consumer controls width / alignment.
 *
 * Used by:
 *   - `<PanelMenu />` (this file) — the default trigger that sits in
 *     the standard `<OmniBeltPanel>` header.
 *   - `<OmniBeltOrb />`'s on-orb settings button — so users still
 *     have a path to the skin picker after switching to the Orb skin
 *     (which suppresses the standard Panel; see the Skin Architecture
 *     note in `OmniBeltHost.SKINS_USING_SHARED_PANEL`).
 *
 * The content reads / writes the same store fields the default
 * trigger does, so both entry points stay in sync automatically.
 */
export function PanelMenuContent() {
  const skin = useOmnibeltStore((s) => s.skin)
  const setSkin = useOmnibeltStore((s) => s.setSkin)
  const userHidden = useOmnibeltStore((s) => s.userHidden)
  const setUserHidden = useOmnibeltStore((s) => s.setUserHidden)

  return (
    <>
      <DropdownMenuLabel className='flex items-center gap-2 text-xs'>
        <IconPalette className='size-3.5' /> Skin
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={skin}
        onValueChange={(v) => setSkin(v as Skin)}
      >
        {SKIN_OPTIONS.map((opt) => (
          <DropdownMenuRadioItem
            key={opt.value}
            value={opt.value}
            data-testid={`omnibelt-skin-option-${opt.value}`}
            className='flex-col items-start gap-0.5'
          >
            <span className='text-sm leading-none font-medium'>
              {opt.label}
            </span>
            <span className='text-muted-foreground text-xs leading-none'>
              {opt.subtitle}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={userHidden}
          onCheckedChange={(c) => setUserHidden(Boolean(c))}
        >
          <IconLayoutGrid className='mr-2 size-3.5' />
          Hide OmniBelt
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className='text-muted-foreground text-[10px] leading-tight font-normal'>
        Pin to corner via right-click on the pill
      </DropdownMenuLabel>
    </>
  )
}

export function PanelMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label='OmniBelt panel options'
          data-testid='omnibelt-panel-menu-trigger'
          className='size-7'
        >
          <IconDotsVertical className='size-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className={`w-64 ${OMNIBELT_OVERLAY_Z}`}
        data-testid='omnibelt-panel-menu'
      >
        <PanelMenuContent />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Created and developed by Jai Singh
