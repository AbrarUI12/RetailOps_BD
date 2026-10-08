import Dexie, { type EntityTable } from "dexie";

import type { Product } from "./api";

export interface PendingSale {
  client_transaction_id: string;
  payload: Record<string, unknown>;
  /** REJECTED: the server refused the payload permanently; a manager must review it. */
  status: "PENDING" | "SYNCING" | "FAILED" | "REJECTED";
  created_at: string;
  error?: string;
  attempts?: number;
  next_attempt_at?: string;
}

class RetailDatabase extends Dexie {
  products!: EntityTable<Product, "id">;
  pendingSales!: EntityTable<PendingSale, "client_transaction_id">;

  constructor() {
    super("retailops-bd");
    this.version(1).stores({
      products: "id,name,sku,*variants.barcode",
      pendingSales: "client_transaction_id,status,created_at",
    });
  }
}

export const offlineDb = new RetailDatabase();

export async function cacheProducts(products: Product[]) {
  await offlineDb.transaction("rw", offlineDb.products, async () => {
    await offlineDb.products.clear();
    await offlineDb.products.bulkPut(products);
  });
}

export async function queueSale(payload: Record<string, unknown>) {
  const client_transaction_id = String(payload.client_transaction_id);
  await offlineDb.pendingSales.put({
    client_transaction_id,
    payload,
    status: "PENDING",
    created_at: new Date().toISOString(),
  });
  return client_transaction_id;
}
