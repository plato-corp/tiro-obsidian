import { ItemView, Platform, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { Note } from "./api";
import { formatDuration } from "./format";
import { collectGuids, describeAge, summarizeSync } from "./panel-logic";
import type { StringKey } from "./i18n";
import type TiroPlugin from "./main";

export const VIEW_TYPE_TIRO = "tiro-panel";
const DEBOUNCE_MS = 300;
const RECENT_COUNT = 20;

export class TiroPanelView extends ItemView {
  private recordingMode: "live" | "offline" = "live";
  private notes: Note[] = [];
  private notesError = "";
  private loading = false;
  private query = "";
  private sequence = 0;
  private debounce: number | null = null;
  private listEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TiroPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TIRO;
  }

  getDisplayText(): string {
    return "Tiro";
  }

  getIcon(): string {
    return "mic";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tiro-panel");
    this.render();
    await this.loadNotes();
  }

  onClose(): Promise<void> {
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    return Promise.resolve();
  }

  /** Redraws from current state without touching the network. */
  render(): void {
    const el = this.contentEl;
    el.empty();
    this.listEl = null;
    const connected = this.plugin.isConnected();

    if (Platform.isDesktopApp) this.renderRecording(el);
    if (!connected) {
      this.renderSignedOut(el);
      return;
    }
    this.renderSync(el);
    this.renderNotes(el);
  }

  /** Redraws and reloads the note list. */
  async refresh(): Promise<void> {
    this.render();
    await this.loadNotes();
  }

  private t(key: StringKey, vars?: Record<string, string | number>): string {
    return this.plugin.t(key, vars);
  }

  private heading(parent: HTMLElement, text: string): HTMLElement {
    const row = parent.createDiv({ cls: "tiro-panel-heading" });
    row.createSpan({ text });
    return row;
  }

  private ageText(at: number): string {
    const { unit, count } = describeAge(Date.now(), at);
    switch (unit) {
      case "now":
        return this.t("ageNow");
      case "minutes":
        return this.t("ageMinutes", { n: count });
      case "hours":
        return this.t("ageHours", { n: count });
      default:
        return this.t("ageDays", { n: count });
    }
  }

  private renderRecording(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "tiro-panel-section tiro-rec" });
    const top = section.createDiv({ cls: "tiro-rec-top" });
    const labelId = `tiro-rec-mode-${Math.random().toString(36).slice(2)}`;
    top.createSpan({ cls: "tiro-sr-only", text: this.t("recMode"), attr: { id: labelId } });
    const modes = top.createDiv({ cls: "tiro-rec-modes", attr: { role: "group", "aria-labelledby": labelId } });
    const help = top.createSpan({ cls: "tiro-rec-help", attr: { title: this.t("recHint"), "aria-label": this.t("recHint"), tabindex: "0" } });
    setIcon(help, "info");
    const body = section.createDiv({ cls: "tiro-rec-body" });
    const modeButtons: HTMLButtonElement[] = [];
    const draw = (animate = false) => {
      body.empty();
      const live = this.recordingMode === "live";
      modes.dataset.mode = this.recordingMode;
      modeButtons.forEach((btn, i) => {
        const selected = i === (live ? 0 : 1);
        btn.toggleClass("is-active", selected);
        btn.setAttribute("aria-pressed", String(selected));
      });
      const actions = body.createDiv({ cls: "tiro-recording-actions" });
      const add = (label: StringKey, full: StringKey, icon: string, action: import("./recording-links").RecordingAction, primary = false) => {
        const target = primary ? actions : actions.querySelector<HTMLElement>(".tiro-rec-secondary-actions") ?? actions.createDiv({ cls: "tiro-rec-secondary-actions" });
        const btn = target.createEl("button", { cls: primary ? "tiro-rec-start mod-cta" : "tiro-rec-secondary",
          attr: { title: this.t(full), "aria-label": this.t(full) } });
        setIcon(btn.createSpan({ cls: "tiro-rec-icon", attr: { "aria-hidden": "true" } }), icon);
        btn.createSpan({ text: this.t(label) });
        btn.addEventListener("click", () => this.plugin.requestRecording(action));
      };
      add("recStartShort", live ? "recStartLive" : "recStartOffline", "mic", live ? "start-live" : "start-offline", true);
      if (live) add("recPauseShort", "recPauseLive", "pause", "pause-live");
      add("recFinishShort", live ? "recEndLive" : "recEndOffline", "square", live ? "end-live" : "end-offline");
      body.createDiv({ cls: "tiro-rec-hint", text: this.t(live ? "recLiveHint" : "recOfflineHint") });
      if (animate) {
        body.getAnimations().forEach(animation => animation.cancel());
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        body.animate(reduced ? [{ opacity: .4 }, { opacity: 1 }] : [
          { opacity: .4, transform: `translateX(${live ? -6 : 6}px)` }, { opacity: 1, transform: "translateX(0)" },
        ], { duration: reduced ? 120 : 180, easing: "ease-out" });
      }
    };
    for (const mode of ["live", "offline"] as const) {
      const btn = modes.createEl("button", { text: this.t(mode === "live" ? "recModeLive" : "recModeOffline") });
      modeButtons.push(btn);
      btn.addEventListener("click", () => {
        if (mode === this.recordingMode) return;
        this.recordingMode = mode;
        draw(true);
      });
    }
    draw();
  }

  private renderSignedOut(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "tiro-panel-section" });
    if (Platform.isDesktopApp) {
      section.createDiv({ cls: "tiro-panel-hint", text: this.t("panelSignedOutDesktop") });
      const button = section.createEl("button", { text: this.t("btnSignIn"), cls: "mod-cta" });
      button.addEventListener("click", () => {
        void this.plugin.signIn();
      });
    } else {
      section.createDiv({ cls: "tiro-panel-hint", text: this.t("panelSignedOutMobile") });
    }
  }

  private renderSync(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "tiro-panel-section tiro-sync-section" });
    const head = this.heading(section, this.t("panelSync"));
    const busy = this.plugin.isSyncing();
    const button = head.createEl("button", {
      text: this.t(busy ? "btnSyncing" : "btnSyncNow"),
      cls: "tiro-sync-button",
    });
    button.disabled = busy;
    button.addEventListener("click", () => {
      void this.plugin.syncNotes();
    });

    const last = this.plugin.panelState.lastSync;
    if (!last) {
      section.createDiv({ cls: "tiro-panel-status", text: this.t("panelNeverSynced") });
    } else {
      section.createDiv({ cls: "tiro-panel-status", text: this.t("panelLastSync", { when: this.ageText(last.at) }) });
      section.createDiv({
        cls: last.error ? "tiro-panel-status tiro-panel-error" : "tiro-panel-status",
        text: last.error ? this.t("syncFailed", { message: last.error }) : this.t("panelSyncSummary", { ...summarizeSync(last) }),
      });
    }
    section.createDiv({
      cls: "tiro-panel-hint",
      text: this.t("panelFolder", { folder: this.plugin.settings.syncFolder || "Tiro" }),
    });
  }

  private renderNotes(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "tiro-panel-section" });
    const head = this.heading(section, this.t("panelNotes"));
    const refresh = head.createEl("button", {
      cls: "clickable-icon tiro-panel-icon",
      attr: { "aria-label": this.t("panelRefresh") },
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => {
      void this.loadNotes();
    });

    const input = section.createEl("input", {
      type: "search",
      cls: "tiro-panel-search",
      attr: { placeholder: this.t("searchPlaceholder"), spellcheck: "false" },
    });
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      if (this.debounce !== null) window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => {
        void this.loadNotes();
      }, DEBOUNCE_MS);
    });

    this.listEl = section.createDiv({ cls: "tiro-panel-list" });
    this.renderList();
  }

  private async loadNotes(): Promise<void> {
    if (!this.plugin.isConnected()) return;
    const mine = ++this.sequence;
    const keyword = this.query.trim();
    this.loading = true;
    this.notesError = "";
    this.renderList();
    try {
      const notes = keyword
        ? await this.plugin.client.searchNotes(keyword)
        : await this.plugin.client.listRecentNotes(RECENT_COUNT);
      if (mine !== this.sequence) return;
      this.notes = notes;
    } catch (error) {
      if (mine !== this.sequence) return;
      this.notes = [];
      this.notesError = error instanceof Error ? error.message : String(error);
    }
    this.loading = false;
    this.renderList();
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    if (this.loading) {
      list.createDiv({ cls: "tiro-panel-hint", text: this.t("panelLoading") });
      return;
    }
    if (this.notesError) {
      list.createDiv({ cls: "tiro-panel-error", text: this.notesError });
      return;
    }
    if (this.notes.length === 0) {
      list.createDiv({ cls: "tiro-panel-hint", text: this.t("searchEmpty") });
      return;
    }
    const guids = collectGuids(
      this.app.vault.getMarkdownFiles().map((file) => this.app.metadataCache.getFileCache(file)?.frontmatter),
    );
    list.createDiv({
      cls: "tiro-panel-subheading",
      text: this.t(this.query.trim() ? "panelResults" : "panelRecent"),
    });
    for (const note of this.notes) this.renderRow(list, note, guids.has(note.guid));
  }

  private renderRow(list: HTMLElement, note: Note, inVault: boolean): void {
    const row = list.createDiv({ cls: "tiro-panel-row", attr: { role: "button", tabindex: "0" } });
    const open = (): void => {
      void this.plugin.openNote(note);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    const main = row.createDiv({ cls: "tiro-panel-row-main" });
    const title = main.createDiv({ cls: "tiro-panel-row-title" });
    if (inVault) {
      const mark = title.createSpan({ cls: "tiro-panel-mark", attr: { "aria-label": this.t("panelInVault") } });
      setIcon(mark, "check");
    }
    title.createSpan({ cls: "tiro-panel-row-text", text: note.title?.trim() || this.t("untitled") });

    const date = new Date(note.createdAt);
    const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(this.plugin.locale);
    const meta = [when, formatDuration(note.recordingDurationSeconds)].filter(Boolean).join(" · ");
    main.createDiv({ cls: "tiro-panel-row-meta", text: meta });

    if (note.webUrl) {
      const web = row.createEl("button", {
        cls: "clickable-icon tiro-panel-icon",
        attr: { "aria-label": this.t("panelOpenWeb") },
      });
      setIcon(web, "external-link");
      web.addEventListener("click", (event) => {
        event.stopPropagation();
        window.open(note.webUrl);
      });
      web.addEventListener("keydown", (event) => event.stopPropagation());
    }
  }
}
