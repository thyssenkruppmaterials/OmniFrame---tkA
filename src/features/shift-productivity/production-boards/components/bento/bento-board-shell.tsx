// Created and developed by Jai Singh
/**
 * Bento board shell — a thin wrapper that joins
 *   - the post / job list (from `useBoardPosts` or `useJobPostings`)
 *   - the layout map (from `useBoardCardLayouts`)
 * into a single `BoardCard[]` and renders a `<BentoGrid>` with the
 * upsert / reset wiring. Used by all four secondary boards.
 *
 * Each consuming board still owns its own filter chrome, "+ New" CTA,
 * "Display on TV" button, and empty state — the shell only provides
 * the resizable bento-grid surface itself.
 */
import { useMemo } from 'react'
import { IconRefresh } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { JobPostingRow } from '../../boards/jobs/hooks/use-job-postings'
import { useBoardCardLayouts } from '../../hooks/use-board-card-layouts'
import type { PostRow } from '../../hooks/use-board-posts'
import { BentoGrid } from './bento-grid'
import { defaultLayoutForVariant } from './bento-layout'
import {
  parseCardVariant,
  parseVariantConfig,
  type BentoBoardKind,
  type BoardCard,
  type CardVariant,
  type VariantConfig,
} from './card-variant'

interface BentoBoardShellPostInput {
  postKind: 'post'
  post: PostRow
}
interface BentoBoardShellJobInput {
  postKind: 'job'
  post: JobPostingRow
}
export type BentoBoardItem = BentoBoardShellPostInput | BentoBoardShellJobInput

export interface BentoBoardShellProps {
  boardKind: BentoBoardKind
  /** Slice key (e.g. `'all'` or a working-area code). */
  scope?: string
  items: BentoBoardItem[]
  editMode: boolean
  isTv: boolean
  onEditPost?: (postKind: 'post', post: PostRow) => void
  onEditJob?: (postKind: 'job', job: JobPostingRow) => void
  onAcknowledgePost?: (post: PostRow) => void
  className?: string
}

/**
 * Reads `kind_data.card_variant` + `kind_data.card_variant_config`
 * off the post / job as a curator-pickable hint. The composer writes
 * those keys; this shell respects them when there's no row in
 * `production_board_card_layouts` yet.
 */
function variantHintFromPost(post: PostRow | JobPostingRow): {
  variant: CardVariant
  config: VariantConfig
} {
  const kd = post.kindData as
    | (Record<string, unknown> & {
        card_variant?: unknown
        card_variant_config?: unknown
      })
    | undefined
  const variant = parseCardVariant(kd?.card_variant)
  const config = parseVariantConfig(variant, kd?.card_variant_config)
  return { variant, config }
}

export function BentoBoardShell({
  boardKind,
  scope = 'all',
  items,
  editMode,
  isTv,
  onEditPost,
  onEditJob,
  onAcknowledgePost,
  className,
}: BentoBoardShellProps) {
  const { layouts, upsertLayout, resetBoardLayout } = useBoardCardLayouts(
    boardKind,
    scope
  )

  const cards: BoardCard[] = useMemo(() => {
    return items.map(({ postKind, post }) => {
      const existing = layouts.get(post.id)
      if (existing) {
        return {
          layoutId: existing.id,
          postKind,
          post,
          gridX: existing.gridX,
          gridY: existing.gridY,
          gridW: existing.gridW,
          gridH: existing.gridH,
          cardVariant: existing.cardVariant,
          variantConfig: existing.variantConfig,
          isDefaultLayout: false,
        } as BoardCard
      }
      const { variant, config } = variantHintFromPost(post)
      const def = defaultLayoutForVariant(variant)
      return {
        layoutId: null,
        postKind,
        post,
        gridX: def.gridX,
        gridY: def.gridY,
        gridW: def.gridW,
        gridH: def.gridH,
        cardVariant: variant,
        variantConfig: config,
        isDefaultLayout: true,
      } as BoardCard
    })
  }, [items, layouts])

  return (
    <div className={cn('relative flex flex-col gap-4', className)}>
      {editMode && !isTv && (
        <div className='border-border/40 bg-muted/40 flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-xs backdrop-blur-sm'>
          <span className='text-muted-foreground'>
            Drag cards by the grip handle (top-right) to rearrange, drag the
            bottom-right corner to resize. Layouts save automatically.
          </span>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={layouts.size === 0 || resetBoardLayout.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Reset this board to the default auto-layout? Your custom card positions will be discarded.'
                )
              ) {
                resetBoardLayout.mutate()
              }
            }}
            className='gap-1.5'
          >
            <IconRefresh className='h-3.5 w-3.5' aria-hidden /> Reset layout
          </Button>
        </div>
      )}
      <BentoGrid
        cards={cards}
        editMode={editMode}
        isTv={isTv}
        onEditPost={(card) => {
          if (card.postKind === 'job') {
            onEditJob?.('job', card.post as JobPostingRow)
          } else {
            onEditPost?.('post', card.post as PostRow)
          }
        }}
        onAcknowledgePost={(card) => {
          if (card.postKind === 'post') {
            onAcknowledgePost?.(card.post as PostRow)
          }
        }}
        onLayoutChange={(postId, next) => {
          const item = items.find((c) => c.post.id === postId)
          if (!item) return
          const existing = layouts.get(postId)
          const variant =
            existing?.cardVariant ?? variantHintFromPost(item.post).variant
          const variantConfig =
            existing?.variantConfig ?? variantHintFromPost(item.post).config
          upsertLayout.mutate({
            postId,
            postKind: item.postKind,
            gridX: next.gridX,
            gridY: next.gridY,
            gridW: next.gridW,
            gridH: next.gridH,
            cardVariant: variant,
            variantConfig,
          })
        }}
      />
    </div>
  )
}

// Created and developed by Jai Singh
