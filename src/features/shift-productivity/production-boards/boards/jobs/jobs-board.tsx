// Created and developed by Jai Singh
/**
 * Jobs board — internal + external job postings.
 *
 * v2 aesthetic overhaul (2026-05-17): wired through <BoardHeader> +
 * <BoardAtmosphere> + <BoardEmptyState>.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { BentoBoardItem } from '../../components/bento/bento-board-shell'
import { BoardAtmosphere } from '../../components/bento/board-atmosphere'
import { BoardEmptyState } from '../../components/bento/board-empty-state'
import { BoardHeader } from '../../components/bento/board-header'
import { TvFrame } from '../../components/tv-frame'
import { useBoardEditMode } from '../../hooks/use-board-edit-mode'
import { useCanEditBoards } from '../../hooks/use-can-edit-boards'
import type { BoardProps } from '../../lib/boards'
import { useJobPostings, type JobPostingRow } from './hooks/use-job-postings'

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

export function JobsBoard({ isTv, onExitTv, onEnterTv }: BoardProps) {
  const { jobs, isLoading } = useJobPostings()
  const { canEdit } = useCanEditBoards()
  const [editMode] = useBoardEditMode()
  const showEditAffordances = canEdit && editMode

  const [editor, setEditor] = useState<{
    open: boolean
    job: JobPostingRow | null
  }>({ open: false, job: null })

  const bentoItems = useMemo<BentoBoardItem[]>(
    () => jobs.map((j) => ({ postKind: 'job' as const, post: j })),
    [jobs]
  )

  if (isTv) {
    return (
      <TvFrame
        title='Job Postings'
        subtitle='Internal & external openings'
        timezone='America/New_York'
        lastUpdatedAt={new Date()}
        onExit={onExitTv}
      >
        <div className='relative h-full'>
          <BoardAtmosphere boardKind='job' isTv />
          {jobs.length === 0 ? (
            <BoardEmptyState boardKind='job' density='tv' />
          ) : (
            <Suspense fallback={null}>
              <BentoBoardShell
                boardKind='job'
                items={bentoItems}
                editMode={false}
                isTv
              />
            </Suspense>
          )}
        </div>
      </TvFrame>
    )
  }

  return (
    <div className='relative isolate space-y-5 lg:space-y-7'>
      <BoardAtmosphere boardKind='job' />

      <BoardHeader
        boardKind='job'
        title='Open positions'
        subtitle='Internal moves and external roles, side by side. Cross-shift visibility moves hard-to-fill posts.'
        count={jobs.length}
        onCompose={
          showEditAffordances
            ? () => setEditor({ open: true, job: null })
            : undefined
        }
        composeLabel='New job'
        onEnterTv={onEnterTv}
      />

      {isLoading && jobs.length === 0 ? (
        <LoadingState label='Loading jobs…' />
      ) : jobs.length === 0 ? (
        <BoardEmptyState
          boardKind='job'
          onCompose={
            showEditAffordances
              ? () => setEditor({ open: true, job: null })
              : undefined
          }
        />
      ) : (
        <Suspense fallback={null}>
          <BentoBoardShell
            boardKind='job'
            items={bentoItems}
            editMode={showEditAffordances}
            isTv={false}
            onEditJob={(_, job) => setEditor({ open: true, job })}
          />
        </Suspense>
      )}

      {editor.open && (
        <Suspense fallback={null}>
          <PostComposerDialog
            open={editor.open}
            kind='job'
            mode={
              editor.job
                ? { type: 'edit-job', job: editor.job }
                : { type: 'create' }
            }
            onClose={() => setEditor({ open: false, job: null })}
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

export default JobsBoard

// Created and developed by Jai Singh
