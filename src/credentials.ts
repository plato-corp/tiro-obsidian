import type { TiroSettings } from "./settings";
import type { SyncStatus } from "./panel-state";

export function publicPluginData(settings: TiroSettings, lastSync: SyncStatus | null): object {
  return {
    auth: { clientId: settings.auth.clientId, redirectUris: settings.auth.redirectUris },
    syncFolder: settings.syncFolder,
    includeTranscript: settings.includeTranscript,
    fileNameFormat: settings.fileNameFormat,
    syncOnStartup: settings.syncOnStartup,
    syncIntervalMinutes: settings.syncIntervalMinutes,
    ...(lastSync ? { lastSync: { at: lastSync.at, created: lastSync.created, updated: lastSync.updated, failed: lastSync.failed } } : {}),
  };
}
