import { create } from "zustand";

export type Connectivity = "OFFLINE" | "ONLINE" | "SYNCING" | "SYNCED" | "ERROR";

const LAST_SYNC_KEY = "retailops.lastSyncedAt";

function readLastSync() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

interface SyncState {
  status: Connectivity;
  pending: number;
  /** ISO time of the last run that left nothing unsynced; survives reloads. */
  lastSyncedAt: string | null;
  setStatus: (status: Connectivity) => void;
  setPending: (pending: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: navigator.onLine ? "ONLINE" : "OFFLINE",
  pending: 0,
  lastSyncedAt: readLastSync(),
  setStatus: (status) => {
    if (status === "SYNCED") {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_SYNC_KEY, now);
      } catch {
        // Not critical: the indicator falls back to "All sales synced".
      }
      set({ status, lastSyncedAt: now });
      return;
    }
    set({ status });
  },
  setPending: (pending) => set({ pending }),
}));
