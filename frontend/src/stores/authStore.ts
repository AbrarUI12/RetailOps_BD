import { create } from "zustand";

import { ApiError, api, type AuthResponse, type User } from "../lib/api";

/**
 * The signed-in user (never tokens) is cached so the POS still opens after an offline reload.
 * The server stays the authority: the cache is replaced or cleared on the next successful
 * refresh or on an explicit 401.
 */
const SESSION_CACHE_KEY = "retailops.session";

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  try {
    if (user) localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the app then simply needs the network to start.
  }
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  bootstrapped: boolean;
  /** True when the user comes from the offline cache and no token has been issued yet. */
  offlineSession: boolean;
  login: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

// Refresh tokens rotate, so concurrent refreshes would invalidate each other: share one request.
let refreshInFlight: Promise<boolean> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  bootstrapped: false,
  offlineSession: false,
  login: async (email, password) => {
    const result = await api<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    writeCachedUser(result.user);
    set({ accessToken: result.access_token, user: result.user, bootstrapped: true, offlineSession: false });
  },
  refresh: () => {
    refreshInFlight ??= (async () => {
      try {
        const result = await api<AuthResponse>("/api/v1/auth/refresh", { method: "POST" }, false);
        writeCachedUser(result.user);
        set({ accessToken: result.access_token, user: result.user, offlineSession: false });
        return true;
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          // The server says the session is over: forget the cached user too.
          writeCachedUser(null);
          set({ accessToken: null, user: null, offlineSession: false });
          return false;
        }
        // Network or server outage: keep working from the cached session.
        const cached = get().user ?? readCachedUser();
        set({ accessToken: null, user: cached, offlineSession: Boolean(cached) });
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },
  bootstrap: async () => {
    await get().refresh();
    set({ bootstrapped: true });
  },
  logout: async () => {
    await api<void>("/api/v1/auth/logout", { method: "POST" }, false).catch(() => undefined);
    writeCachedUser(null);
    set({ accessToken: null, user: null, bootstrapped: true, offlineSession: false });
  },
}));
