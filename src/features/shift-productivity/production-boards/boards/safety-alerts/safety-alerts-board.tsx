// Created and developed by Jai Singh
/**
 * Safety Alerts board — severity-sorted alerts with optional ack tracking.
 *
 * Sort order: severity (danger > warning > info > success) THEN
 * `published_at` DESC. The card's left border colour is taken from
 * severity (per-variant card handles that). Acknowledgements use the
 * shared `useBoardPosts.acknowledgePost` mutation.
 *
 * v2 aesthetic overhaul (2026-05-17): wired through <BoardHeader> +
 * <BoardAtmosphere> + <BoardEmptyState> like the other content boards.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { BentoBoardItem } from '../../components/bento/bento-board-shell'
import { BoardAtmosphere } from '../../components/bento/board-atmosphere'
import { BoardEmptyState } from '../../components/bento/board-empty-state'
import { BoardHeader } from '../../components/bento/board-header'
import { TvFrame } from '../../components/tv-frame'
import { useBoardEditMode } from '../../hooks/use-board-edit-mode'
import {
  useBoardPosts,
  type PostRow,
  type PostSeverity,
} from '../../hooks/use-board-posts'
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

const SEVERITY_RANK: Record<PostSeverity, number> = {
  danger: 0,
  warning: 1,
  info: 2,
  success: 3,
}

export function SafetyAlertsBoard({ isTv, onExitTv, onEnterTv }: BoardProps) {
  const { posts, isLoading, acknowledgePost } = useBoardPosts('safety_alert')
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const sorted = useMemo(() => {
    return [...posts].sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (sev !== 0) return sev
      return a.publishedAt < b.publishedAt ? 1 : -1
    })
  }, [posts])

  const [editor, setEditor] = useState<{ open: boolean; post: PostRow | null }>(
    { open: false, post: null }
  )

  const bentoItems = useMemo<BentoBoardItem[]>(
    () => sorted.map((p) => ({ postKind: 'post' as const, post: p })),
    [sorted]
  )

  if (isTv) {
    return (
      <TvFrame
        title='Safety Alerts'
        subtitle='Active alerts in severity order'
        timezone='America/New_York'
        lastUpdatedAt={new Date()}
        onExit={onExitTv}
      >
        <div className='relative h-full'>
          <BoardAtmosphere boardKind='safety_alert' isTv />
          {sorted.length === 0 ? (
            <BoardEmptyState boardKind='safety_alert' density='tv' />
          ) : (
            <Suspense fallback={null}>
              <BentoBoardShell
                boardKind='safety_alert'
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
      <BoardAtmosphere boardKind='safety_alert' />

      <BoardHeader
        boardKind='safety_alert'
        title='Safety Alerts'
        subtitle='Severity-sorted, ack-tracked. When the floor needs to know, post here — it surfaces to every shift.'
        count={sorted.length}
        onCompose={
          showEditAffordances
            ? () => setEditor({ open: true, post: null })
            : undefined
        }
        composeLabel='New alert'
        onEnterTv={onEnterTv}
      />

      {isLoading && sorted.length === 0 ? (
        <LoadingState label='Loading safety alerts…' />
      ) : sorted.length === 0 ? (
        <BoardEmptyState
          boardKind='safety_alert'
          onCompose={
            showEditAffordances
              ? () => setEditor({ open: true, post: null })
              : undefined
          }
        />
      ) : (
        <Suspense fallback={null}>
          <BentoBoardShell
            boardKind='safety_alert'
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
            kind='safety_alert'
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

export default SafetyAlertsBoard

// Created and developed by Jai Singh
