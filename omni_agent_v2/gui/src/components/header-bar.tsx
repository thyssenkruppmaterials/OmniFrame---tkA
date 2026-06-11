// Created and developed by Jai Singh
import {
  Activity,
  CircleDot,
  Cog,
  Info,
  Layers,
  RadioTower,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAgentMetrics } from "@/features/agent/use-agent-metrics";
import { useWsStatus } from "@/features/agent/use-ws-status";
import { cn, formatUptime } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Master", icon: Layers },
  { to: "/settings", label: "Settings", icon: Cog },
  { to: "/about", label: "About", icon: Info },
] as const;

export function HeaderBar() {
  const metrics = useAgentMetrics();
  const ws = useWsStatus();

  const healthy = metrics.data?.healthy_slots ?? 0;
  const total = metrics.data?.total_slots ?? 6;
  const wsConnected = (ws.data?.connected ?? metrics.data?.ws_status.connected) ?? false;
  const version = metrics.data?.agent_version ?? "v2.0.0-alpha";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/65">
      <div className="flex h-14 items-center gap-4 px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground shadow-elev-2">
            <RadioTower className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-tight">
              OmniAgent
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Master Control
            </span>
          </div>
        </Link>

        <Badge variant="outline" className="font-mono text-[10px]">
          {version}
        </Badge>

        <Separator orientation="vertical" className="h-6" />

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-[12px]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1">
                <CircleDot
                  className={cn(
                    "h-3 w-3",
                    wsConnected
                      ? "text-success animate-pulse-soft"
                      : "text-destructive",
                  )}
                />
                <span className="text-foreground">
                  {wsConnected ? "WS connected" : "WS offline"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {ws.data?.url ?? "rust-work-service /ws"}
              <br />
              Reconnects: {ws.data?.reconnect_count ?? 0}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1">
                <Activity className="h-3 w-3 text-info" />
                <span className="font-mono">
                  {healthy}/{total} slots
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {healthy} of {total} session slots are healthy
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="hidden items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1 md:flex">
                <span className="text-muted-foreground">Uptime</span>
                <span className="font-mono">
                  {formatUptime(metrics.data?.uptime_seconds ?? 0)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Agent process uptime</TooltipContent>
          </Tooltip>

          <ThemeToggle />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild>
                <Link to="/settings" aria-label="Settings">
                  <Cog className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Settings <Kbd className="ml-2">⌘,</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

// Created and developed by Jai Singh
