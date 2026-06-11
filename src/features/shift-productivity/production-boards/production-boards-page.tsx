// Created and developed by Jai Singh
import { Suspense } from 'react'
import { IconLayoutDashboard } from '@tabler/icons-react'
import { Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { BoardEditToggle } from './components/board-edit-toggle'
import { BoardShell } from './components/board-shell'
import { BoardTabs } from './components/board-tabs'
import { useBoardSearchParam } from './hooks/use-board-search-param'
import { useTvSearchParam } from './hooks/use-tv-search-param'
import { findBoard } from './lib/boards'

function BoardLoadingFallback() {
  return (
    <div className='flex min-h-[40vh] items-center justify-center gap-3'>
      <Loader2 className='text-muted-foreground size-5 animate-spin' />
      <p className='text-muted-foreground text-sm font-medium'>
        Loading board…
      </p>
    </div>
  )
}

export function ProductionBoardsPage() {
  const [boardSlug, setBoardSlug] = useBoardSearchParam()
  const [isTv, setIsTv] = useTvSearchParam()
  const board = findBoard(boardSlug)
  const Body = (
    <BoardShell slug={boardSlug}>
      <Suspense fallback={<BoardLoadingFallback />}>
        <board.Component
          isTv={isTv}
          onExitTv={() => setIsTv(false)}
          onEnterTv={() => setIsTv(true)}
        />
      </Suspense>
    </BoardShell>
  )

  // Each board renders its own TvFrame chrome — when ?tv=1 is on, we
  // bypass the page header / tab strip entirely.
  if (isTv) return Body

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        {/* v2 aesthetic overhaul (2026-05-17): the page header was
            visually dominating the bento grid below it. We've collapsed
            it into a single inline row at lower visual weight (h-12,
            tighter tracking on the title) so the per-board <BoardHeader>
            inside each bento board carries the editorial weight instead. */}
        <div className='mb-3 flex h-12 flex-wrap items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <div className='bg-muted/40 ring-border/40 flex size-8 items-center justify-center rounded-lg ring-1 ring-inset'>
              <IconLayoutDashboard
                className='text-muted-foreground size-4'
                aria-hidden
              />
            </div>
            <div className='flex min-w-0 items-center gap-2'>
              <h2 className='text-foreground/90 truncate text-[15px] font-semibold tracking-[-0.01em]'>
                Production Boards
              </h2>
              <span
                aria-hidden
                className='text-muted-foreground/60 hidden text-sm md:inline'
              >
                ·
              </span>
              <p className='text-muted-foreground hidden truncate text-sm md:inline-block'>
                {board.description}
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <BoardEditToggle />
          </div>
        </div>

        <div className='space-y-4 lg:space-y-6'>
          <BoardTabs activeSlug={boardSlug} onChange={setBoardSlug} />
          {Body}
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
