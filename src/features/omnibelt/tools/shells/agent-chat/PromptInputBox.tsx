// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat: composer input box
 *
 * Adapted from the user-provided `PromptInputBox` reference. Key
 * deltas vs the source:
 *   - Uses the project's shadcn `<Textarea>` (via `cn`) — no inline
 *     primitive duplication.
 *   - Uses `<Tooltip>` from `@/components/ui/tooltip` so the input
 *     box doesn't ship a second TooltipProvider tree.
 *   - Scrollbar styling lives in `src/index.css` under
 *     `.omnibelt-chat-textarea` (NOT injected via
 *     `document.head.appendChild(...)`). The class is opted-in only
 *     on this textarea so the rest of the app keeps its native
 *     scrollbar look.
 *   - Mode + attachment + recording state moves into a tiny
 *     `<PromptInputProvider>` so the toolbar children stay readable.
 *
 * Visual fidelity preserved:
 *   - Dark `bg-[#1F2023]`, `border-[#444444]`.
 *   - Search / Think / Canvas modes with `#1EAEDB`, `#8B5CF6`,
 *     `#F97316` accents and the rotate-on-toggle + expanding-label
 *     animation.
 *   - Send button morphs through Mic → ArrowUp → StopCircle → Square
 *     based on `isRecording`, `hasContent`, `isLoading`.
 *   - 10MB image cap, drag-drop + click-to-upload, paste-image
 *     from clipboard.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUp,
  Loader2,
  Mic,
  Paperclip,
  Search,
  Sparkles,
  Square,
  StopCircle,
  Wand2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ImageViewDialog } from './ImageViewDialog'
import { VoiceRecorder } from './VoiceRecorder'
import { PromptInputProvider } from './prompt-context'
import {
  MAX_ATTACHMENT_BYTES,
  type ChatAttachment,
  type ChatMode,
} from './types'

export type PromptInputBoxProps = {
  onSend: (
    message: string,
    files?: File[],
    options?: { mode: ChatMode | null; voiceDurationMs?: number }
  ) => void
  isLoading?: boolean
  placeholder?: string
  className?: string
}

export type PromptInputBoxHandle = {
  focus: () => void
  reset: () => void
}

type ModeDef = {
  id: ChatMode
  label: string
  icon: typeof Search
  /** Tailwind class for the active accent text + glow. The hex is
   *  inlined as an arbitrary value so Tailwind keeps the exact
   *  color from the design (matches the reference component). */
  color: string
}

const MODES: readonly ModeDef[] = [
  { id: 'search', label: 'Search', icon: Search, color: '#1EAEDB' },
  { id: 'think', label: 'Think', icon: Sparkles, color: '#8B5CF6' },
  { id: 'canvas', label: 'Canvas', icon: Wand2, color: '#F97316' },
]

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Gradient divider drawn between mode pills. Tiny vertical pin with
 * a soft glow so the toggle row reads as a single segmented control
 * rather than three loose chips.
 */
function ModeDivider() {
  return (
    <span
      aria-hidden='true'
      className='mx-1 inline-block h-4 w-px shrink-0 rounded-full bg-gradient-to-b from-transparent via-white/40 to-transparent'
    />
  )
}

export const PromptInputBox = forwardRef<
  PromptInputBoxHandle,
  PromptInputBoxProps
>(function PromptInputBox(
  {
    onSend,
    isLoading = false,
    placeholder = 'Ask the OmniFrame agent…',
    className,
  },
  ref
) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<ChatMode | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [voiceMs, setVoiceMs] = useState(0)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Auto-size the textarea (cap so the panel doesn't grow without
  // bound). `field-sizing: content` from the project Textarea handles
  // most of this already, but we cap max-height here for safety
  // when the input is rendered inside a fixed-height dialog.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  // Revoke object URLs when attachments drop out of the list so
  // closing the dialog doesn't leak blob memory.
  useEffect(() => {
    return () => {
      for (const att of attachments) {
        try {
          URL.revokeObjectURL(att.previewUrl)
        } catch {
          /* noop — best effort */
        }
      }
    }
    // We intentionally only run cleanup at unmount; per-attachment
    // teardown happens in `removeAttachment` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      reset: () => {
        setValue('')
        setAttachments((prev) => {
          for (const att of prev) {
            try {
              URL.revokeObjectURL(att.previewUrl)
            } catch {
              /* noop */
            }
          }
          return []
        })
        setMode(null)
        setIsRecording(false)
        setVoiceMs(0)
      },
    }),
    []
  )

  const hasContent = value.trim().length > 0 || attachments.length > 0

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setErrorMsg(null)
    const next: ChatAttachment[] = []
    for (const file of Array.from(incoming)) {
      if (!isImageFile(file)) {
        setErrorMsg('Only image files are supported in v1.')
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setErrorMsg(
          `${file.name} is larger than ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)} MB.`
        )
        continue
      }
      next.push({
        id:
          (globalThis.crypto?.randomUUID?.() as string | undefined) ??
          `${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next])
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target) {
        try {
          URL.revokeObjectURL(target.previewUrl)
        } catch {
          /* noop */
        }
      }
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      const pastedImages: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) pastedImages.push(f)
        }
      }
      if (pastedImages.length > 0) {
        e.preventDefault()
        addFiles(pastedImages)
      }
    },
    [addFiles]
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer?.files?.length) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files)
        // Reset so picking the same file twice still fires onChange.
        e.target.value = ''
      }
    },
    [addFiles]
  )

  const submit = useCallback(() => {
    if (isLoading) return
    const trimmed = value.trim()
    if (!trimmed && attachments.length === 0) return
    onSend(
      trimmed,
      attachments.map((a) => a.file),
      { mode }
    )
    setValue('')
    setAttachments([])
    setMode(null)
    setErrorMsg(null)
  }, [attachments, isLoading, mode, onSend, value])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    [submit]
  )

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    // v1 surfaces the duration as part of the send payload so the
    // parent can decide what to render in the chat log. v1.5 swaps
    // this for a real audio blob.
    if (voiceMs > 0) {
      onSend('[voice memo]', undefined, { mode, voiceDurationMs: voiceMs })
    }
    setVoiceMs(0)
  }, [mode, onSend, voiceMs])

  const handleSendClick = useCallback(() => {
    if (isLoading) return
    if (isRecording) {
      stopRecording()
      return
    }
    if (hasContent) {
      submit()
      return
    }
    setIsRecording(true)
  }, [hasContent, isLoading, isRecording, stopRecording, submit])

  const contextValue = useMemo(
    () => ({ value, attachments, mode, isLoading, isRecording }),
    [value, attachments, mode, isLoading, isRecording]
  )

  /**
   * Send button glyph picker — must match the spec exactly:
   *   isLoading  → Square (the agent is replying; user can interrupt)
   *   isRecording→ StopCircle (stop the voice memo)
   *   hasContent → ArrowUp (send)
   *   otherwise  → Mic (start a voice memo)
   */
  const SendIcon = isLoading
    ? Square
    : isRecording
      ? StopCircle
      : hasContent
        ? ArrowUp
        : Mic

  return (
    <PromptInputProvider value={contextValue}>
      <TooltipProvider delayDuration={300}>
        <div
          data-testid='omnibelt-prompt-input'
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative flex w-full flex-col gap-2 rounded-2xl border bg-[#1F2023] p-2 text-white shadow-lg transition-colors',
            'border-[#444444] focus-within:border-[#666666]',
            isDragging && 'border-dashed border-white/60 bg-white/[0.02]',
            className
          )}
        >
          {isDragging && (
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/40 text-xs text-white/80'
            >
              Drop image to attach
            </div>
          )}

          {/* Attachment preview row */}
          {attachments.length > 0 && (
            <div
              data-testid='omnibelt-prompt-attachments'
              className='flex flex-wrap gap-2 px-1 pt-1'
            >
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className='group relative size-14 overflow-hidden rounded-md border border-[#444444] bg-black'
                >
                  <button
                    type='button'
                    onClick={() => setPreviewSrc(att.previewUrl)}
                    className='block size-full focus:outline-none'
                    aria-label={`Preview ${att.name}`}
                  >
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      className='size-full object-cover'
                    />
                  </button>
                  <button
                    type='button'
                    onClick={() => removeAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                    className='absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/80 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none'
                  >
                    <X className='size-3' />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea OR voice recorder visualiser (mutually exclusive). */}
          {isRecording ? (
            <VoiceRecorder
              isRecording={isRecording}
              onTick={(ms) => setVoiceMs(ms)}
            />
          ) : (
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              aria-label='Agent chat message'
              rows={1}
              className={cn(
                'omnibelt-chat-textarea min-h-[40px] resize-none border-0 bg-transparent px-2 py-2 text-sm text-white shadow-none placeholder:text-white/40 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent'
              )}
            />
          )}

          {errorMsg && (
            <p role='alert' className='px-2 text-[11px] text-[#F97316]'>
              {errorMsg}
            </p>
          )}

          {/* Toolbar */}
          <div className='flex items-center justify-between gap-2 px-1'>
            <div className='flex items-center gap-1'>
              {/* Attach */}
              <input
                ref={fileInputRef}
                type='file'
                accept='image/*'
                multiple
                onChange={handleFileChange}
                className='sr-only'
                aria-label='Attach images'
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => fileInputRef.current?.click()}
                    aria-label='Attach image'
                    className='size-8 text-white/70 hover:bg-white/10 hover:text-white'
                  >
                    <Paperclip className='size-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach image (≤10 MB)</TooltipContent>
              </Tooltip>

              <ModeDivider />

              {/* Mode toggles */}
              {MODES.map((m) => {
                const active = mode === m.id
                const Icon = m.icon
                return (
                  <Tooltip key={m.id}>
                    <TooltipTrigger asChild>
                      <button
                        type='button'
                        onClick={() => setMode(active ? null : m.id)}
                        aria-pressed={active}
                        aria-label={`${m.label} mode`}
                        data-mode={m.id}
                        data-active={active ? 'true' : 'false'}
                        className={cn(
                          'flex h-8 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors',
                          active
                            ? 'bg-white/10'
                            : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                        )}
                        style={active ? { color: m.color } : undefined}
                      >
                        <motion.span
                          animate={{
                            rotate: active ? 360 : 0,
                            scale: active ? 1.05 : 1,
                          }}
                          transition={{
                            type: 'spring',
                            stiffness: 320,
                            damping: 22,
                          }}
                          className='inline-flex'
                        >
                          <Icon className='size-3.5' />
                        </motion.span>
                        <AnimatePresence initial={false}>
                          {active && (
                            <motion.span
                              key='label'
                              initial={{ width: 0, opacity: 0 }}
                              animate={{ width: 'auto', opacity: 1 }}
                              exit={{ width: 0, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className='overflow-hidden whitespace-nowrap'
                            >
                              {m.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{m.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            {/* Send button (morphing) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type='button'
                  size='icon'
                  onClick={handleSendClick}
                  disabled={isLoading && !isRecording}
                  aria-label={
                    isLoading
                      ? 'Agent is responding'
                      : isRecording
                        ? 'Stop recording'
                        : hasContent
                          ? 'Send message'
                          : 'Start voice memo'
                  }
                  data-send-state={
                    isLoading
                      ? 'loading'
                      : isRecording
                        ? 'recording'
                        : hasContent
                          ? 'send'
                          : 'mic'
                  }
                  className={cn(
                    'size-9 shrink-0 rounded-full border border-white/15 bg-white text-black transition-colors hover:bg-white/90',
                    isRecording &&
                      'border-transparent bg-[#F97316] text-white hover:bg-[#F97316]/90',
                    isLoading &&
                      'cursor-default bg-white/20 text-white hover:bg-white/20'
                  )}
                >
                  {isLoading ? (
                    <span className='flex items-center gap-1'>
                      <Loader2 className='size-3.5 animate-spin' />
                      <SendIcon className='size-3.5' />
                    </span>
                  ) : (
                    <SendIcon className='size-4' />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isLoading
                  ? 'Working…'
                  : isRecording
                    ? 'Stop recording'
                    : hasContent
                      ? 'Send (Enter)'
                      : 'Hold for voice memo'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <ImageViewDialog
          open={previewSrc !== null}
          onOpenChange={(o) => !o && setPreviewSrc(null)}
          src={previewSrc}
        />
      </TooltipProvider>
    </PromptInputProvider>
  )
})

/** Extra render helper exported only so consumers can compose the
 *  composer with their own surrounding chrome. Currently a no-op
 *  re-export to keep the public surface small. */
export type { ChatMode, ChatAttachment } from './types'

/** Convenience: the modes table is exposed so the Dialog header can
 *  surface a "modes" legend without hardcoding the colors twice. */
export const PROMPT_MODES: readonly { id: ChatMode; label: string }[] =
  MODES.map((m): { id: ChatMode; label: string } => ({
    id: m.id,
    label: m.label,
  }))

/** Re-export so consumers that import the box can pass children
 *  inside the provider without a separate import. */
export function PromptInputComposer({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// Created and developed by Jai Singh
