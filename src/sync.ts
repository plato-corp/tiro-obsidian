import { normalizePath } from "obsidian";
import type { TFile } from "obsidian";
import { TiroApiError } from "./api";
import type { Note, TiroClient } from "./api";
import { buildFrontmatter, buildManagedBlock, formatFileName, mergeManaged } from "./format";
import type { BodyLabels } from "./format";

/** The slice of Obsidian's App that syncing needs, so it can be faked in tests. */
export interface SyncHost {
  vault: {
    getMarkdownFiles(): TFile[];
    getAbstractFileByPath(path: string): unknown;
    create(path: string, data: string): Promise<TFile>;
    createFolder(path: string): Promise<unknown>;
    process(file: TFile, fn: (data: string) => string): Promise<string>;
  };
  metadataCache: {
    getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null;
  };
  fileManager: {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  };
}

export interface SyncOptions {
  folder: string;
  fileNameFormat: string;
  includeTranscript: boolean;
  labels: BodyLabels;
  untitled: string;
  /** Number of recent notes a full sync looks at. */
  limit?: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Set when the run stopped early because of a key or rate-limit problem. */
  fatal?: TiroApiError;
}

export type NoteOutcome = "created" | "updated" | "skipped";

export class NoteSyncer {
  private running = false;

  constructor(
    private readonly host: SyncHost,
    private readonly client: TiroClient,
    private readonly getOptions: () => SyncOptions,
  ) {}

  get busy(): boolean {
    return this.running;
  }

  /** Syncs the most recent notes. Returns null if a sync is already running. */
  async syncRecent(): Promise<SyncResult | null> {
    if (this.running) return null;
    this.running = true;
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0 };
    try {
      const options = this.getOptions();
      const notes = await this.client.listRecentNotes(options.limit ?? 100);
      const index = this.indexByGuid();
      for (const note of notes) {
        try {
          const { outcome } = await this.syncNote(note, index, false);
          result[outcome] += 1;
        } catch (error) {
          result.failed += 1;
          if (error instanceof TiroApiError && error.kind !== "other") {
            result.fatal = error;
            break;
          }
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Fetches one note and writes it, even if it looks unchanged. Returns null if a sync is running. */
  async syncOne(guid: string): Promise<{ file: TFile; outcome: NoteOutcome; note: Note } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const note = await this.client.getNote(guid);
      const { file, outcome } = await this.syncNote(note, this.indexByGuid(), true);
      return { file, outcome, note };
    } finally {
      this.running = false;
    }
  }

  private indexByGuid(): Map<string, TFile> {
    const index = new Map<string, TFile>();
    for (const file of this.host.vault.getMarkdownFiles()) {
      const guid = this.host.metadataCache.getFileCache(file)?.frontmatter?.tiro_guid;
      if (typeof guid === "string" && guid && !index.has(guid)) index.set(guid, file);
    }
    return index;
  }

  private async syncNote(
    note: Note,
    index: Map<string, TFile>,
    force: boolean,
  ): Promise<{ file: TFile; outcome: NoteOutcome }> {
    const options = this.getOptions();
    const existing = index.get(note.guid);

    if (existing && !force) {
      const storedUpdated = this.host.metadataCache.getFileCache(existing)?.frontmatter?.updated;
      if (storedUpdated === note.updatedAt) return { file: existing, outcome: "skipped" };
    }

    const summary = await this.client.getSummaryMarkdown(note.guid);
    const transcript = options.includeTranscript ? await this.client.getTranscript(note.guid) : null;
    const block = buildManagedBlock(summary, transcript, options.labels);
    const fields = buildFrontmatter(note);

    let file: TFile;
    let outcome: NoteOutcome;
    if (existing) {
      file = existing;
      outcome = "updated";
      await this.host.vault.process(file, (data) => mergeManaged(data, block));
    } else {
      file = await this.createFile(note, block, options);
      outcome = "created";
      index.set(note.guid, file);
    }

    await this.host.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(fields)) frontmatter[key] = value;
    });
    return { file, outcome };
  }

  private async createFile(note: Note, block: string, options: SyncOptions): Promise<TFile> {
    const folder = normalizePath(options.folder || "Tiro");
    await this.ensureFolder(folder);
    const base = formatFileName(options.fileNameFormat, note, options.untitled);
    let path = normalizePath(`${folder}/${base}.md`);
    let counter = 2;
    while (this.host.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${base} (${counter}).md`);
      counter += 1;
    }
    return this.host.vault.create(path, `${block}\n`);
  }

  private async ensureFolder(folder: string): Promise<void> {
    let current = "";
    for (const segment of folder.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.host.vault.getAbstractFileByPath(current)) {
        await this.host.vault.createFolder(current);
      }
    }
  }
}
