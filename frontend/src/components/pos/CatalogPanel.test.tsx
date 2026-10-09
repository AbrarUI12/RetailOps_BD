import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CatalogStatus } from "../../lib/catalog";
import { offlineDb, type CatalogItem } from "../../lib/offlineDb";
import { expectNoAxeViolations } from "../../test/axe";
import { CatalogPanel } from "./CatalogPanel";

const base: Omit<CatalogItem, "variant_id" | "sku" | "barcode" | "product_name" | "category_id" | "search_text"> = {
  product_id: "p1", variant_name: "Default", price: "650.00", category_name: null, image_url: null, attributes: {}, reorder_level: 5, available_quantity: 10,
};
const items: CatalogItem[] = [
  { ...base, variant_id: "v1", product_name: "Botanical Face Wash", sku: "FACE-120", barcode: "100005", category_id: "c2", search_text: "botanical face wash default face-120 100005" },
  { ...base, variant_id: "v2", product_name: "Premium Panjabi", sku: "PAN-M", barcode: "100001", category_id: "c1", search_text: "premium panjabi default pan-m 100001", available_quantity: 0 },
];
const status: CatalogStatus = { version: "v1", organizationId: "o1", syncedAt: new Date().toISOString(), stockAt: new Date().toISOString(), count: 2 };

function renderPanel(onAdd = vi.fn(), offline = false, catalogStatus = status) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onAdd,
    ...render(
      <QueryClientProvider client={client}>
        <CatalogPanel offline={offline} onAdd={onAdd} onRefresh={() => undefined} refreshError={null} refreshing={false} status={catalogStatus} />
      </QueryClientProvider>,
    ),
  };
}

describe("POS catalog panel", () => {
  beforeEach(async () => {
    await offlineDb.catalog.clear();
    await offlineDb.categories.clear();
    await offlineDb.catalog.bulkPut(items);
    await offlineDb.categories.bulkPut([{ id: "c1", name: "Apparel" }, { id: "c2", name: "Beauty" }]);
  });

  it("adds a scanned barcode on Enter and clears the field for the next scan", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const input = screen.getByLabelText("Search or scan a barcode");

    await user.type(input, "100005{Enter}");

    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ variant_id: "v1" })));
    expect(input).toHaveValue("");
    expect(await screen.findByText("Added Botanical Face Wash · Default")).toBeInTheDocument();
  });

  it("reports an unknown code instead of guessing", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();

    await user.type(screen.getByLabelText("Search or scan a barcode"), "999{Enter}");

    expect(await screen.findByText("No product with barcode or SKU “999”")).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("filters by real categories and blocks out-of-stock items online", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    expect(await screen.findByRole("button", { name: /Add Premium Panjabi.*out of stock/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Beauty" }));

    expect(screen.getByRole("button", { name: "Beauty" })).toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Premium Panjabi/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Add Botanical Face Wash/ })).toBeEnabled();
    await expectNoAxeViolations(container);
  });

  it("keeps searching the device catalog while the browser is offline", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { onlineManager } = await import("@tanstack/react-query");
    onlineManager.setOnline(false);
    const user = userEvent.setup();
    renderPanel(vi.fn(), true);

    await user.type(screen.getByLabelText("Search or scan a barcode"), "face");

    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Premium Panjabi/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Add Botanical Face Wash/ })).toBeInTheDocument();
    onlineManager.setOnline(true);
    onLine.mockRestore();
  });

  it("focuses the scan field with F2", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "All products" }));

    await user.keyboard("{F2}");

    expect(screen.getByLabelText("Search or scan a barcode")).toHaveFocus();
  });

  it("bounds rendered tiles for a large local catalog", async () => {
    const bulk = Array.from({ length: 250 }, (_, index): CatalogItem => ({
      ...base,
      variant_id: `bulk-v${index}`,
      product_id: `bulk-p${index}`,
      product_name: `Bulk product ${String(index).padStart(3, "0")}`,
      sku: `BULK-${index}`,
      barcode: `200${String(index).padStart(3, "0")}`,
      category_id: null,
      search_text: `bulk product ${index} bulk-${index}`,
    }));
    await offlineDb.catalog.clear();
    await offlineDb.catalog.bulkPut(bulk);

    renderPanel(vi.fn(), false, { ...status, count: bulk.length });

    await vi.waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Add Bulk product/ })).toHaveLength(120),
    );
    expect(screen.getByText("250 items on this device", { exact: false })).toBeInTheDocument();
  });
});
