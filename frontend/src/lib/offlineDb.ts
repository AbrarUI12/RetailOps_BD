import Dexie, { type EntityTable } from "dexie";

import type { SaleReceipt } from "./sales";

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
  organization_id?: string;
}

export interface LocalSale {
  client_transaction_id: string;
  organization_id: string;
  receipt: SaleReceipt;
  sync_status: "PENDING" | "SYNCED" | "CONFLICT";
  created_at: string;
  server_record_id?: string;
}

export interface LocalSaleItem {
  id: string;
  client_transaction_id: string;
  variant_id: string;
  quantity: number;
  unit_price: string;
}

class RetailDatabase extends Dexie {
  catalog!: EntityTable<CatalogItem, "variant_id">;
  categories!: EntityTable<CatalogCategory, "id">;
  meta!: EntityTable<MetaEntry, "key">;
  pendingSales!: EntityTable<PendingSale, "client_transaction_id">;
  localSales!: EntityTable<LocalSale, "client_transaction_id">;
  localSaleItems!: EntityTable<LocalSaleItem, "id">;

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
    // v3: persist the complete local sale aggregate and its snapshot lines. Catalog stock and
    // queue insertion happen in the same transaction, so a tab crash cannot leave half a sale.
    this.version(3).stores({
      catalog: "variant_id,barcode,sku,category_id,product_name",
      categories: "id,name",
      meta: "key",
      pendingSales: "client_transaction_id,status,created_at,organization_id",
      localSales:
        "client_transaction_id,organization_id,sync_status,created_at",
      localSaleItems: "id,client_transaction_id,variant_id",
    });
  }
}

export const offlineDb = new RetailDatabase();

export async function persistOfflineSale({
  organizationId,
  payload,
  receipt,
}: {
  organizationId: string;
  payload: Record<string, unknown>;
  receipt: SaleReceipt;
}) {
  const client_transaction_id = String(payload.client_transaction_id);
  await offlineDb.transaction(
    "rw",
    offlineDb.pendingSales,
    offlineDb.localSales,
    offlineDb.localSaleItems,
    offlineDb.catalog,
    async () => {
      // Lost-response handling may attempt to queue the same UUID twice. Preserve idempotency on
      // the device too, otherwise optimistic stock would be decremented twice.
      if (await offlineDb.localSales.get(client_transaction_id)) return;
      const created_at = receipt.created_at;
      await offlineDb.pendingSales.put({
        client_transaction_id,
        organization_id: organizationId,
        payload,
        status: "PENDING",
        created_at,
      });
      await offlineDb.localSales.put({
        client_transaction_id,
        organization_id: organizationId,
        receipt,
        sync_status: "PENDING",
        created_at,
      });
      await offlineDb.localSaleItems.bulkPut(
        receipt.items.map((item) => ({
          id: `${client_transaction_id}:${item.variant_id}`,
          client_transaction_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      );
      for (const item of receipt.items) {
        const cached = await offlineDb.catalog.get(item.variant_id);
        if (cached) {
          await offlineDb.catalog.update(item.variant_id, {
            available_quantity: cached.available_quantity - item.quantity,
          });
        }
      }
    },
  );
  return client_transaction_id;
}
