// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat shell (lazy entry)
 *
 * Thin wrapper that opens `<AgentChatDialog>` when mounted. The
 * dialog owns its own state; closing it propagates back through
 * `onOpenChange` → the parent OmniBelt panel's `onClose` so the
 * panel collapses alongside the dialog.
 *
 * Kept intentionally minimal because the panel's `<Suspense>`
 * boundary expects a default-export component matching
 * `ToolShellProps` — the real chat surface lives in
 * `<AgentChatDialog>` so it can be tested + re-mounted in isolation.
 */
import type { ToolShellProps } from '../../registry'
import { AgentChatDialog } from './AgentChatDialog'

export default function AgentChatShell({ onClose }: ToolShellProps) {
  return (
    <AgentChatDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    />
  )
}

// Created and developed by Jai Singh
