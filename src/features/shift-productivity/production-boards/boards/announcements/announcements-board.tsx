// Created and developed by Jai Singh
/**
 * Announcements board — floor-wide posts filtered by working area.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - Premium <BoardHeader> + <BoardFilterChips> + <BoardAtmosphere>
 *     replace the per-board ad-hoc chrome.
 *   - <BoardEmptyState> on zero posts (was a tiny shadcn Card).
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
import { useBoardWorkingAreas } from '../../hooks/use-board-working-areas'
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

const ALL_AREAS = '__all__'

export function AnnouncementsBoard({ isTv, onExitTv, onEnterTv }: BoardProps) {
  const [activeArea, setActiveArea] = useState<string>(ALL_AREAS)
  const { workingAreas } = useBoardWorkingAreas()
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const { posts, isLoading, acknowledgePost } = useBoardPosts('announcement', {
    workingAreaId: activeArea === ALL_AREAS ? undefined : activeArea,
  })

  const [editor, setEditor] = useState<{ open: boolean; post: PostRow | null }>(
    { open: false, post: null }
  )

  const bentoItems = useMemo<BentoBoardItem[]>(
    () => posts.map((p) => ({ postKind: 'post' as const, post: p })),
    [posts]
  )

  if (isTv) {
    return (
      <TvFrame
        title='Announcements'
        subtitle={
          activeArea === ALL_AREAS
            ? 'All Areas'
            : (workingAreas.find((a) => a.id === activeArea)?.areaName ??
              'Area')
        }
        timezone='America/New_York'
        lastUpdatedAt={new Date()}
        onExit={onExitTv}
      >
        <div className='relative h-full'>
          <BoardAtmosphere boardKind='announcement' isTv />
          {posts.length === 0 ? (
            <BoardEmptyState boardKind='announcement' density='tv' />
          ) : (
            <Suspense fallback={null}>
              <BentoBoardShell
                boardKind='announcement'
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
      {/* Atmosphere — animated mesh + grain behind everything. */}
      <BoardAtmosphere boardKind='announcement' />

      <BoardHeader
        boardKind='announcement'
        title='Announcements'
        subtitle='Floor-wide posts visible to every associate. Filter by working area to focus the view.'
        count={posts.length}
        onCompose={
          showEditAffordances
            ? () => setEditor({ open: true, post: null })
            : undefined
        }
        composeLabel='New announcement'
        onEnterTv={onEnterTv}
        filters={
          <BoardFilterChips
            boardKind='announcement'
            options={[
              { id: ALL_AREAS, label: 'All areas' },
              ...workingAreas.map((a) => ({ id: a.id, label: a.areaName })),
            ]}
            active={activeArea}
            onChange={setActiveArea}
          />
        }
      />

      {isLoading && posts.length === 0 ? (
        <LoadingState label='Loading announcements…' />
      ) : posts.length === 0 ? (
        <BoardEmptyState
          boardKind='announcement'
          onCompose={
            showEditAffordances
              ? () => setEditor({ open: true, post: null })
              : undefined
          }
        />
      ) : (
        <Suspense fallback={null}>
          <BentoBoardShell
            boardKind='announcement'
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
            kind='announcement'
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

export default AnnouncementsBoard

// Created and developed by Jai Singh
