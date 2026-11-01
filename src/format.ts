import type { Note } from "./api";

export const START_MARKER = "%% tiro:start %%";
export const END_MARKER = "%% tiro:end %%";

/** Replaces characters that file names can't contain and trims awkward edges. */
export function sanitizeFileName(name: string): string {
  const withoutControls = Array.from(name)
    .map((char) => (char.charCodeAt(0) < 32 ? "-" : char))
    .join("");
  const cleaned = withoutControls
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "");
  return cleaned.slice(0, 120).trim() || "Untitled";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local calendar date parts of an ISO timestamp. */
function dateParts(iso: string): { YYYY: string; MM: string; DD: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { YYYY: "0000", MM: "00", DD: "00" };
  return { YYYY: String(date.getFullYear()), MM: pad(date.getMonth() + 1), DD: pad(date.getDate()) };
}

/** Builds a file name (without extension) from a pattern using YYYY, MM, DD and title. */
export function formatFileName(pattern: string, note: Pick<Note, "title" | "createdAt">, untitled = "Untitled"): string {
  const { YYYY, MM, DD } = dateParts(note.createdAt);
  const title = note.title?.trim() || untitled;
  const pattern_ = pattern.trim() || "YYYY-MM-DD title";
  const filled = pattern_
    .split("title")
    .map((part) => part.replace(/YYYY/g, YYYY).replace(/MM/g, MM).replace(/DD/g, DD))
    .join(title);
  return sanitizeFileName(filled);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function participantNames(note: Pick<Note, "participants">): string[] {
  const names: string[] = [];
  for (const person of note.participants ?? []) {
    const label = person.name?.trim() || person.email?.trim();
    if (label && !names.includes(label)) names.push(label);
  }
  return names;
}

export type FrontmatterValue = string | string[];

/** The frontmatter fields the plugin owns, in order. */
export function buildFrontmatter(note: Note): Record<string, FrontmatterValue> {
  return {
    tiro_guid: note.guid,
    title: note.title,
    created: note.createdAt,
    updated: note.updatedAt,
    source_type: note.sourceType,
    duration: formatDuration(note.recordingDurationSeconds),
    participants: participantNames(note),
    tiro_url: note.webUrl,
  };
}

export interface BodyLabels {
  summary: string;
  transcript: string;
  noContent: string;
}

function neutralizeMarkers(text: string): string {
  return text.replace(/%%(\s*tiro:)/g, "%​%$1");
}

/** The plugin-managed block, markers included. */
export function buildManagedBlock(
  summary: string | null,
  transcript: string | null,
  labels: BodyLabels,
): string {
  const parts: string[] = [];
  if (summary?.trim()) parts.push(`## ${labels.summary}\n${neutralizeMarkers(summary.trim())}`);
  if (transcript?.trim()) parts.push(`## ${labels.transcript}\n${neutralizeMarkers(transcript.trim())}`);
  if (parts.length === 0) parts.push(labels.noContent);
  return `${START_MARKER}\n${parts.join("\n\n")}\n${END_MARKER}`;
}

/**
 * Puts a managed block into existing file content. Text outside the markers is kept.
 * A file without markers keeps all of its text and gets the block appended.
 */
export function mergeManaged(existing: string, block: string): string {
  const start = existing.indexOf(START_MARKER);
  const end = start === -1 ? -1 : existing.indexOf(END_MARKER, start + START_MARKER.length);
  if (start !== -1 && end !== -1) {
    return existing.slice(0, start) + block + existing.slice(end + END_MARKER.length);
  }
  if (existing.trim() === "") return `${block}\n`;
  // Leave frontmatter and user text exactly as they are.
  return `${existing.replace(/\s+$/, "")}\n\n${block}\n`;
}

/** Strips tags from a search snippet so it can be shown as plain text. */
export function plainSnippet(snippet: string): string {
  return snippet.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
