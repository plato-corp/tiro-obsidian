import { recordingUrl, type RecordingAction } from "./recording-links";
import { Notice, Platform, Plugin, getLanguage, moment } from "obsidian";
import { TiroPanelView, VIEW_TYPE_TIRO } from "./panel";
import type { PanelState } from "./panel-state";
import { TiroAuth, isSignedIn } from "./auth";
import { OAuthError } from "./oauth";
import type { Editor } from "obsidian";
import { TiroClient } from "./api";
import type { ApiErrorKind, Note } from "./api";
import { pickLocale, translate } from "./i18n";
import type { Locale, StringKey } from "./i18n";
import { buildSavedData, splitSavedData, summarizeSync } from "./panel-logic";
import { NoteSearchModal } from "./search-modal";
import { DEFAULT_SETTINGS, TiroSettingTab } from "./settings";
import type { TiroSettings } from "./settings";
import { NoteSyncer } from "./sync";
import type { SyncOptions } from "./sync";

function detectLocale(): Locale {
  // getLanguage() exists on newer app versions; older ones fall back to moment's locale.
  const code = typeof getLanguage === "function" ? getLanguage() : moment.locale();
  return pickLocale(code);
}

export default class TiroPlugin extends Plugin {
  settings: TiroSettings = { ...DEFAULT_SETTINGS };
  locale: Locale = "en";
  auth!: TiroAuth;
  client!: TiroClient;
  panelState: PanelState = { lastSync: null };
  private syncer!: NoteSyncer;
  private intervalId: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.locale = detectLocale();

    this.auth = new TiroAuth({
      load: () => this.settings.auth,
      save: async (state) => {
        this.settings.auth = state;
        await this.saveSettings();
      },
    });
    this.client = new TiroClient(
      // An API key, when set, wins over the sign-in token.
      () => Promise.resolve(this.settings.apiKey.trim() || this.auth.getAccessToken()),
      (kind, status, serverMessage) => this.errorText(kind, status, serverMessage),
    );
    this.syncer = new NoteSyncer(this.app, this.client, () => this.syncOptions());

    this.addSettingTab(new TiroSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_TIRO, (leaf) => new TiroPanelView(leaf, this));
    this.addRibbonIcon("mic", this.t("ribbonPanel"), () => {
      void this.activatePanel();
    });

    this.addCommand({
      id: "open-panel",
      name: this.t("cmdOpenPanel"),
      callback: () => {
        void this.activatePanel();
      },
    });

    this.addCommand({
      id: "toggle-panel",
      name: this.t("cmdTogglePanel"),
      callback: () => {
        const open = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIRO);
        if (open.length) open.forEach((leaf) => leaf.detach());
        else void this.activatePanel();
      },
    });

    this.addCommand({
      id: "sync-notes",
      name: this.t("cmdSync"),
      callback: () => {
        void this.syncNotes();
      },
    });

    this.addCommand({
      id: "search-notes",
      name: this.t("cmdSearch"),
      callback: () => {
        if (!this.requireKey()) return;
        new NoteSearchModal(this.app, this.client, this.locale, (note) => this.openNote(note)).open();
      },
    });

    this.addCommand({
      id: "insert-note-link",
      name: this.t("cmdInsertLink"),
      editorCallback: (editor: Editor) => {
        if (!this.requireKey()) return;
        new NoteSearchModal(this.app, this.client, this.locale, (note) => {
          const title = (note.title?.trim() || this.t("untitled")).replace(/[[\]]/g, "");
          editor.replaceSelection(`[${title}](${note.webUrl})`);
          new Notice(this.t("linkInserted", { title }));
        }).open();
      },
    });

    const recordingCommands = [
      ["start-live-note", "recStartLive", "start-live"],
      ["pause-live-note", "recPauseLive", "pause-live"],
      ["end-live-note", "recEndLive", "end-live"],
      ["start-offline-recording", "recStartOffline", "start-offline"],
      ["end-offline-recording", "recEndOffline", "end-offline"],
    ] as const;
    for (const [id, key, action] of recordingCommands) {
      this.addCommand({ id, name: this.t(key), checkCallback: (checking) => {
        if (!Platform.isDesktopApp) return false;
        if (!checking) this.requestRecording(action);
        return true;
      } });
    }
    this.scheduleAutoSync();
    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        if (this.isConnected()) void this.syncNotes();
      });
    }
  }

  requestRecording(action: RecordingAction): void {
    if (!Platform.isDesktopApp) return;
    try {
      const url = recordingUrl(action);
      if (Platform.isDesktop && Platform.isMacOS) {
        // Desktop-only require keeps Node modules out of the mobile load path.
        // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- guarded macOS desktop launch
        const { execFile } = require("node:child_process") as typeof import("node:child_process");
        execFile("/usr/bin/open", ["-g", url], (error) => {
          new Notice(this.t(error ? "recFailed" : "recRequested"));
        });
      } else {
        window.open(url);
        new Notice(this.t("recRequested"));
      }
    } catch {
      new Notice(this.t("recFailed"));
    }
  }

  t(key: StringKey, vars?: Record<string, string | number>): string {
    return translate(this.locale, key, vars);
  }

  async loadSettings(): Promise<void> {
    const { settings, lastSync } = splitSavedData<TiroSettings>((await this.loadData()) as never);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.panelState.lastSync = lastSync;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(buildSavedData(this.settings, this.panelState.lastSync));
  }

  /** (Re)registers the auto-sync timer from the current interval setting. */
  scheduleAutoSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const minutes = this.settings.syncIntervalMinutes;
    if (minutes > 0) {
      this.intervalId = this.registerInterval(
        window.setInterval(() => {
          if (this.isConnected()) void this.syncNotes(true);
        }, minutes * 60 * 1000),
      );
    }
  }

  private syncOptions(): SyncOptions {
    return {
      folder: this.settings.syncFolder,
      fileNameFormat: this.settings.fileNameFormat,
      includeTranscript: this.settings.includeTranscript,
      untitled: this.t("untitled"),
      labels: {
        summary: this.t("summaryHeading"),
        transcript: this.t("transcriptHeading"),
        noContent: this.t("noContent"),
      },
    };
  }

  private errorText(kind: ApiErrorKind, status: number, serverMessage?: string): string {
    switch (kind) {
      case "noKey":
        return this.t("errNoKey");
      case "unauthorized":
        return this.t("err401");
      case "forbidden":
        return this.t("err403");
      case "rateLimited":
        return this.t("err429");
      default:
        return serverMessage || this.t("errGeneric", { status });
    }
  }

  isConnected(): boolean {
    return Boolean(this.settings.apiKey.trim()) || isSignedIn(this.settings.auth);
  }

  /** Opens the browser sign-in and reports the result. Desktop only. */
  async signIn(): Promise<void> {
    try {
      await this.signInInner();
    } finally {
      await this.saveSettings();
      this.updatePanels(true);
    }
  }

  private async signInInner(): Promise<void> {
    try {
      await this.auth.signIn({
        openBrowser: (url) => {
          new Notice(this.t("signInOpened"));
          window.open(url);
        },
      });
      new Notice(this.t("signInDone"));
    } catch (error) {
      const code = error instanceof OAuthError ? error.code : error instanceof Error ? error.message : "unknown";
      if (code === "cancelled") new Notice(this.t("signInCancelled"));
      else if (code === "timeout") new Notice(this.t("signInTimeout"));
      else new Notice(this.t("signInFailed", { code }));
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    new Notice(this.t("signedOut"));
    this.updatePanels(true);
  }

  private requireKey(): boolean {
    if (this.isConnected()) return true;
    new Notice(this.t("noApiKey"));
    return false;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  isSyncing(): boolean {
    return this.syncer.busy;
  }

  async syncNotes(quiet = false): Promise<void> {
    if (!this.requireKey()) return;
    if (this.syncer.busy) {
      if (!quiet) new Notice(this.t("syncBusy"));
      return;
    }
    if (!quiet) new Notice(this.t("syncStart"));
    const running = this.syncer.syncRecent();
    this.updatePanels(false);
    try {
      const result = await running;
      if (!result) return;
      if (result.fatal) {
        this.panelState.lastSync = { at: Date.now(), ...summarizeSync(result), error: result.fatal.message };
        new Notice(this.t("syncFailed", { message: result.fatal.message }));
        return;
      }
      this.panelState.lastSync = { at: Date.now(), ...summarizeSync(result) };
      if (quiet && result.created + result.updated + result.failed === 0) return;
      const text = result.failed
        ? this.t("syncDoneFailed", { created: result.created, updated: result.updated, failed: result.failed })
        : this.t("syncDone", { created: result.created, updated: result.updated });
      new Notice(text);
    } catch (error) {
      this.panelState.lastSync = { at: Date.now(), created: 0, updated: 0, failed: 0, error: this.messageOf(error) };
      new Notice(this.t("syncFailed", { message: this.messageOf(error) }));
    } finally {
      this.updatePanels(true);
    }
  }

  async activatePanel(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TIRO)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      await right.setViewState({ type: VIEW_TYPE_TIRO, active: true });
      leaf = right;
    }
    await workspace.revealLeaf(leaf);
  }

  /** Redraws open panels; `reload` also refetches the note list. */
  private updatePanels(reload: boolean): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIRO)) {
      if (!(leaf.view instanceof TiroPanelView)) continue;
      if (reload) void leaf.view.refresh();
      else leaf.view.render();
    }
  }

  async openNote(note: Note): Promise<void> {
    try {
      const result = await this.syncer.syncOne(note.guid);
      if (!result) {
        new Notice(this.t("syncBusy"));
        return;
      }
      await this.app.workspace.getLeaf(false).openFile(result.file);
    } catch (error) {
      new Notice(this.t("syncFailed", { message: this.messageOf(error) }));
    }
  }
}
