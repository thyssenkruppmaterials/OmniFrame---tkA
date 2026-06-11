// Created and developed by Jai Singh
import { motion } from "framer-motion";
import {
  CircleStop,
  Link2,
  Link2Off,
  ListTree,
  Pin,
  PinOff,
  PlugZap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ConsoleTail } from "@/components/console-tail";
import { QuickActions } from "@/components/quick-actions";
import { sessionActions } from "@/features/sessions/session-actions";
import { useRecordingStatus } from "@/features/recording/use-recording-status";
import type { SapSession, SessionSlot } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";

interface SessionDetailProps {
  slot: SessionSlot;
}

export function SessionDetail({ slot }: SessionDetailProps) {
  const recording = useRecordingStatus();
  const isRecording = recording.recording && recording.slot_id === slot.slot_id;
  const isOnline =
    slot.state === "idle" ||
    slot.state === "busy" ||
    slot.state === "connecting";

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-3">
          <motion.div
            key={slot.slot_id}
            layout
            initial={{ opacity: 0.4, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 font-mono text-[12px] font-semibold text-primary"
          >
            {slot.slot_id + 1}
          </motion.div>
          <div className="flex flex-col leading-tight">
            <CardTitle className="text-[13px]">
              {slot.sap_user
                ? `${slot.sap_user}${slot.sap_system ? ` · ${slot.sap_system}` : ""}`
                : `Slot ${slot.slot_id + 1}`}
              {slot.sap_client ? (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  CLNT {slot.sap_client}
                </span>
              ) : null}
            </CardTitle>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide">
                {slot.state}
              </span>
              {slot.current_action ? (
                <>
                  <span>·</span>
                  <span className="text-primary">
                    {slot.current_action.action}
                    {slot.current_action.step
                      ? ` · ${slot.current_action.step}`
                      : ""}
                  </span>
                </>
              ) : null}
              {slot.last_operation_ts ? (
                <>
                  <span>·</span>
                  <span>{formatRelative(slot.last_operation_ts)}</span>
                </>
              ) : null}
            </div>
          </div>
          {isRecording ? (
            <Badge variant="destructive" className="animate-pulse-soft">
              ● REC
            </Badge>
          ) : null}
        </div>
        <SlotControls slot={slot} isOnline={isOnline} />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
        <QuickActions slotId={slot.slot_id} disabled={!isOnline} />
        <Separator />
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <ConsoleTail slotId={slot.slot_id} className="flex-1" />
        </div>
      </CardContent>
    </Card>
  );
}

interface SlotControlsProps {
  slot: SessionSlot;
  isOnline: boolean;
}

function SlotControls({ slot, isOnline }: SlotControlsProps) {
  const [pinOpen, setPinOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Pin className="h-3 w-3" /> Pin SAP
          </Button>
        </DialogTrigger>
        <PinSapDialog slotId={slot.slot_id} onClose={() => setPinOpen(false)} />
      </Dialog>

      {isOnline ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void sessionActions.disconnect(slot.slot_id)}
        >
          <Link2Off className="h-3 w-3" /> Disconnect
        </Button>
      ) : (
        <Button
          variant="success"
          size="sm"
          onClick={() => void sessionActions.connect(slot.slot_id)}
        >
          <PlugZap className="h-3 w-3" /> Connect
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void sessionActions.release(slot.slot_id)}
        className={cn("text-muted-foreground", !slot.pinned && "hidden md:inline-flex")}
      >
        {slot.pinned ? (
          <PinOff className="h-3 w-3" />
        ) : (
          <CircleStop className="h-3 w-3" />
        )}
        {slot.pinned ? "Release pin" : "Release"}
      </Button>
    </div>
  );
}

interface PinSapDialogProps {
  slotId: number;
  onClose: () => void;
}

function PinSapDialog({ slotId, onClose }: PinSapDialogProps) {
  const [sessions, setSessions] = useState<SapSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sessionActions
      .listSapSessions()
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function commit() {
    if (sessions == null || selectedIdx == null) return;
    const target = sessions[selectedIdx];
    if (!target) return;
    await sessionActions.pin(slotId, target.conn_idx, target.sess_idx);
    onClose();
  }

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ListTree className="h-4 w-4" />
          Pin an existing SAP GUI session
        </DialogTitle>
        <DialogDescription>
          Select one of the SAP sessions visible on this Windows host to bind to
          slot {slotId + 1}. The agent will reuse this session for every job
          dispatched against the slot.
        </DialogDescription>
      </DialogHeader>
      <Separator />
      <ScrollArea className="max-h-72 rounded-md border border-border">
        <div className="divide-y divide-border">
          {sessions === null && !error ? (
            <RowSkeleton />
          ) : null}
          {error ? (
            <div className="p-4 text-[12px] text-destructive">
              Failed to enumerate sessions: {error}
            </div>
          ) : null}
          {sessions?.length === 0 ? (
            <div className="p-4 text-[12px] text-muted-foreground">
              No SAP GUI sessions detected on this host. Open SAPLogon and try
              again.
            </div>
          ) : null}
          {sessions?.map((session, idx) => (
            <button
              key={`${session.conn_idx}-${session.sess_idx}`}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60",
                selectedIdx === idx && "bg-primary/10 text-foreground",
              )}
            >
              <div className="flex flex-col">
                <span className="font-mono text-[12px] font-medium">
                  c{session.conn_idx}/s{session.sess_idx}{" "}
                  {session.user ?? "?"}
                  {session.system ? `@${session.system}` : ""}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {session.transaction
                    ? `Tx ${session.transaction}`
                    : "No transaction"}
                  {session.session_title
                    ? ` · ${session.session_title}`
                    : ""}
                </span>
              </div>
              {typeof session.claimed_by_slot === "number" ? (
                <Badge variant="muted">
                  Pinned to slot {session.claimed_by_slot + 1}
                </Badge>
              ) : (
                <Link2 className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => void commit()}
          disabled={selectedIdx == null}
        >
          Pin to slot {slotId + 1}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="h-8 w-full animate-pulse rounded-md bg-muted/60"
        />
      ))}
    </div>
  );
}

// Created and developed by Jai Singh
