// Created and developed by Jai Singh
/**
 * HR News board — branch-scoped HR communications. The chip strip
 * selects "All", "Company-wide" (branch_id IS NULL), or a single branch.
 *
 * v2 aesthetic overhaul (2026-05-17): wired through <BoardHeader> +
 * <BoardAtmosphere> + <BoardEmptyState> like the other content boards.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { BentoBoardItem } from '../../components/bento/bento-board-shell'
import { BoardAtmosphere } from '../../components/bento/board-atmosphere'
import { BoardEmptyState } from '../../components/bento/board-empty-state'
import { BoardFilterChips } from '../../components/bento/board-filter-chips'
import { BoardHeader } from '../../components/bento/board-header'
import { TvFrame } from '../../components/tv-frame'
import { useBoardEditMode } from '../../hooks/use-board-edit-mode'
import { useBoardPosts, type PostRow } from '../../hooks/use-board-posts'
import { useBranches } from '../../hooks/use-branches'
import { useCanEditBoards } from '../../hooks/use-can-edit-boards'
import type { BoardProps } from '../../lib/boards'

const BentoBoardShell = lazy(() =>
  import('../../components/bento/bento-board-shell').then((m) => ({
    default: m.BentoBoardShell,
  }))
)
const PostComposerDialog = lazy(() =>
  import('../../components/post-composer-dialog').then((m) => ({
    default: m.PostComposerDialog,
  }))
)

type FilterValue = 'all' | 'company' | string

export function HrNewsBoard({ isTv, onExitTv, onEnterTv }: BoardProps) {
  const [active, setActive] = useState<FilterValue>('all')
  const { branches } = useBranches()
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const branchFilter = useMemo<{ branchId?: string | null }>(() => {
    if (active === 'all') return {}
    if (active === 'company') return { branchId: null }
    return { branchId: active }
  }, [active])

  const { posts, isLoading, acknowledgePost } = useBoardPosts(
    'hr_news',
    branchFilter
  )

  const [editor, setEditor] = useState<{ open: boolean; post: PostRow | null }>(
    { open: false, post: null }
  )

  const bentoItems = useMemo<BentoBoardItem[]>(
    () => posts.map((p) => ({ postKind: 'post' as const, post: p })),
    [posts]
  )

  if (isTv) {
    const subtitle =
      active === 'all'
        ? 'All branches'
        : active === 'company'
          ? 'Company-wide'
          : (branches.find((b) => b.id === active)?.name ?? 'Branch')
    return (
      <TvFrame
        title='HR News'
        subtitle={subtitle}
        timezone='America/New_York'
        lastUpdatedAt={new Date()}
        onExit={onExitTv}
      >
        <div className='relative h-full'>
          <BoardAtmosphere boardKind='hr_news' isTv />
          {posts.length === 0 ? (
            <BoardEmptyState boardKind='hr_news' density='tv' />
          ) : (
            <Suspense fallback={null}>
              <BentoBoardShell
                boardKind='hr_news'
                items={bentoItems}
                editMode={false}
                isTv
                onAcknowledgePost={(p) => acknowledgePost.mutate(p.id)}
              />
            </Suspense>
          )}
        </div>
      </TvFrame>
    )
  }

  return (
    <div className='relative isolate space-y-5 lg:space-y-7'>
      <BoardAtmosphere boardKind='hr_news' />

      <BoardHeader
        boardKind='hr_news'
        title='HR News'
        subtitle='Company-wide updates and per-branch communications. Pin welcomes, surface policy changes, or share a milestone.'
        count={posts.length}
        onCompose={
          showEditAffordances
            ? () => setEditor({ open: true, post: null })
            : undefined
        }
        composeLabel='New post'
        onEnterTv={onEnterTv}
        filters={
          <BoardFilterChips
            boardKind='hr_news'
            options={[
              { id: 'all', label: 'All' },
              { id: 'company', label: 'Company-wide' },
              ...branches.map((b) => ({ id: b.id, label: b.name })),
            ]}
            active={active}
            onChange={setActive}
          />
        }
      />

      {isLoading && posts.length === 0 ? (
        <LoadingState label='Loading HR news…' />
      ) : posts.length === 0 ? (
        <BoardEmptyState
          boardKind='hr_news'
          onCompose={
            showEditAffordances
              ? () => setEditor({ open: true, post: null })
              : undefined
          }
        />
      ) : (
        <Suspense fallback={null}>
          <BentoBoardShell
            boardKind='hr_news'
            items={bentoItems}
            editMode={showEditAffordances}
            isTv={false}
            onEditPost={(_, post) => setEditor({ open: true, post })}
            onAcknowledgePost={(p) => acknowledgePost.mutate(p.id)}
          />
        </Suspense>
      )}

      {editor.open && (
        <Suspense fallback={null}>
          <PostComposerDialog
            open={editor.open}
            kind='hr_news'
            mode={
              editor.post
                ? { type: 'edit', post: editor.post }
                : { type: 'create' }
            }
            onClose={() => setEditor({ open: false, post: null })}
          />
        </Suspense>
      )}
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className='text-muted-foreground flex min-h-[36vh] flex-col items-center justify-center gap-3 text-sm'>
      <Loader2 className='size-5 animate-spin' aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export default HrNewsBoard

// Created and developed by Jai Singh
