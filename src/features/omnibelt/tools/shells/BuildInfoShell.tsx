// Created and developed by Jai Singh
/**
 * OmniBelt — Build Info shell
 *
 * Lazy-loaded panel surface for the `build_info` tool. Fetches the
 * deployed `/build-info.json` via TanStack Query (the same payload
 * the version checker consumes) and displays the build hash, commit,
 * build time and current Vite mode side-by-side with the in-bundle
 * `__BUILD_HASH__` injected by the `buildVersionPlugin` in
 * `vite.config.ts`. A drift between the two is the first signal that
 * a service worker is serving a stale shell.
 *
 * Designed to be safe to fail — when `/build-info.json` 404s (e.g.
 * dev server before first build) the shell renders the bundled
 * values only and notes the network issue rather than throwing.
 */
import { useQuery } from '@tanstack/react-query'
import { IconInfoCircle, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import type { ToolShellProps } from '../registry'

type BuildInfo = {
  version?: string
  buildId?: string
  buildTime?: string
  commitHash?: string
  environment?: string
}

async function fetchBuildInfo(): Promise<BuildInfo | null> {
  try {
    const resp = await fetch('/build-info.json', { cache: 'no-store' })
    if (!resp.ok) return null
    return (await resp.json()) as BuildInfo
  } catch {
    return null
  }
}

// `__BUILD_HASH__` is replaced at build time by the
// `buildVersionPlugin` (vite.config.ts). Fall back to a sentinel
// when consumed by tests / dev server before first build.
declare const __BUILD_HASH__: string

function safeBundleHash(): string {
  try {
    return typeof __BUILD_HASH__ === 'string' ? __BUILD_HASH__ : 'unknown'
  } catch {
    return 'unknown'
  }
}

export default function BuildInfoShell({ onClose }: ToolShellProps) {
  const { data, isLoading, isError } = useQuery<BuildInfo | null>({
    queryKey: ['omnibelt', 'build-info'],
    queryFn: fetchBuildInfo,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const bundleHash = safeBundleHash()
  const deployedHash = data?.buildId ?? 'unknown'
  const drift =
    bundleHash !== 'unknown' && deployedHash !== 'unknown'
      ? bundleHash !== deployedHash
      : false

  return (
    <div className='flex flex-col gap-3 text-sm'>
      <header className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-base font-semibold'>
          <IconInfoCircle className='size-4' />
          Build Info
        </h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Close Build Info'
          onClick={onClose}
        >
          <IconX className='size-4' />
        </Button>
      </header>

      <p className='text-muted-foreground text-xs'>
        Diagnostic snapshot — useful when reporting a bug or confirming a
        hot-fix actually shipped.
      </p>

      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-xs'>
        <dt className='text-muted-foreground'>Mode</dt>
        <dd>{import.meta.env.MODE}</dd>

        <dt className='text-muted-foreground'>Bundle hash</dt>
        <dd className='break-all'>{bundleHash}</dd>

        <dt className='text-muted-foreground'>Deployed hash</dt>
        <dd className='break-all'>
          {isLoading ? '…' : isError || !data ? 'unavailable' : deployedHash}
        </dd>

        {data?.commitHash && (
          <>
            <dt className='text-muted-foreground'>Commit</dt>
            <dd className='break-all'>{data.commitHash}</dd>
          </>
        )}

        {data?.buildTime && (
          <>
            <dt className='text-muted-foreground'>Built at</dt>
            <dd>{data.buildTime}</dd>
          </>
        )}

        {data?.version && (
          <>
            <dt className='text-muted-foreground'>Version</dt>
            <dd>{data.version}</dd>
          </>
        )}
      </dl>

      {drift && (
        <p className='text-destructive text-xs'>
          Bundle and deployed hashes differ — a reload should pick up the latest
          build.
        </p>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
