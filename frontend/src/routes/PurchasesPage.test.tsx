import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchasesPage } from "./PurchasesPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({
  ...(await original()),
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));

const suppliers = [{ id: "supplier-1", name: "Tangail Weavers", phone: "01700000000", email: null }];
const products = {
  items: [{
    id: "product-1", name: "Premium Panjabi", sku: "PAN", description: null, category_id: null,
    category_name: null, image_url: null, is_active: true, created_at: "2026-10-09T06:00:00Z",
    variants: [
      { id: "variant-1", product_id: "product-1", name: "Emerald · L", sku: "PAN-L", barcode: null, price: "1500.00", cost: "800.00", attributes: {}, reorder_level: 5, is_active: true, available_quantity: 4 },
      { id: "variant-2", product_id: "product-1", name: "Emerald · XL", sku: "PAN-XL", barcode: null, price: "1600.00", cost: "900.00", attributes: {}, reorder_level: 5, is_active: true, available_quantity: 2 },
    ],
  }],
  page: 1, page_size: 100, total: 1,
};
const purchase = {
  id: "purchase-1", reference: "PO-1001", supplier_id: "supplier-1", supplier_name: "Tangail Weavers",
  branch_id: "branch-1", status: "DRAFT", total: "3400.00", created_at: "2026-10-09T06:00:00Z",
  items: [
    { variant_id: "variant-1", product_name: "Premium Panjabi", variant_name: "Emerald · L", sku: "PAN-L", quantity: 2, unit_cost: "800.00", line_total: "1600.00" },
    { variant_id: "variant-2", product_name: "Premium Panjabi", variant_name: "Emerald · XL", sku: "PAN-XL", quantity: 2, unit_cost: "900.00", line_total: "1800.00" },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><PurchasesPage/></QueryClientProvider></MemoryRouter>);
}

describe("purchase and supplier workflow", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/purchases" && !init?.method) return Promise.resolve([purchase]);
      if (path === "/api/v1/suppliers" && !init?.method) return Promise.resolve(suppliers);
      if (path.startsWith("/api/v1/products?") && !init?.method) return Promise.resolve(products);
      if (path === "/api/v1/purchases" && init?.method === "POST") return Promise.resolve(purchase);
      if (path === "/api/v1/suppliers" && init?.method === "POST") return Promise.resolve({ id: "supplier-2", name: "Dhaka Textiles", phone: null, email: null });
      if (path === "/api/v1/purchases/purchase-1/receive" && init?.method === "POST") return Promise.resolve({ ...purchase, status: "RECEIVED" });
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  it("builds and submits a multi-line purchase with a live total", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "New purchase" }));
    const dialog = screen.getByRole("dialog", { name: "Create purchase" });
    await user.type(within(dialog).getByLabelText("Supplier reference"), "PO-1002");
    await user.selectOptions(within(dialog).getByLabelText("Supplier"), "supplier-1");
    await user.selectOptions(within(dialog).getByLabelText("Product for line 1"), "variant-1");
    const firstQuantity = within(dialog).getByLabelText("Quantity for line 1");
    await user.clear(firstQuantity);
    await user.type(firstQuantity, "3");
    await user.click(within(dialog).getByRole("button", { name: "Add line" }));
    await user.selectOptions(within(dialog).getByLabelText("Product for line 2"), "variant-2");
    const secondQuantity = within(dialog).getByLabelText("Quantity for line 2");
    await user.clear(secondQuantity);
    await user.type(secondQuantity, "2");
    expect(within(dialog).getByText("৳4,200.00")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/purchases", expect.objectContaining({ method: "POST" })));
    const request = apiMock.mock.calls.find(([path, init]) => path === "/api/v1/purchases" && init?.method === "POST")?.[1];
    expect(typeof request?.body === "string" ? JSON.parse(request.body) : null).toEqual({
      supplier_id: "supplier-1",
      reference: "PO-1002",
      items: [
        { variant_id: "variant-1", quantity: 3, unit_cost: "800.00" },
        { variant_id: "variant-2", quantity: 2, unit_cost: "900.00" },
      ],
    });
  });

  it("adds a supplier from the supplier manager", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Suppliers" }));
    const dialog = screen.getByRole("dialog", { name: "Suppliers" });
    expect(await within(dialog).findByText("Tangail Weavers")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Supplier name"), "Dhaka Textiles");
    await user.type(within(dialog).getByLabelText("Phone"), "01800000000");
    await user.click(within(dialog).getByRole("button", { name: "Add supplier" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/suppliers", expect.objectContaining({ method: "POST" })));
  });

  it("shows line detail and confirms stock receipt", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "View PO-1001" }))[0]);
    expect(await screen.findByText("PAN-XL", { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Receive stock" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Receive PO-1001?" });
    await user.click(within(confirmation).getByRole("button", { name: "Receive into stock" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/purchases/purchase-1/receive", { method: "POST" }));
  });
});
