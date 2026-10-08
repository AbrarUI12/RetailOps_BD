import { create } from "zustand";

import { api, type AuthResponse, type User } from "../lib/api";

interface AuthState {
  accessToken: string | null;
  user: User | null;
  bootstrapped: boolean;
  login: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  bootstrapped: false,
  login: async (email, password) => {
    const result = await api<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    set({ accessToken: result.access_token, user: result.user, bootstrapped: true });
  },
  refresh: async () => {
    try {
      const result = await api<AuthResponse>("/api/v1/auth/refresh", { method: "POST" }, false);
      set({ accessToken: result.access_token, user: result.user });
      return true;
    } catch {
      set({ accessToken: null, user: null });
      return false;
    }
  },
  bootstrap: async () => {
    await useAuthStore.getState().refresh();
    set({ bootstrapped: true });
  },
  logout: async () => {
    await api<void>("/api/v1/auth/logout", { method: "POST" }, false).catch(() => undefined);
    set({ accessToken: null, user: null, bootstrapped: true });
  },
}));
