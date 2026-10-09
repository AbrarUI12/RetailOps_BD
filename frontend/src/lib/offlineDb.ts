import Dexie, { type EntityTable } from "dexie";

/** A sellable variant as the POS stores it locally (mirrors the API's CatalogItem). */
export interface CatalogItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  price: string;
  category_id: string | null;
  category_name: string | null;
  image_url: string | null;
  attributes: Record<string, string>;
  reorder_level: number;
  available_quantity: number;
  /** Lower-cased name, variant, SKU and barcode for fast local matching. */
  search_text: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface MetaEntry {
  key: string;
  value: string;
}

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
  catalog!: EntityTable<CatalogItem, "variant_id">;
  categories!: EntityTable<CatalogCategory, "id">;
  meta!: EntityTable<MetaEntry, "key">;
  pendingSales!: EntityTable<PendingSale, "client_transaction_id">;

  constructor() {
    super("retailops-bd");
    this.version(1).stores({
      products: "id,name,sku,*variants.barcode",
      pendingSales: "client_transaction_id,status,created_at",
    });
    // v2: a flat, variant-level catalog with real barcode/SKU indexes (plan §39-40). The old
    // product cache is dropped; queued sales are untouched.
    this.version(2).stores({
      products: null,
      catalog: "variant_id,barcode,sku,category_id,product_name",
      categories: "id,name",
      meta: "key",
      pendingSales: "client_transaction_id,status,created_at",
    });
  }
}

export const offlineDb = new RetailDatabase();

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
