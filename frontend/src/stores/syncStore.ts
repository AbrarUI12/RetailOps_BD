import { create } from "zustand";

export type Connectivity = "OFFLINE" | "ONLINE" | "SYNCING" | "SYNCED" | "ERROR";

interface SyncState {
  status: Connectivity;
  pending: number;
  setStatus: (status: Connectivity) => void;
  setPending: (pending: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: navigator.onLine ? "ONLINE" : "OFFLINE",
  pending: 0,
  setStatus: (status) => set({ status }),
  setPending: (pending) => set({ pending }),
}));
