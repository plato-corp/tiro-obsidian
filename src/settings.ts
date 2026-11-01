import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import { isSignedIn } from "./auth";
import type { AuthState } from "./auth";
import type TiroPlugin from "./main";

export interface TiroSettings {
  apiKey: string;
  auth: AuthState;
  syncFolder: string;
  includeTranscript: boolean;
  fileNameFormat: string;
  syncOnStartup: boolean;
  syncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: TiroSettings = {
  apiKey: "",
  auth: {},
  syncFolder: "Tiro",
  includeTranscript: false,
  fileNameFormat: "YYYY-MM-DD title",
  syncOnStartup: false,
  syncIntervalMinutes: 0,
};

export const API_KEYS_URL = "https://tiro.ooo/platform/me/api-keys";

export class TiroSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TiroPlugin,
  ) {
    super(app, plugin);
  }

  private displayAccount(containerEl: HTMLElement, t: TiroPlugin["t"]): void {
    const plugin = this.plugin;
    const auth = plugin.auth.state;
    const signedIn = isSignedIn(auth);
    const setting = new Setting(containerEl).setName(t("setAccount"));

    if (!plugin.auth.canSignIn && !signedIn) {
      setting.setDesc(t("setAccountMobile"));
      return;
    }
    if (signedIn) {
      setting.setDesc(auth.email ? t("setAccountSignedInAs", { email: auth.email }) : t("setAccountSignedIn"));
      setting.addButton((button) =>
        button.setButtonText(t("btnSignOut")).onClick(async () => {
          await plugin.signOut();
          this.display();
        }),
      );
      return;
    }
    setting.setDesc(t("setAccountSignedOut"));
    setting.addButton((button) =>
      button
        .setButtonText(t("btnSignIn"))
        .setCta()
        .onClick(async () => {
          button.setDisabled(true).setButtonText(t("btnSigningIn"));
          await plugin.signIn();
          this.display();
        }),
    );
  }

  display(): void {
    const { containerEl } = this;
    const t = this.plugin.t.bind(this.plugin);
    containerEl.empty();

    this.displayAccount(containerEl, t);

    const keyDesc = new DocumentFragment();
    const [before, after = ""] = t("setApiKeyDesc", { url: "{link}" }).split("{link}");
    keyDesc.appendText(before);
    keyDesc.createEl("a", { text: API_KEYS_URL, href: API_KEYS_URL });
    keyDesc.appendText(after);

    new Setting(containerEl)
      .setName(t("setApiKey"))
      .setDesc(keyDesc)
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.setPlaceholder("API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName(t("setSync")).setHeading();

    new Setting(containerEl)
      .setName(t("setFolder"))
      .setDesc(t("setFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.syncFolder)
          .setValue(this.plugin.settings.syncFolder)
          .onChange(async (value) => {
            this.plugin.settings.syncFolder = value.trim() || DEFAULT_SETTINGS.syncFolder;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setTranscript"))
      .setDesc(t("setTranscriptDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeTranscript).onChange(async (value) => {
          this.plugin.settings.includeTranscript = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setFileName"))
      .setDesc(t("setFileNameDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.fileNameFormat)
          .setValue(this.plugin.settings.fileNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.fileNameFormat = value.trim() || DEFAULT_SETTINGS.fileNameFormat;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setOnStartup"))
      .setDesc(t("setOnStartupDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setInterval"))
      .setDesc(t("setIntervalDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const minutes = Math.max(0, Math.floor(Number(value)) || 0);
            this.plugin.settings.syncIntervalMinutes = minutes;
            await this.plugin.saveSettings();
            this.plugin.scheduleAutoSync();
          });
      });
  }
}
