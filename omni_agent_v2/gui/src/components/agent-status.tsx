// Created and developed by Jai Singh
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Cpu,
  Gauge,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentMetrics } from "@/features/agent/use-agent-metrics";
import { cn, formatRelative, formatUptime } from "@/lib/utils";

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
}

function Stat({ icon: Icon, label, value, hint, tone = "default" }: StatProps) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    info: "text-info",
  }[tone];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-muted/60">
            <Icon className={cn("h-4 w-4", toneClass)} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </span>
            <span className="font-mono text-[15px] font-semibold">
              {value}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      {hint ? <TooltipContent>{hint}</TooltipContent> : null}
    </Tooltip>
  );
}

export function AgentStatusStrip() {
  const { data: metrics } = useAgentMetrics();
  const jobs = metrics?.jobs;
  const helper = metrics?.helper;
  const ws = metrics?.ws_status;
  const healthy = metrics?.healthy_slots ?? 0;
  const total = metrics?.total_slots ?? 6;

  return (
    <Card className="grid grid-cols-2 divide-x divide-border md:grid-cols-3 lg:grid-cols-6">
      <Stat
        icon={CheckCircle2}
        label="Healthy slots"
        value={`${healthy}/${total}`}
        hint={
          healthy === total
            ? "All session slots are healthy."
            : `${total - healthy} slot(s) need attention.`
        }
        tone={healthy === total ? "success" : "warning"}
      />
      <Stat
        icon={Briefcase}
        label="In flight"
        value={jobs?.jobs_in_flight ?? 0}
        hint={`${jobs?.jobs_in_flight ?? 0} job(s) currently executing across slots.`}
        tone="info"
      />
      <Stat
        icon={Workflow}
        label="Jobs / hr"
        value={jobs?.jobs_processed_1h ?? 0}
        hint="Jobs completed in the last rolling hour."
      />
      <Stat
        icon={TriangleAlert}
        label="Errors / hr"
        value={jobs?.jobs_errored_1h ?? 0}
        tone={(jobs?.jobs_errored_1h ?? 0) > 0 ? "destructive" : "default"}
        hint="Jobs that ended in `failed` in the last rolling hour."
      />
      <Stat
        icon={Gauge}
        label="Avg job"
        value={
          jobs?.avg_job_ms
            ? `${(jobs.avg_job_ms / 1000).toFixed(1)}s`
            : "—"
        }
        hint="Rolling mean wall-clock duration of recently-completed jobs."
      />
      <Stat
        icon={helper?.running ? Cpu : AlertTriangle}
        label="Helper"
        value={
          helper?.running
            ? `pid ${helper.pid ?? "—"}`
            : "down"
        }
        tone={helper?.running ? "success" : "destructive"}
        hint={
          helper?.running
            ? `Python helper running, ${helper.restart_count ?? 0} restart(s).`
            : `Helper not running. Last restart: ${formatRelative(helper?.last_restart_at)}`
        }
      />
      <div className="col-span-2 hidden items-center gap-3 px-4 py-3 md:flex md:col-span-3 lg:col-span-6 lg:border-t lg:border-border">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-info" />
          {ws?.connected
            ? `Live · rust-work-service /ws · last message ${formatRelative(ws.last_message_at)}`
            : `Offline · reconnect attempts: ${ws?.reconnect_count ?? 0} · ${ws?.last_reconnect_reason ?? "no last error"}`}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Uptime{" "}
          <span className="font-mono text-foreground">
            {formatUptime(metrics?.uptime_seconds ?? 0)}
          </span>
        </span>
      </div>
    </Card>
  );
}

// Created and developed by Jai Singh
