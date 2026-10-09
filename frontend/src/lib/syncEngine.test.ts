import type { PendingSale } from "./offlineDb";

const rows = new Map<string, PendingSale>();
const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();

vi.mock("./offlineDb", () => {
  const byStatus = (statuses: string[]) =>
    [...rows.values()].filter((row) => statuses.includes(row.status));
  return {
    offlineDb: {
      pendingSales: {
        where: () => ({
          anyOf: (...statuses: string[]) => ({
            sortBy: () =>
              Promise.resolve(
                byStatus(statuses).sort((a, b) =>
                  a.created_at.localeCompare(b.created_at),
                ),
              ),
            count: () => Promise.resolve(byStatus(statuses).length),
          }),
          equals: (status: string) => ({
            count: () => Promise.resolve(byStatus([status]).length),
          }),
        }),
        update: (id: string, changes: Partial<PendingSale>) => {
          rows.set(id, { ...rows.get(id)!, ...changes });
          return Promise.resolve(1);
        },
        delete: (id: string) => {
          rows.delete(id);
          return Promise.resolve();
        },
        count: () => Promise.resolve(rows.size),
      },
      localSales: { update: () => Promise.resolve(1) },
    },
  };
});

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));

const { ApiError } = await import("./api");
const { isTransientFailure, processSyncQueue, retryDelay } = await import(
  "./syncEngine"
);
const { useSyncStore } = await import("../stores/syncStore");

function queue(id: string, minute: number, extra: Partial<PendingSale> = {}) {
  rows.set(id, {
    client_transaction_id: id,
    payload: { items: [] },
    status: "PENDING",
    created_at: `2026-10-09T10:0${minute}:00.000Z`,
    ...extra,
  });
}

describe("offline sync engine", () => {
  beforeEach(() => {
    rows.clear();
    apiMock.mockReset();
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );
    useSyncStore.setState({ status: "ONLINE", pending: 0 });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("classifies failures and backs off exponentially", () => {
    expect(isTransientFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientFailure(new ApiError("Down", 503))).toBe(true);
    expect(isTransientFailure(new ApiError("Slow down", 429))).toBe(true);
    expect(
      isTransientFailure(
        new ApiError("Still processing", 409, "SYNC_IN_PROGRESS"),
      ),
    ).toBe(true);
    expect(
      isTransientFailure(
        new ApiError("Key reused", 409, "IDEMPOTENCY_KEY_REUSED"),
      ),
    ).toBe(false);
    expect(
      isTransientFailure(new ApiError("Invalid", 422, "INVALID_SYNC_PAYLOAD")),
    ).toBe(false);
    expect([1, 2, 3].map(retryDelay)).toEqual([5_000, 10_000, 20_000]);
    expect(retryDelay(20)).toBe(300_000);
  });

  it("syncs in creation order and clears acknowledged sales", async () => {
    queue("b", 2);
    queue("a", 1);
    queue("stale", 3, { status: "SYNCING" });
    apiMock.mockResolvedValue({ status: "SYNCED", conflict: false });

    await processSyncQueue();

    const sent = apiMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse(init?.body as string) as { client_transaction_id: string })
          .client_transaction_id,
    );
    expect(sent).toEqual(["a", "b", "stale"]);
    expect(rows.size).toBe(0);
    expect(useSyncStore.getState()).toMatchObject({
      status: "SYNCED",
      pending: 0,
    });
  });

  it("rejects permanent failures but keeps going", async () => {
    queue("bad", 1);
    queue("good", 2);
    apiMock
      .mockRejectedValueOnce(
        new ApiError("Offline sale payload is invalid", 422),
      )
      .mockResolvedValueOnce({ status: "SYNCED", conflict: false });

    await processSyncQueue();

    expect(rows.get("bad")).toMatchObject({
      status: "REJECTED",
      error: "Offline sale payload is invalid",
    });
    expect(rows.has("good")).toBe(false);
    expect(useSyncStore.getState()).toMatchObject({
      status: "ERROR",
      pending: 1,
    });
  });

  it("stops at a transient failure and schedules a retry", async () => {
    queue("first", 1);
    queue("second", 2);
    apiMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await processSyncQueue();

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(rows.get("first")).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(Date.parse(rows.get("first")!.next_attempt_at!)).toBeGreaterThan(
      Date.now(),
    );
    expect(rows.get("second")?.status).toBe("PENDING");

    apiMock.mockClear();
    await processSyncQueue();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("does not send anything when the health probe fails", async () => {
    queue("waiting", 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await processSyncQueue();

    expect(apiMock).not.toHaveBeenCalled();
    expect(rows.get("waiting")?.status).toBe("PENDING");
    expect(useSyncStore.getState().status).toBe("OFFLINE");
  });
});
