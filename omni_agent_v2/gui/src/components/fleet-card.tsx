// Created and developed by Jai Singh
import { CircleDot, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentMetrics } from "@/features/agent/use-agent-metrics";
import type { FleetMember } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";

export function FleetCard() {
  const { data: metrics } = useAgentMetrics();
  const fleet = metrics?.fleet ?? [];

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          <Users className="h-3.5 w-3.5 text-info" />
          Fleet · {fleet.length} agent{fleet.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full">
          <ul className="divide-y divide-border">
            {fleet.length === 0 ? (
              <li className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                No peer agents reporting in.
                <br />
                Make sure rust-work-service is reachable.
              </li>
            ) : null}
            {fleet.map((member) => (
              <FleetRow key={member.agent_id} member={member} />
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function FleetRow({ member }: { member: FleetMember }) {
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5",
        member.is_self && "bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2">
        <CircleDot
          className={cn(
            "h-3 w-3",
            member.healthy ? "text-success animate-pulse-soft" : "text-destructive",
          )}
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-[12px] font-medium">
            {member.display_label ?? member.agent_id}
            {member.is_self ? (
              <span className="ml-2 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                this host
              </span>
            ) : null}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelative(member.last_seen_at)}
          </span>
        </div>
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        <span className="text-foreground">{member.slots_busy}</span>/
        {member.slots_total}
      </div>
    </li>
  );
}

// Created and developed by Jai Singh
