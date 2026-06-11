// Created and developed by Jai Singh
/**
 * PanelMenu — skin picker + visibility checkbox contract (P7).
 *
 * Validates that selecting an alternate skin writes through to the
 * per-user Zustand store (which the host then uses to lazy-load the
 * matching skin chunk).
 *
 * `@/components/ui/dropdown-menu` is a thin wrapper over Radix's
 * `DropdownMenu` primitives. In jsdom Radix's pointer-event
 * activation is fragile (no full PointerEvent surface), and we don't
 * have `@testing-library/user-event` installed — so we stub the
 * dropdown components inline. Children render eagerly into the same
 * tree; clicks fire the same `onValueChange` / `onCheckedChange`
 * callbacks Radix would invoke at runtime.
 */
import * as React from 'react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { useOmnibeltStore, type Skin } from '../../store/omnibeltStore'
import { PanelMenu, PanelMenuContent } from '../PanelMenu'

vi.mock('../../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))

// Inline stubs that mirror just enough of the Radix surface for the
// menu's behavior to round-trip in jsdom. Each Radio item fires
// `onValueChange(value)` on the surrounding `RadioGroup`; each
// Checkbox item fires `onCheckedChange(next)` on itself. Same wiring
// the real components implement (verified in
// `src/components/ui/dropdown-menu.tsx`).
vi.mock('@/components/ui/dropdown-menu', () => {
  type Children = { children?: React.ReactNode }
  type WithClassName = Children & { className?: string }
  const RadioGroupContext = React.createContext<{
    value?: string
    onValueChange?: (next: string) => void
  } | null>(null)
  return {
    DropdownMenu: ({ children }: Children) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: Children & { asChild?: boolean }) => (
      <div data-testid='mock-dropdown-trigger'>{children}</div>
    ),
    DropdownMenuContent: ({ children }: WithClassName & { align?: string }) => (
      <div data-testid='mock-dropdown-content'>{children}</div>
    ),
    DropdownMenuLabel: ({ children, className }: WithClassName) => (
      <div className={className}>{children}</div>
    ),
    DropdownMenuRadioGroup: ({
      value,
      onValueChange,
      children,
    }: Children & { value?: string; onValueChange?: (v: string) => void }) => (
      <RadioGroupContext.Provider value={{ value, onValueChange }}>
        <div role='radiogroup'>{children}</div>
      </RadioGroupContext.Provider>
    ),
    DropdownMenuRadioItem: ({
      value,
      children,
      ...rest
    }: WithClassName & {
      value: string
      [key: string]: unknown
    }) => {
      const ctx = React.useContext(RadioGroupContext)
      return (
        <button
          type='button'
          {...rest}
          onClick={() => ctx?.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuGroup: ({ children }: Children) => <div>{children}</div>,
    DropdownMenuCheckboxItem: ({
      checked,
      onCheckedChange,
      children,
    }: Children & {
      checked?: boolean
      onCheckedChange?: (next: boolean) => void
    }) => (
      <button
        type='button'
        data-testid='mock-checkbox-item'
        aria-checked={checked ?? false}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {children}
      </button>
    ),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
    }: Children & {
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button type='button' disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
  }
})

function setup({
  skin = 'pill' as Skin,
  userHidden = false,
}: { skin?: Skin; userHidden?: boolean } = {}) {
  const setSkin = vi.fn()
  const setUserHidden = vi.fn()
  const bag = {
    skin,
    setSkin,
    userHidden,
    setUserHidden,
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
  return { setSkin, setUserHidden, bag }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('PanelMenu', () => {
  it('renders the trigger button', () => {
    setup()
    render(<PanelMenu />)
    expect(
      screen.getByRole('button', { name: /omnibelt panel options/i })
    ).toBeInTheDocument()
  })

  it('exposes all three skin options', () => {
    setup()
    render(<PanelMenu />)
    expect(screen.getByTestId('omnibelt-skin-option-pill')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-skin-option-orb')).toBeInTheDocument()
    expect(
      screen.getByTestId('omnibelt-skin-option-skystrip')
    ).toBeInTheDocument()
  })

  it('does NOT contain any "P7" placeholder text', () => {
    setup()
    render(<PanelMenu />)
    expect(screen.queryByText(/P7/i)).not.toBeInTheDocument()
  })

  it('selecting the Orb skin writes through to setSkin("orb")', () => {
    const { setSkin } = setup({ skin: 'pill' })
    render(<PanelMenu />)
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-orb'))
    expect(setSkin).toHaveBeenCalledWith('orb')
  })

  it('selecting the Sky Strip skin writes through to setSkin("skystrip")', () => {
    const { setSkin } = setup({ skin: 'pill' })
    render(<PanelMenu />)
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-skystrip'))
    expect(setSkin).toHaveBeenCalledWith('skystrip')
  })

  it('selecting the Pill skin writes through to setSkin("pill")', () => {
    const { setSkin } = setup({ skin: 'orb' })
    render(<PanelMenu />)
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-pill'))
    expect(setSkin).toHaveBeenCalledWith('pill')
  })

  it('renders descriptive subtitles for each skin option', () => {
    setup()
    render(<PanelMenu />)
    expect(screen.getByText(/default pill dock/i)).toBeInTheDocument()
    expect(screen.getByText(/radial fan from corner orb/i)).toBeInTheDocument()
    expect(screen.getByText(/top-center status morph/i)).toBeInTheDocument()
  })

  it('toggling the hide checkbox flips userHidden via the store', () => {
    const { setUserHidden } = setup({ userHidden: false })
    render(<PanelMenu />)
    fireEvent.click(screen.getByTestId('mock-checkbox-item'))
    expect(setUserHidden).toHaveBeenCalledWith(true)
  })
})

/**
 * `<PanelMenuContent />` is the body extracted from `<PanelMenu>` so
 * the Compass Orb skin can mount the same skin picker under its own
 * trigger button. Rendering it without the `<DropdownMenu>` wrapper
 * proves it has no hidden dependency on Radix's menu context — a
 * regression that would re-trap Orb users in their skin.
 *
 * The actual orb wiring is covered in `OmniBeltOrb.test.tsx`; these
 * tests just pin the standalone contract.
 */
describe('PanelMenuContent (standalone)', () => {
  it('renders the skin radio group without a DropdownMenu wrapper', () => {
    setup({ skin: 'orb' })
    render(<PanelMenuContent />)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-skin-option-pill')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-skin-option-orb')).toBeInTheDocument()
    expect(
      screen.getByTestId('omnibelt-skin-option-skystrip')
    ).toBeInTheDocument()
  })

  it('dispatches setSkin when a new skin is picked outside the panel context', () => {
    const { setSkin } = setup({ skin: 'orb' })
    render(<PanelMenuContent />)
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-pill'))
    expect(setSkin).toHaveBeenCalledWith('pill')
  })

  it('round-trips the hide checkbox without the wrapper menu', () => {
    const { setUserHidden } = setup({ userHidden: false })
    render(<PanelMenuContent />)
    fireEvent.click(screen.getByTestId('mock-checkbox-item'))
    expect(setUserHidden).toHaveBeenCalledWith(true)
  })
})

// Created and developed by Jai Singh
