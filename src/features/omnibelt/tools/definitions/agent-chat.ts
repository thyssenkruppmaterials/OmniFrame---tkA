// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat tool (v1, 2026-05-24 PM)
 *
 * Opens a rich chat dialog backed (eventually) by the OmniFrame
 * agent. v1 ships a stubbed agent reply path so the full UI surface —
 * morphing send button, image attachments, voice-recorder visualiser,
 * Search / Think / Canvas mode toggles — can be exercised end-to-end
 * before the real LLM wiring lands in v1.5.
 *
 * Permission: none — open to all users for v1. Add a gate (e.g.
 * `{ action: 'use', resource: 'agent_chat' }`) before exposing the
 * real backend so cost / abuse can be scoped per role.
 *
 * Shell lazy-loads (per existing convention) so the framer-motion
 * animations + Dialog primitives don't bloat the always-resident
 * `feature-omnibelt` chunk.
 */
import { IconMessageCircle } from '@tabler/icons-react'
import type { ToolDef } from '../registry'

export const agentChatTool: ToolDef = {
  id: 'agent_chat',
  label: 'Agent Chat',
  description: 'Chat with the OmniFrame agent',
  icon: IconMessageCircle,
  accent: 'violet',
  category: 'self',
  searchable: true,
  shell: () => import('../shells/agent-chat/AgentChatShell'),
}

// Created and developed by Jai Singh
