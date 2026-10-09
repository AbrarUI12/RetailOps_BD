import "fake-indexeddb/auto";

import { catalogStatus, clearCatalogIfForeign, findByCode, refreshCatalog, searchCatalog } from "./catalog";
import { offlineDb } from "./offlineDb";

const item = (overrides: Record<string, unknown>) => ({
  product_id: "p1",
  product_name: "Premium Panjabi",
  variant_name: "Black / M",
  barcode: null,
  price: "2490.00",
  category_id: "c1",
  category_name: "Apparel",
  image_url: null,
  attributes: { Color: "Black", Size: "M" },
  reorder_level: 5,
  available_quantity: 7,
  ...overrides,
});

const SNAPSHOT = {
  version: "v1",
  generated_at: "2026-10-09T06:00:00Z",
  categories: [{ id: "c1", name: "Apparel" }, { id: "c2", name: "Beauty" }],
  items: [
    item({ variant_id: "v1", sku: "PAN-BLACK-M", barcode: "100001" }),
    item({ variant_id: "v2", sku: "PAN-WHITE-L", variant_name: "White / L", attributes: { Color: "White", Size: "L" } }),
    item({ variant_id: "v3", product_id: "p2", product_name: "Botanical Face Wash", variant_name: "120 ml", sku: "FACE-120", barcode: "100005", category_id: "c2", category_name: "Beauty", attributes: {} }),
  ],
};

function respond(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

function stubApi(version = "v1", stock: Record<string, number> = { v1: 7, v2: 0, v3: 12 }) {
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/sync/catalog-version")) return respond({ version, variant_count: SNAPSHOT.items.length });
    if (url.endsWith("/sync/catalog")) return respond({ ...SNAPSHOT, version });
    if (url.endsWith("/sync/stock")) return respond({ as_of: "2026-10-09T06:05:00Z", available: stock });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("POS catalog cache", () => {
  beforeEach(async () => {
    await Promise.all([offlineDb.catalog.clear(), offlineDb.categories.clear(), offlineDb.meta.clear()]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads the catalog once and only checks the version afterwards", async () => {
    const fetchMock = stubApi();

    expect(await refreshCatalog("org-1")).toBe("updated");
    expect(await refreshCatalog("org-1")).toBe("current");

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.endsWith("/sync/catalog"))).toHaveLength(1);
    expect(await catalogStatus()).toMatchObject({ version: "v1", organizationId: "org-1", count: 3 });
  });

  it("re-downloads when the server version changes", async () => {
    stubApi("v1");
    await refreshCatalog("org-1");
    const fetchMock = stubApi("v2");

    expect(await refreshCatalog("org-1")).toBe("updated");
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/sync/catalog"))).toBe(true);
  });

  it("stays searchable after the API becomes unavailable", async () => {
    stubApi();
    await refreshCatalog("org-1");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

    await expect(refreshCatalog("org-1")).rejects.toThrow();
    const byName = await searchCatalog("panjabi white");
    const byCategory = await searchCatalog("", "c2");
    const scanned = await findByCode("100005");
    const bySku = await findByCode("pan-black-m");

    expect(byName.map((row) => row.variant_id)).toEqual(["v2"]);
    expect(byCategory.map((row) => row.sku)).toEqual(["FACE-120"]);
    expect(scanned?.product_name).toBe("Botanical Face Wash");
    expect(bySku?.variant_id).toBe("v1");
    expect(await findByCode("999999")).toBeUndefined();
  });

  it("refreshes stock without re-downloading the catalog", async () => {
    stubApi();
    await refreshCatalog("org-1");
    stubApi("v1", { v1: 2, v3: 12 });

    await refreshCatalog("org-1");

    const [first] = await searchCatalog("black");
    expect(first.available_quantity).toBe(2);
    expect((await searchCatalog("white"))[0].available_quantity).toBe(0);
  });

  it("drops a catalog that belongs to another organization", async () => {
    stubApi();
    await refreshCatalog("org-1");

    await clearCatalogIfForeign("org-2");

    expect(await catalogStatus()).toMatchObject({ count: 0, version: null });
  });
});
