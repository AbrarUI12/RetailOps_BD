/**
 * The POS catalog lives on the device (plan §40). The API is only used to refresh it:
 * compare versions, download when changed, and refresh stock levels. Search never hits the network.
 */
import { api } from "./api";
import { offlineDb, type CatalogCategory, type CatalogItem } from "./offlineDb";

interface CatalogVersion {
  version: string;
  variant_count: number;
}

interface CatalogSnapshot {
  version: string;
  generated_at: string;
  categories: CatalogCategory[];
  items: Omit<CatalogItem, "search_text">[];
}

interface StockSnapshot {
  as_of: string;
  available: Record<string, number>;
}

export interface CatalogStatus {
  version: string | null;
  organizationId: string | null;
  syncedAt: string | null;
  stockAt: string | null;
  count: number;
}

const META = { version: "catalog.version", organization: "catalog.organization", syncedAt: "catalog.syncedAt", stockAt: "catalog.stockAt" } as const;

function searchText(item: Omit<CatalogItem, "search_text">) {
  return [item.product_name, item.variant_name, item.sku, item.barcode ?? "", item.category_name ?? "", ...Object.values(item.attributes)]
    .join(" ")
    .toLowerCase();
}

async function readMeta(key: string) {
  return (await offlineDb.meta.get(key))?.value ?? null;
}

export async function catalogStatus(): Promise<CatalogStatus> {
  const [version, organizationId, syncedAt, stockAt, count] = await Promise.all([
    readMeta(META.version),
    readMeta(META.organization),
    readMeta(META.syncedAt),
    readMeta(META.stockAt),
    offlineDb.catalog.count(),
  ]);
  return { version, organizationId, syncedAt, stockAt, count };
}

/**
 * Downloads the catalog only when the server's version differs or the cache belongs to another
 * organization. Returns "updated", "current" or throws when the API cannot be reached.
 */
export async function refreshCatalog(organizationId: string): Promise<"updated" | "current"> {
  const [remote, status] = await Promise.all([api<CatalogVersion>("/api/v1/sync/catalog-version"), catalogStatus()]);
  if (status.version === remote.version && status.organizationId === organizationId && status.count === remote.variant_count) {
    await refreshStock();
    return "current";
  }
  const snapshot = await api<CatalogSnapshot>("/api/v1/sync/catalog");
  const now = new Date().toISOString();
  await offlineDb.transaction("rw", offlineDb.catalog, offlineDb.categories, offlineDb.meta, async () => {
    await offlineDb.catalog.clear();
    await offlineDb.categories.clear();
    await offlineDb.catalog.bulkPut(snapshot.items.map((item) => ({ ...item, search_text: searchText(item) })));
    await offlineDb.categories.bulkPut(snapshot.categories);
    await offlineDb.meta.bulkPut([
      { key: META.version, value: snapshot.version },
      { key: META.organization, value: organizationId },
      { key: META.syncedAt, value: now },
      { key: META.stockAt, value: now },
    ]);
  });
  return "updated";
}

/** Replaces cached available quantities with the server's (plan §46 reconciliation). */
export async function refreshStock() {
  const stock = await api<StockSnapshot>("/api/v1/sync/stock");
  await offlineDb.transaction("rw", offlineDb.catalog, offlineDb.meta, async () => {
    await offlineDb.catalog.toCollection().modify((item) => {
      item.available_quantity = stock.available[item.variant_id] ?? 0;
    });
    await offlineDb.meta.put({ key: META.stockAt, value: stock.as_of });
  });
}

/** Forget a cache that belongs to another organization (e.g. a different shop signed in). */
export async function clearCatalogIfForeign(organizationId: string) {
  const owner = await readMeta(META.organization);
  if (owner && owner !== organizationId) {
    await offlineDb.transaction("rw", offlineDb.catalog, offlineDb.categories, offlineDb.meta, async () => {
      await offlineDb.catalog.clear();
      await offlineDb.categories.clear();
      await offlineDb.meta.bulkDelete(Object.values(META));
    });
  }
}

/** Every search term must appear somewhere in the item; results keep catalog order. */
export async function searchCatalog(query: string, categoryId: string | null = null, limit = 120) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const base = categoryId ? offlineDb.catalog.where("category_id").equals(categoryId) : offlineDb.catalog.orderBy("product_name");
  return base.filter((item) => terms.every((term) => item.search_text.includes(term))).limit(limit).toArray();
}

/** Exact barcode (or SKU) match through the IndexedDB index: what a scanner sends. */
export async function findByCode(code: string) {
  const value = code.trim();
  if (!value) return undefined;
  return (await offlineDb.catalog.where("barcode").equals(value).first()) ?? (await offlineDb.catalog.where("sku").equals(value.toUpperCase()).first());
}

export async function cachedCategories() {
  return offlineDb.categories.orderBy("name").toArray();
}
