// Created and developed by Jai Singh
/**
 * Gallery card variant — cinematic auto-rotating image carousel.
 *
 * v2 aesthetic overhaul (2026-05-17):
 *   - 600ms crossfade with `blur(0px) → blur(8px)` on the outgoing image
 *     for a true filmic transition (was: 300ms opacity only).
 *   - 6-second Ken Burns scale 1 → 1.05 on the active image.
 *   - Caption sits inside a translucent glass panel with `backdrop-blur-md`.
 *   - Dot pager — active dot grows to `w-8` AND swaps to the accent
 *     gradient (was: brightness only).
 *   - Edge chevrons fade in on hover with subtle scale-in.
 *
 * Falls back to <ClassicCard> when fewer than 2 image attachments.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { PostRow } from '../../../hooks/use-board-posts'
import {
  GALLERY_DEFAULT_INTERVAL_S,
  type GalleryVariantConfig,
} from '../card-variant'
import { EditPencil, Eyebrow, PinnedBadge, SeverityBadge } from './card-shared'
import {
  accentColorOf,
  cardShell,
  formatPublished,
  isPostKind,
  postedByNameOf,
  publishedAtOf,
  severityOf,
  type SharedCardProps,
} from './card-shared-utils'
import { ClassicCard } from './classic-card'
import { imageAttachmentsOf, publicImageUrl } from './storage-helpers'

interface GalleryCardProps extends SharedCardProps {
  config: GalleryVariantConfig
}

const HOVER_RESUME_DELAY_MS = 2_000

export function GalleryCard(props: GalleryCardProps) {
  const post = isPostKind(props) ? (props.post as PostRow) : null

  const images = imageAttachmentsOf(
    post ? post.attachments : (props.post.attachments ?? [])
  )

  if (images.length < 2) {
    return <ClassicCard {...props} />
  }

  return <GalleryCardImpl outer={props} images={images} post={post} />
}

interface InnerProps {
  outer: GalleryCardProps
  images: ReturnType<typeof imageAttachmentsOf>
  post: PostRow | null
}

function GalleryCardImpl({ outer: props, images, post }: InnerProps) {
  const intervalMs =
    (props.config.rotate_interval_seconds ?? GALLERY_DEFAULT_INTERVAL_S) * 1000

  const [activeIdx, setActiveIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const resumeRef = useRef<number | null>(null)

  const advance = useCallback(() => {
    setActiveIdx((i) => (i + 1) % images.length)
  }, [images.length])

  const goPrev = useCallback(() => {
    setActiveIdx((i) => (i - 1 + images.length) % images.length)
  }, [images.length])

  useEffect(() => {
    if (paused) return
    if (typeof window === 'undefined') return
    const id = window.setInterval(advance, intervalMs)
    return () => window.clearInterval(id)
  }, [advance, intervalMs, paused])

  const onMouseEnter = useCallback(() => {
    setPaused(true)
    if (resumeRef.current != null) {
      window.clearTimeout(resumeRef.current)
      resumeRef.current = null
    }
  }, [])

  const onMouseLeave = useCallback(() => {
    if (resumeRef.current != null) window.clearTimeout(resumeRef.current)
    resumeRef.current = window.setTimeout(() => {
      setPaused(false)
      resumeRef.current = null
    }, HOVER_RESUME_DELAY_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (resumeRef.current != null) window.clearTimeout(resumeRef.current)
    }
  }, [])

  const current = images[activeIdx]
  const url = publicImageUrl(current.storage_path)
  const accent = accentColorOf(props)
  const severity = severityOf(props)

  return (
    <article
      className={cn(cardShell({ isTv: props.isTv }), 'min-h-0')}
      data-card-variant='gallery'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-paused={paused ? 'true' : 'false'}
    >
      {/* Left accent stripe — kind gradient. */}
      <div
        aria-hidden
        className='absolute inset-y-0 left-0 z-30 w-[3px]'
        style={{
          background: `linear-gradient(180deg, ${accent}00 0%, ${accent} 30%, ${accent} 70%, ${accent}00 100%)`,
        }}
      />

      {/* Slides — absolute-positioned with framer-motion crossfade + */}
      {/* Ken Burns drift on the active image. */}
      <div className='absolute inset-0'>
        <AnimatePresence initial={false} mode='popLayout'>
          <motion.img
            key={current.id}
            src={url ?? ''}
            alt={current.caption || current.file_name}
            loading='lazy'
            className='absolute inset-0 h-full w-full object-cover'
            initial={{ opacity: 0, scale: 1.06, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(6px)' }}
            transition={{
              opacity: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
              filter: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
              scale: {
                duration: intervalMs / 1000,
                ease: 'linear',
              },
            }}
          />
        </AnimatePresence>
      </div>

      {/* Top scrim — soft, only just enough to keep badges legible. */}
      <div
        aria-hidden
        className='absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-black/55 via-black/20 to-transparent'
      />
      {/* Bottom scrim — deeper, holds the caption panel. */}
      <div
        aria-hidden
        className='absolute inset-x-0 bottom-0 z-10 h-40 bg-linear-to-t from-black/80 via-black/40 to-transparent'
      />

      {/* Top row — badges + pencil. */}
      <div className='relative z-20 flex items-start justify-between gap-2 p-3 pl-5'>
        <div className='flex flex-wrap items-center gap-1.5 text-white'>
          <PinnedBadge pinned={!!post?.isPinned} />
          {post && <SeverityBadge severity={severity} />}
        </div>
        <EditPencil
          show={props.showEditAffordances && !props.disableInteractions}
          onEdit={props.onEdit}
          ariaLabel={`Edit ${props.post.title}`}
        />
      </div>

      <div className='flex-1' />

      {/* Glass caption panel — translucent backdrop blur. */}
      <div className='relative z-20 mx-3 mb-3 flex flex-col gap-1 rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-white backdrop-blur-md'>
        <Eyebrow color={accent} isTv={props.isTv} className='text-white/85'>
          {images.length} photo{images.length === 1 ? '' : 's'}
        </Eyebrow>
        <h3
          className={cn(
            'font-display [font-family:var(--font-geist),Inter,system-ui] leading-[1.08] font-semibold tracking-[-0.022em]',
            props.isTv ? 'text-2xl md:text-3xl' : 'text-base md:text-lg'
          )}
        >
          {props.post.title}
        </h3>
        {current.caption && (
          <p
            className={cn(
              'leading-snug opacity-90',
              props.isTv ? 'text-base' : 'text-xs'
            )}
          >
            {current.caption}
          </p>
        )}
        <div
          className={cn(
            'mt-1 flex items-center justify-between gap-2 text-white/70',
            props.isTv ? 'text-sm' : 'text-[11px]'
          )}
        >
          <span className='tabular-nums'>
            {postedByNameOf(props) ? `${postedByNameOf(props)} · ` : ''}
            {formatPublished(publishedAtOf(props))}
          </span>
          <span className='tabular-nums'>
            {activeIdx + 1} / {images.length}
          </span>
        </div>
      </div>

      {/* Prev / next chevrons — fade in on hover only. */}
      {!props.isTv && (
        <>
          <button
            type='button'
            aria-label='Previous image'
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
            className='absolute top-1/2 left-2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-all group-hover:opacity-100 hover:scale-105 hover:bg-black/55'
          >
            <IconChevronLeft className='h-5 w-5' aria-hidden />
          </button>
          <button
            type='button'
            aria-label='Next image'
            onClick={(e) => {
              e.stopPropagation()
              advance()
            }}
            className='absolute top-1/2 right-2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-all group-hover:opacity-100 hover:scale-105 hover:bg-black/55'
          >
            <IconChevronRight className='h-5 w-5' aria-hidden />
          </button>
        </>
      )}

      {/* Dot pager — active dot grows + paints with the accent gradient. */}
      <div className='absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5'>
        {images.map((img, i) => {
          const isActive = i === activeIdx
          return (
            <button
              key={img.id}
              type='button'
              aria-label={`Jump to image ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation()
                setActiveIdx(i)
              }}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                isActive ? 'w-8' : 'w-1.5 bg-white/40 hover:bg-white/70'
              )}
              style={
                isActive
                  ? {
                      background: `linear-gradient(90deg, ${accent}, ${accent}aa)`,
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </article>
  )
}

// Created and developed by Jai Singh
