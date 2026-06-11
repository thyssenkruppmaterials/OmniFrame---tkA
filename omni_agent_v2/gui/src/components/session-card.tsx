// Created and developed by Jai Singh
import { motion } from "framer-motion";
import {
  AlertCircle,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Loader2,
  Pin,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SessionSlot, SlotState } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";

const STATE_META: Record<
  SlotState,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    pillClass: string;
    cardAccent: string;
  }
> = {
  empty: {
    label: "Empty",
    icon: CircleDashed,
    pillClass:
      "bg-muted text-muted-foreground border-transparent",
    cardAccent: "ring-1 ring-inset ring-border/60",
  },
  connecting: {
    label: "Connecting",
    icon: Loader2,
    pillClass:
      "bg-info/15 text-info border-info/30",
    cardAccent: "ring-1 ring-inset ring-info/30",
  },
  idle: {
    label: "Idle",
    icon: CircleDot,
    pillClass:
      "bg-success/15 text-success border-success/30",
    cardAccent: "ring-1 ring-inset ring-success/25",
  },
  busy: {
    label: "Busy",
    icon: Sparkles,
    pillClass:
      "bg-primary/15 text-primary border-primary/30",
    cardAccent:
      "ring-1 ring-inset ring-primary/40 shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    pillClass:
      "bg-destructive/15 text-destructive border-destructive/40",
    cardAccent: "ring-1 ring-inset ring-destructive/40",
  },
  disconnected: {
    label: "Offline",
    icon: CircleSlash,
    pillClass:
      "bg-warning/15 text-warning border-warning/30",
    cardAccent: "ring-1 ring-inset ring-warning/30",
  },
};

interface SessionCardProps {
  slot: SessionSlot;
  selected?: boolean;
  onSelect?: (slotId: number) => void;
  hotkey?: string;
}

export function SessionCard({
  slot,
  selected = false,
  onSelect,
  hotkey,
}: SessionCardProps) {
  const meta = STATE_META[slot.state];
  const StateIcon = meta.icon;
  const userLabel = slot.sap_user
    ? `${slot.sap_user}${slot.sap_system ? `@${slot.sap_system}` : ""}`
    : "— no session pinned";

  return (
    <motion.button
      type="button"
      layout
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onClick={() => onSelect?.(slot.slot_id)}
      className={cn(
        "group relative w-full text-left focus-visible:outline-none",
      )}
    >
      <Card
        className={cn(
          "flex h-full flex-col gap-3 p-4 transition-colors",
          meta.cardAccent,
          selected
            ? "bg-card shadow-elev-2 ring-2 ring-inset ring-primary"
            : "hover:bg-card/80",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              Slot {slot.slot_id + 1}
            </span>
            {slot.pinned ? (
              <Badge variant="outline" className="gap-1">
                <Pin className="h-2.5 w-2.5" />
                Pinned
              </Badge>
            ) : null}
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              meta.pillClass,
            )}
          >
            <StateIcon
              className={cn(
                "h-2.5 w-2.5",
                slot.state === "connecting" ? "animate-spin" : "",
              )}
            />
            {meta.label}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {userLabel}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {slot.sap_client ? `CLNT ${slot.sap_client}` : ""}
            {typeof slot.conn_idx === "number" &&
            typeof slot.sess_idx === "number"
              ? `${slot.sap_client ? " · " : ""}c${slot.conn_idx}/s${slot.sess_idx}`
              : ""}
          </span>
        </div>

        <Separator className="opacity-50" />

        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Last op</span>
            <span className="truncate font-mono">
              {slot.last_operation ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">When</span>
            <span className="font-mono">
              {formatRelative(slot.last_operation_ts)}
            </span>
          </div>
          {slot.current_action ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">In flight</span>
              <span className="inline-flex items-center gap-1 truncate font-mono text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                {slot.current_action.action}
                {slot.current_action.step
                  ? ` · ${slot.current_action.step}`
                  : ""}
              </span>
            </div>
          ) : null}
          {slot.last_error ? (
            <div className="mt-1 truncate rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive">
              {slot.last_error}
            </div>
          ) : null}
        </div>

        {typeof slot.current_action?.progress_pct === "number" ? (
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${Math.max(2, Math.min(100, slot.current_action.progress_pct))}%`,
              }}
            />
          </div>
        ) : null}

        {hotkey ? (
          <span className="absolute right-3 top-3 hidden font-mono text-[10px] text-muted-foreground group-hover:inline-block">
            {hotkey}
          </span>
        ) : null}
      </Card>
    </motion.button>
  );
}

// Created and developed by Jai Singh
