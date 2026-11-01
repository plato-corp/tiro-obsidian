import type { SyncResult } from "./sync";
import type { SyncStatus } from "./panel-state";

export type AgeUnit = "now" | "minutes" | "hours" | "days";

/** Splits the time since `then` into a unit and a count, so callers can pick the wording. */
export function describeAge(now: number, then: number): { unit: AgeUnit; count: number } {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return { unit: "now", count: 0 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}

export interface SyncSummary {
  created: number;
  updated: number;
  failed: number;
}

export function summarizeSync(result: Pick<SyncResult, "created" | "updated" | "failed">): SyncSummary {
  return { created: result.created, updated: result.updated, failed: result.failed };
}

/** The set of Tiro note ids that already exist in the vault, from each file's frontmatter. */
export function collectGuids(frontmatters: Iterable<Record<string, unknown> | null | undefined>): Set<string> {
  const guids = new Set<string>();
  for (const frontmatter of frontmatters) {
    const guid = frontmatter?.tiro_guid;
    if (typeof guid === "string" && guid) guids.add(guid);
  }
  return guids;
}

/** Pulls a valid `lastSync` out of raw plugin data; anything malformed is dropped. */
export function parseLastSync(data: unknown): SyncStatus | null {
  const raw = (data as { lastSync?: unknown } | null | undefined)?.lastSync;
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.at !== "number" || typeof v.created !== "number" || typeof v.updated !== "number" || typeof v.failed !== "number") {
    return null;
  }
  const out: SyncStatus = { at: v.at, created: v.created, updated: v.updated, failed: v.failed };
  if (typeof v.error === "string") out.error = v.error;
  return out;
}

/** The object written to plugin data: settings plus the last sync record, sharing one file. */
export function buildSavedData<T extends object>(settings: T, lastSync: SyncStatus | null): T & { lastSync?: SyncStatus } {
  return lastSync ? { ...settings, lastSync } : { ...settings };
}

/** Splits loaded plugin data into settings (without `lastSync`) and the sync record. */
export function splitSavedData<T extends object>(data: (T & { lastSync?: unknown }) | null | undefined): {
  settings: Partial<T>;
  lastSync: SyncStatus | null;
} {
  const { lastSync: _drop, ...settings } = (data ?? {}) as T & { lastSync?: unknown };
  void _drop;
  return { settings: settings as Partial<T>, lastSync: parseLastSync(data) };
}
