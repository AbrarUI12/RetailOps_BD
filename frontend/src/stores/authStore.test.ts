import type { User } from "../lib/api";
import { useAuthStore } from "./authStore";

const user: User = {
  id: "u1",
  organization_id: "o1",
  organization_name: "RetailOps Demo",
  branch_id: "b1",
  branch_name: "Dhanmondi",
  email: "cashier@retailopsbd.com",
  full_name: "Tanvir Ahmed",
  role: "CASHIER",
  permissions: ["sale:create"],
};

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("auth store", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ accessToken: null, user: null, bootstrapped: false, offlineSession: false, sessionExpired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the cached session when the network is down", async () => {
    localStorage.setItem("retailops.session", JSON.stringify(user));
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState()).toMatchObject({ user, accessToken: null, offlineSession: true, bootstrapped: true });
  });

  it("signs out when the server rejects the refresh token", async () => {
    localStorage.setItem("retailops.session", JSON.stringify(user));
    vi.stubGlobal("fetch", vi.fn(() => respond(401, { error: { code: "INVALID_REFRESH_TOKEN", message: "Expired" } })));

    await useAuthStore.getState().bootstrap();

    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem("retailops.session")).toBeNull();
  });

  it("flags an expired session only when the user was signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(401, { error: { code: "INVALID_REFRESH", message: "Expired" } })));
    useAuthStore.setState({ accessToken: "old", user });

    await useAuthStore.getState().refresh();
    expect(useAuthStore.getState().sessionExpired).toBe(true);

    useAuthStore.setState({ accessToken: null, user: null, sessionExpired: false });
    await useAuthStore.getState().refresh();
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it("shares one refresh request between concurrent callers", async () => {
    const fetchMock = vi.fn(() => respond(200, { access_token: "fresh", expires_in: 900, user }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([useAuthStore.getState().refresh(), useAuthStore.getState().refresh()]);

    expect(results).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: "fresh", user, offlineSession: false });
    expect(JSON.parse(localStorage.getItem("retailops.session")!)).toEqual(user);
  });
});
