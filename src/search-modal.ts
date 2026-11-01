import { Notice, SuggestModal } from "obsidian";
import type { App } from "obsidian";
import type { Note, TiroClient } from "./api";
import { formatDuration, plainSnippet } from "./format";
import type { Locale } from "./i18n";
import { translate } from "./i18n";

const DEBOUNCE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class NoteSearchModal extends SuggestModal<Note> {
  private sequence = 0;
  private last: Note[] = [];
  private recent: Note[] | null = null;

  constructor(
    app: App,
    private readonly client: TiroClient,
    private readonly locale: Locale,
    private readonly onChoose: (note: Note) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(translate(locale, "searchPlaceholder"));
    this.emptyStateText = translate(locale, "searchEmpty");
  }

  async getSuggestions(query: string): Promise<Note[]> {
    const mine = ++this.sequence;
    const keyword = query.trim();
    try {
      if (!keyword) {
        if (!this.recent) this.recent = await this.client.listRecentNotes(20);
        this.last = this.recent;
        return this.recent;
      }
      await sleep(DEBOUNCE_MS);
      if (mine !== this.sequence) return this.last;
      const notes = await this.client.searchNotes(keyword);
      if (mine !== this.sequence) return this.last;
      this.last = notes;
      return notes;
    } catch (error) {
      if (mine === this.sequence) new Notice(error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  renderSuggestion(note: Note, el: HTMLElement): void {
    el.addClass("tiro-suggestion");
    el.createDiv({ cls: "tiro-suggestion-title", text: note.title?.trim() || translate(this.locale, "untitled") });
    const date = new Date(note.createdAt);
    const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(this.locale);
    const meta = [when, formatDuration(note.recordingDurationSeconds)].filter(Boolean).join(" · ");
    el.createDiv({ cls: "tiro-suggestion-meta", text: meta });
    const snippet = note.matchedSnippets?.map(plainSnippet).find(Boolean);
    if (snippet) el.createDiv({ cls: "tiro-suggestion-snippet", text: snippet });
  }

  onChooseSuggestion(note: Note): void {
    void this.onChoose(note);
  }
}
