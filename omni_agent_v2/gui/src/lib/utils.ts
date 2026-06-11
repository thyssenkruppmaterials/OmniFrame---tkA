// Created and developed by Jai Singh
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Idiomatic shadcn helper — merges Tailwind class strings while dedupping
 * conflicting utility families (the same `mt-*` class only wins once).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a duration in seconds as a compact "1h 02m" / "47m 12s" / "12s"
 * label. Used by the agent uptime display in the header bar.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  return `${secs}s`;
}

/**
 * "12s ago" / "3m ago" / "—" formatter for the heartbeat-age display.
 */
export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return "in the future";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Defensive JSON parse for fields that might arrive as a string from the
 * agent's older Pydantic shapes. Returns `fallback` on failure.
 */
export function tryParseJSON<T>(input: unknown, fallback: T): T {
  if (typeof input !== "string") return (input as T) ?? fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/**
 * Stable empty-array reference (avoids re-renders when memoised hooks
 * default to `[]`). Pair with `useMemo`/`useRef` where appropriate.
 */
export const EMPTY_ARRAY = Object.freeze([]) as readonly never[];

/**
 * "0 of 6 healthy" pluraliser.
 */
export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * Bound an integer between [min, max] inclusive.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Created and developed by Jai Singh
