import { useEffect } from "react";

import { API_URL, ApiError, api } from "./api";
import { offlineDb, type PendingSale } from "./offlineDb";
import { useSyncStore } from "../stores/syncStore";

const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
const TRANSIENT_STATUSES = new Set([401, 408, 425, 429]);

let processing = false;

/** Network failures and server-side outages are retried; any other 4xx will never succeed. */
export function isTransientFailure(reason: unknown) {
  if (!(reason instanceof ApiError)) return true;
  if (reason.code === "SYNC_IN_PROGRESS") return true;
  return reason.status >= 500 || TRANSIENT_STATUSES.has(reason.status);
}

export function retryDelay(attempts: number) {
  return Math.min(BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
}

export async function probeServer(timeoutMs = 4_000) {
  try {
    const response = await fetch(`${API_URL}/health/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isDue(sale: PendingSale, now: number) {
  return !sale.next_attempt_at || Date.parse(sale.next_attempt_at) <= now;
}

async function processUnlockedQueue() {
  if (processing || !navigator.onLine || !("indexedDB" in globalThis)) return;
  processing = true;
  const store = useSyncStore.getState();
  try {
    const now = Date.now();
    // SYNCING rows belong to a tab that died mid-request; the server's idempotency makes replay safe.
    const ordered = await offlineDb.pendingSales
      .where("status")
      .anyOf("PENDING", "FAILED", "SYNCING")
      .sortBy("created_at");
    // A sale still backing off holds back everything after it so the server sees creation order.
    const blocked = ordered.findIndex((sale) => !isDue(sale, now));
    const queue = blocked === -1 ? ordered : ordered.slice(0, blocked);
    if (!queue.length) {
      const waiting = await offlineDb.pendingSales
        .where("status")
        .anyOf("FAILED", "REJECTED")
        .count();
      store.setStatus(waiting ? "ERROR" : "SYNCED");
      return;
    }
    if (!(await probeServer())) {
      store.setStatus("OFFLINE");
      return;
    }
    store.setStatus("SYNCING");
    let interrupted = blocked !== -1;
    for (const sale of queue) {
      const id = sale.client_transaction_id;
      await offlineDb.pendingSales.update(id, { status: "SYNCING" });
      try {
        const result = await api<{
          status: string;
          conflict: boolean;
          server_record_id: string | null;
        }>("/api/v1/sync/sales", {
          method: "POST",
          body: JSON.stringify({
            client_transaction_id: id,
            payload: sale.payload,
            device_key: "browser-pos",
          }),
        });
        await offlineDb.localSales.update(id, {
          sync_status: result.conflict ? "CONFLICT" : "SYNCED",
          ...(result.server_record_id
            ? { server_record_id: result.server_record_id }
            : {}),
        });
        // Acknowledged, including oversell conflicts: the server now owns the sale and its conflict record.
        await offlineDb.pendingSales.delete(id);
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : "Sync failed";
        if (!isTransientFailure(reason)) {
          await offlineDb.pendingSales.update(id, {
            status: "REJECTED",
            error,
          });
          continue;
        }
        const attempts = (sale.attempts ?? 0) + 1;
        await offlineDb.pendingSales.update(id, {
          status: "FAILED",
          error,
          attempts,
          next_attempt_at: new Date(
            Date.now() + retryDelay(attempts),
          ).toISOString(),
        });
        // Stop here so later sales are never applied ahead of an earlier one.
        interrupted = true;
        break;
      }
    }
    const rejected = await offlineDb.pendingSales
      .where("status")
      .equals("REJECTED")
      .count();
    store.setStatus(interrupted || rejected ? "ERROR" : "SYNCED");
  } catch {
    store.setStatus("ERROR");
  } finally {
    store.setPending(
      await offlineDb.pendingSales.count().catch(() => store.pending),
    );
    processing = false;
  }
}

/** A Web Lock serializes sync across tabs; the in-module guard remains the fallback. */
export async function processSyncQueue() {
  if (navigator.locks) {
    await navigator.locks.request(
      "retailops-offline-sync",
      { ifAvailable: true },
      async (lock) => {
        if (lock) await processUnlockedQueue();
      },
    );
    return;
  }
  await processUnlockedQueue();
}

export function useSyncEngine() {
  useEffect(() => {
    if (!("indexedDB" in globalThis)) return undefined;
    const update = () => {
      useSyncStore
        .getState()
        .setStatus(navigator.onLine ? "ONLINE" : "OFFLINE");
      if (navigator.onLine) void processSyncQueue();
    };
    addEventListener("online", update);
    addEventListener("offline", update);
    void offlineDb.pendingSales
      .count()
      .then(useSyncStore.getState().setPending)
      .catch(() => undefined);
    void processSyncQueue();
    const timer = setInterval(() => void processSyncQueue(), 15_000);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
      clearInterval(timer);
    };
  }, []);
}
