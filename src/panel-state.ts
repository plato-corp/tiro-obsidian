export interface SyncStatus {
  at: number;
  created: number;
  updated: number;
  failed: number;
  /** Set when the run stopped because of an error. */
  error?: string;
}

/** What the side panel shows. Kept in memory only. */
export interface PanelState {
  lastSync: SyncStatus | null;
}
