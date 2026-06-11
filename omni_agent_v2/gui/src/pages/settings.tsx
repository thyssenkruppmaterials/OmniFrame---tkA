// Created and developed by Jai Singh
import * as React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Save, ShieldCheck, Terminal, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { tauriApi } from "@/lib/tauri";
import type { GuiSettings } from "@/lib/types";

const DEFAULT_VALUES: GuiSettings = {
  agent_base_url: "http://127.0.0.1:8765",
  service_key_path: "",
  log_directory: "",
  agent_token: undefined,
  theme: "dark",
  auto_promote_service_key: true,
};

export function SettingsPage() {
  const form = useForm<GuiSettings>({ defaultValues: DEFAULT_VALUES });

  useEffect(() => {
    let cancelled = false;
    void tauriApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        form.reset(settings);
      })
      .catch((err) => {
        toast.error("Failed to load settings", {
          description: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: GuiSettings) {
    try {
      await tauriApi.updateSettings(values);
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Failed to save settings", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function openLogs() {
    try {
      const path = await tauriApi.openLogDirectory();
      toast.success("Logs flushed", {
        description: path,
      });
    } catch (err) {
      toast.error("Could not flush logs", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-[12px] text-muted-foreground">
          Tweak how the GUI talks to the local agent. Most operators leave
          these untouched — they exist for the rare case where a corporate
          firewall, port collision, or service-key migration needs manual
          intervention.
        </p>
      </header>

      <form
        className="flex flex-col gap-5"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <Terminal className="h-3.5 w-3.5 text-info" />
              Agent control plane
            </CardTitle>
            <CardDescription>
              The HTTP endpoint exposed by the local agent. The default
              matches the v1 single-agent port.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <Field
              label="Base URL"
              hint="e.g. http://127.0.0.1:8765"
              {...form.register("agent_base_url", {
                required: "Base URL is required",
              })}
            />
            <Field
              label="Agent token (optional)"
              type="password"
              hint="Sent as Bearer for /admin endpoints that require operator auth."
              {...form.register("agent_token")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Service key
            </CardTitle>
            <CardDescription>
              The agent's persistent identity. The GUI does not modify the
              file — it just reports where the agent will look. Promotion
              status appears next to the path once Worker A's `/health`
              field lands.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <Field
              label="Service-key path"
              hint="Read-only display of `OMNIFRAME_AGENT_SERVICE_KEY_PATH`."
              readOnly
              {...form.register("service_key_path")}
            />
            <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-3">
              <div>
                <Label className="text-foreground">Auto-promote</Label>
                <p className="text-[11px] text-muted-foreground">
                  When the agent finds a `omni_sk_*` next to the EXE, copy it
                  into the canonical user-profile location and lock it down.
                </p>
              </div>
              <Switch
                checked={form.watch("auto_promote_service_key")}
                onCheckedChange={(checked) =>
                  form.setValue("auto_promote_service_key", checked, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
            <Badge
              variant={
                form.watch("auto_promote_service_key") ? "success" : "muted"
              }
            >
              {form.watch("auto_promote_service_key")
                ? "Will auto-promote on next boot"
                : "Manual promotion required"}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <FolderOpen className="h-3.5 w-3.5 text-warning" />
              Logs
            </CardTitle>
            <CardDescription>
              The on-disk location where the agent rotates per-slot log
              files. The "Flush & open" button asks the agent to fsync any
              buffered lines so the folder contents are current.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <Field
              label="Log directory"
              hint="`OMNIFRAME_AGENT_LOG_DIR`; falls back to a per-OS default."
              readOnly
              {...form.register("log_directory")}
            />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void openLogs()}
              >
                <FolderOpen className="h-3 w-3" /> Flush &amp; open logs
              </Button>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
          >
            Discard
          </Button>
          <Button type="submit" disabled={!form.formState.isDirty}>
            <Save className="h-3 w-3" /> Save changes
          </Button>
        </div>
      </form>
    </main>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hint, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id ?? props.name}>{label}</Label>
      <Input
        id={props.id ?? props.name}
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        {...props}
      />
      {hint ? (
        <p className="text-[10.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  ),
);
Field.displayName = "Field";

// Created and developed by Jai Singh
