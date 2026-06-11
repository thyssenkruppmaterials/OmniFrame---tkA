// Created and developed by Jai Singh
import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, GitBranch, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { tauriApi } from "@/lib/tauri";
import type { BuildInfo } from "@/lib/types";

export function AboutPage() {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void tauriApi
      .getBuildInfo()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">About OmniAgent</h1>
        <p className="text-[12px] text-muted-foreground">
          The desktop control panel for the OmniFrame multi-session SAP
          agent. Supervises six concurrent SAP GUI sessions, dispatches
          quick actions, and streams console output from the local agent
          process.
        </p>
      </header>

      <Card>
        <CardHeader className="p-5 pb-3">
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <GitBranch className="h-3.5 w-3.5 text-info" />
            Build
          </CardTitle>
          <CardDescription>
            Reported by the Tauri backend at compile time. The build SHA is
            stamped into the binary via the `OMNIFRAME_BUILD_SHA` env var.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {error ? (
            <p className="text-[12px] text-destructive">{error}</p>
          ) : !info ? (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              <Row label="GUI version" value={info.version} />
              <Row label="Tauri runtime" value={info.tauri_version} />
              <Row label="Build SHA" mono value={info.build_sha} />
              <Row label="Built at" mono value={info.built_at} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-5 pb-3">
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            Licence
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-[12px] text-muted-foreground">
          Copyright © 2026 OmniFrame. Internal use only. Bundles Tauri 2
          (Apache 2.0), Radix UI (MIT), Tailwind CSS (MIT), and Lucide
          (ISC). Full third-party notices ship in the installer alongside
          the binary.
        </CardContent>
      </Card>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Internal · operator console</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open("/CHANGELOG.md", "_blank")}
        >
          <BookOpen className="h-3 w-3" />
          Changelog
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Button>
      </div>
    </main>
  );
}

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Row({ label, value, mono }: RowProps) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card/40 p-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={mono ? "font-mono text-[12px]" : "text-[13px]"}>
        {value}
      </span>
    </div>
  );
}

// Created and developed by Jai Singh
