// Created and developed by Jai Singh
/**
 * OmniBelt — Inventory Lookup shell (P4 stub)
 *
 * The full search-by-bin / search-by-part lookup lives inside the
 * SAP Testing dashboard's LX03 surface (`/admin/sap-testing`,
 * Inventory Management tab). Lifting that whole flow into a small
 * panel shell would mean re-implementing the agent/fleet routing,
 * permission gates, result virtualisation, and the LX03 RFC client
 * — too coupled for v1. The shell ships as a minimal form that
 * deep-links the user to the existing surface with their query
 * pre-populated when possible. Documented as a P4 deviation in
 * the implementation log; full integration tracked for v1.5+.
 *
 * The form remains useful today because it gives users a single
 * shortcut from anywhere in the app to "I want to look up this
 * bin" without hunting through the admin nav.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { IconExternalLink, IconPackage, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ToolShellProps } from '../registry'

export default function InventoryLookupShell({ onClose }: ToolShellProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    // The destination tab consumes its own search state via the
    // existing dashboard hook; we land the user there and let them
    // re-paste the query if needed (the URL-param contract isn't
    // owned by us yet — extending it is a v1.5 task).
    navigate({ to: '/admin/sap-testing' })
    onClose()
    void trimmed
  }

  return (
    <div className='flex flex-col gap-3 text-sm'>
      <header className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-base font-semibold'>
          <IconPackage className='size-4' />
          Inventory Lookup
        </h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Close Inventory Lookup'
          onClick={onClose}
        >
          <IconX className='size-4' />
        </Button>
      </header>

      <p className='text-muted-foreground text-xs'>
        Quick shortcut to the inventory lookup surface — full search integration
        lands in a follow-up phase.
      </p>

      <form onSubmit={handleSubmit} className='flex flex-col gap-2'>
        <Label htmlFor='omnibelt-inventory-lookup-query' className='text-xs'>
          Bin or part number
        </Label>
        <Input
          id='omnibelt-inventory-lookup-query'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. A1-01-A or 1234567'
          autoComplete='off'
          autoFocus
        />
        <Button type='submit' size='sm' className='justify-between'>
          <span>Open in SAP Testing</span>
          <IconExternalLink className='size-3.5' aria-hidden='true' />
        </Button>
      </form>

      <p className='text-muted-foreground text-[11px]'>
        Inline lookup (live LX03 results in this panel) ships in a future
        OmniBelt release.
      </p>
    </div>
  )
}

// Created and developed by Jai Singh
