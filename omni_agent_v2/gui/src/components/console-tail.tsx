// Created and developed by Jai Singh
import { Eraser, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConsoleTail } from "@/features/sessions/use-console-tail";
import type { ConsoleLine } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_CLASS: Record<string, string> = {
  trace: "text-muted-foreground",
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-warning",
  warning: "text-warning",
  error: "text-destructive",
  fatal: "text-destructive font-semibold",
};

function levelClass(level: string): string {
  return LEVEL_CLASS[level.toLowerCase()] ?? "text-foreground";
}

function formatTimestamp(iso: string): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return iso;
  const h = ts.getHours().toString().padStart(2, "0");
  const m = ts.getMinutes().toString().padStart(2, "0");
  const s = ts.getSeconds().toString().padStart(2, "0");
  const ms = ts.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

interface ConsoleTailProps {
  slotId: number;
  maxLines?: number;
  className?: string;
}

export function ConsoleTail({ slotId, maxLines = 200, className }: ConsoleTailProps) {
  const { lines, paused, setPaused, clear } = useConsoleTail({
    slotId,
    maxLines,
  });
  const viewportRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new lines unless the operator paused.
  useEffect(() => {
    if (paused) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  const grouped = useMemo(() => groupByLevel(lines), [lines]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background/60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Console · Slot {slotId + 1}</span>
          <span className="font-mono text-foreground">{lines.length}</span>
          <span className="hidden text-muted-foreground sm:inline">/</span>
          <span className="hidden font-mono text-muted-foreground sm:inline">
            {maxLines}
          </span>
          <span className="hidden text-muted-foreground/80 md:inline">·</span>
          <span className="hidden gap-2 md:flex">
            <LegendDot tone="text-warning" label={grouped.warn} />
            <LegendDot tone="text-destructive" label={grouped.error} />
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" size="xs" onClick={clear}>
            <Eraser className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div ref={viewportRef} className="h-full overflow-y-auto px-3 py-2">
          {lines.length === 0 ? (
            <EmptyState />
          ) : (
            <pre className="console-line m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
              {lines.map((line) => (
                <ConsoleLineRow key={line.seq} line={line} />
              ))}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ConsoleLineRow({ line }: { line: ConsoleLine }) {
  return (
    <div className={cn("flex items-baseline gap-2", levelClass(line.level))}>
      <span className="select-none text-muted-foreground/70">
        {formatTimestamp(line.ts)}
      </span>
      <span className="select-none uppercase text-[10px] text-muted-foreground">
        {line.level.toUpperCase().padEnd(5, " ")}
      </span>
      <span className="select-none text-muted-foreground/80">
        [{line.source}]
      </span>
      <span className="flex-1 break-all">{line.message}</span>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: string; label: number }) {
  if (label === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", tone, "bg-current")} />
      <span className="font-mono text-foreground">{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-center">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Idle
      </span>
      <span className="text-[12px] text-muted-foreground/80">
        Waiting for the next console line from the agent…
      </span>
    </div>
  );
}

function groupByLevel(lines: ConsoleLine[]): { warn: number; error: number } {
  let warn = 0;
  let error = 0;
  for (const line of lines) {
    const lvl = line.level.toLowerCase();
    if (lvl === "warn" || lvl === "warning") warn += 1;
    else if (lvl === "error" || lvl === "fatal") error += 1;
  }
  return { warn, error };
}

// Created and developed by Jai Singh
