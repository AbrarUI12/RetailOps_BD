import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AdjustStockDialog } from "../components/inventory/AdjustStockDialog";
import type { InventoryItem, Product, User } from "../lib/api";
import { expectNoAxeViolations } from "../test/axe";
import { useAuthStore } from "../stores/authStore";
import { ProductsPage } from "./ProductsPage";

const owner: User = {
  id: "u1", organization_id: "o1", organization_name: "Demo", branch_id: "b1", branch_name: "Dhanmondi",
  email: "owner@retailopsbd.com", full_name: "Abrar Rahman", role: "OWNER",
  permissions: ["product:read", "product:write", "inventory:read", "inventory:adjust"],
};

const panjabi: Product = {
  id: "p1", name: "Premium Panjabi", sku: "PAN", description: null, category_id: "c1", category_name: "Apparel",
  image_url: null, is_active: true, created_at: "2026-10-01T06:00:00Z",
  variants: [
    { id: "v1", product_id: "p1", name: "Black / M", sku: "PAN-BLACK-M", barcode: "100001", price: "2490.00", cost: "1300.00", attributes: { Color: "Black", Size: "M" }, reorder_level: 5, is_active: true, available_quantity: 3 },
    { id: "v2", product_id: "p1", name: "Black / L", sku: "PAN-BLACK-L", barcode: null, price: "2590.00", cost: "1300.00", attributes: { Color: "Black", Size: "L" }, reorder_level: 5, is_active: true, available_quantity: 10 },
  ],
};

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function renderWith(element: React.ReactElement, path = "/products") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="*" element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("products page", () => {
  let posted: unknown;
  beforeEach(() => {
    posted = undefined;
    useAuthStore.setState({ user: owner, accessToken: "token", bootstrapped: true });
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/categories")) return json([{ id: "c1", name: "Apparel", slug: "apparel", product_count: 1 }]);
      if (init?.method === "POST" && url.endsWith("/api/v1/products")) {
        posted = JSON.parse(init.body as string);
        return json({ ...panjabi, id: "p2", name: "Cotton Tee", sku: "TEE" }, 201);
      }
      if (url.includes("/products/p1")) return json(panjabi);
      if (url.includes("/products/p2")) return json({ ...panjabi, id: "p2", name: "Cotton Tee", sku: "TEE" });
      return json({ items: [panjabi], page: 1, page_size: 25, total: 1 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists products with stock, price range and category", async () => {
    const { container } = renderWith(<ProductsPage />);

    const table = await screen.findByRole("table", { name: "Products" });
    const row = within(table).getByRole("button", { name: "Open Premium Panjabi" }).closest("tr")!;
    expect(within(row).getByText("Apparel")).toBeInTheDocument();
    expect(within(row).getByText("৳2,490–৳2,590")).toBeInTheDocument();
    expect(within(row).getByText("13 in stock")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("opens the product drawer with variant tabs", async () => {
    renderWith(<ProductsPage />, "/products?focus=p1");

    const drawer = await screen.findByRole("dialog", { name: "Premium Panjabi" });
    await userEvent.click(within(drawer).getByRole("tab", { name: "Variants (2)" }));

    expect(within(drawer).getByRole("tab", { name: "Variants (2)" })).toHaveAttribute("aria-selected", "true");
    expect(within(drawer).getByText("PAN-BLACK-L")).toBeInTheDocument();
    expect(within(drawer).getByText("Low · 3")).toBeInTheDocument();
  });

  it("creates a product with generated variants", async () => {
    const user = userEvent.setup();
    renderWith(<ProductsPage />, "/products?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add product" });

    await user.type(within(dialog).getByLabelText("Product name"), "Cotton Tee");
    await user.type(within(dialog).getByLabelText(/Product SKU/), "tee");
    await user.type(within(dialog).getByLabelText("Selling price (৳)"), "650");
    await user.type(within(dialog).getByLabelText("Values"), "M, L");
    await user.type(within(dialog).getByLabelText("Barcode for L"), "8901");
    await user.click(within(dialog).getByRole("button", { name: "Create product" }));

    expect(await screen.findByRole("dialog", { name: "Cotton Tee" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add product" })).not.toBeInTheDocument();
    expect(posted).toMatchObject({
      name: "Cotton Tee",
      sku: "tee",
      variants: [
        { name: "M", sku: "TEE-M", barcode: null, price: "650", attributes: { Size: "M" } },
        { name: "L", sku: "TEE-L", barcode: "8901", price: "650", attributes: { Size: "L" } },
      ],
    });
  });
});

describe("stock adjustment", () => {
  const item: InventoryItem = {
    variant_id: "v1", product_id: "p1", category_name: "Apparel", product_name: "Premium Panjabi", variant_name: "Black / M",
    sku: "PAN-BLACK-M", barcode: null, physical_quantity: 12, reserved_quantity: 2, available_quantity: 10, reorder_level: 5, stock_status: "IN_STOCK",
  };

  it("previews the difference and requires a reason and note", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => { body = JSON.parse(init?.body as string); return json({ ...item, physical_quantity: 20 }, 201); }));
    const user = userEvent.setup();
    renderWith(<AdjustStockDialog item={item} onOpenChange={() => undefined} />);

    await user.type(screen.getByLabelText("Counted quantity"), "20");
    expect(screen.getByText("+8")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Record +8" });
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Reason"), "COUNT_CORRECTION");
    await user.type(screen.getByLabelText("Note"), "Closing shift count");
    await user.click(submit);

    expect(body).toEqual({ variant_id: "v1", counted_quantity: 20, reason: "COUNT_CORRECTION", note: "Closing shift count" });
    vi.unstubAllGlobals();
  });

  it("blocks going below reserved stock", async () => {
    renderWith(<AdjustStockDialog item={item} onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Counted quantity"), "1");

    expect(screen.getByRole("alert")).toHaveTextContent("2 units are reserved");
  });
});
