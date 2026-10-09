import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { expectNoAxeViolations } from "../test/axe";
import { OrdersPage } from "./OrdersPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({ ...(await original()), api: (path: string, init?: RequestInit) => apiMock(path, init) }));

const productPage = { items: [{ id: "p1", name: "Premium Panjabi", sku: "PP", description: null, category_id: null, category_name: null, image_url: null, is_active: true, created_at: "2026-10-09T00:00:00Z", variants: [{ id: "v1", product_id: "p1", name: "Emerald · L", sku: "PP-EL", barcode: "123", price: "1200.00", cost: "700.00", attributes: {}, reorder_level: 3, is_active: true, available_quantity: 8 }] }] };
const customer = { id: "c1", name: "Rahim Ahmed", normalized_phone: "+8801712345678" };
const profile = { metrics: { successful_deliveries: 7, delivery_outcomes: 8, cod_risk: { score: 10, level: "LOW", reasons: ["Repeat customer"], recommendation: "Proceed normally" } }, addresses: [{ address: "House 12, Road 4, Dhanmondi", area: "Dhanmondi" }] };
const result = { id: "o1", order_number: "ORD-20261009-ABC123", total: "1130.00", risk: { score: 10, level: "LOW", reasons: ["Repeat customer"], recommendation: "Proceed normally" } };

function requestBody(init: RequestInit) {
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function renderPage() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<MemoryRouter><QueryClientProvider client={client}><MotionConfig reducedMotion="always"><OrdersPage/></MotionConfig></QueryClientProvider></MemoryRouter>); }

describe("fast manual order entry", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders" && init?.method === "POST") return Promise.resolve(result);
      if (path === "/api/v1/orders") return Promise.resolve([]);
      if (path.includes("/customers/lookup")) return Promise.resolve(customer);
      if (path.includes("/customers/c1/profile")) return Promise.resolve(profile);
      if (path.includes("/products")) return Promise.resolve(productPage);
      return Promise.resolve([]);
    });
  });

  it("reuses a customer immediately and submits source, lines and totals", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await user.type(screen.getByLabelText("Customer phone"), "01712345678");
    expect(await screen.findByText("7 delivered · 1 returned")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer name")).toHaveValue("Rahim Ahmed");
    expect(screen.getByLabelText("Delivery address")).toHaveValue("House 12, Road 4, Dhanmondi");
    await user.selectOptions(screen.getByLabelText("Order source"), "INSTAGRAM");
    await user.type(screen.getByLabelText("Search products for order"), "panjabi");
    await user.click(await screen.findByRole("button", { name: /Premium Panjabi/ }));
    await user.click(screen.getByRole("button", { name: "Increase Premium Panjabi" }));
    await user.clear(screen.getByLabelText("Discount"));
    await user.type(screen.getByLabelText("Discount"), "150");
    await user.click(screen.getByRole("button", { name: /Create COD order/ }));
    await waitFor(() => expect(apiMock.mock.calls.some(([path, init]) => {
      if (path !== "/api/v1/orders" || init?.method !== "POST") return false;
      const body = requestBody(init) as { customer_id: string; source: string; discount: string; items: { quantity: number }[] };
      return body.customer_id === "c1" && body.source === "INSTAGRAM" && body.discount === "150" && body.items[0]?.quantity === 2;
    })).toBe(true));
    expect(await screen.findByText("ORD-20261009-ABC123")).toBeInTheDocument();
    expect(screen.getByText("Proceed normally")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("creates a new customer inline when the normalized phone is unknown", async () => {
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders" && init?.method === "POST") return Promise.resolve(result);
      if (path === "/api/v1/orders") return Promise.resolve([]);
      if (path.includes("/customers/lookup")) return Promise.reject(new ApiError("Customer was not found", 404, "CUSTOMER_NOT_FOUND"));
      if (path.includes("/products")) return Promise.resolve(productPage);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await user.type(screen.getByLabelText("Customer phone"), "01912345678");
    expect(await screen.findByText("New customer")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Customer name"), "New Customer");
    await user.type(screen.getByLabelText("Delivery address"), "Sector 4, Uttara, Dhaka");
    await user.type(screen.getByLabelText("Search products for order"), "panjabi");
    await user.click(await screen.findByRole("button", { name: /Premium Panjabi/ }));
    await user.click(screen.getByRole("button", { name: /Create COD order/ }));
    await waitFor(() => expect(apiMock.mock.calls.some(([path, init]) => {
      if (path !== "/api/v1/orders" || init?.method !== "POST") return false;
      const body = requestBody(init) as { customer?: { name: string; phone: string } };
      return body.customer?.name === "New Customer" && body.customer.phone === "01912345678";
    })).toBe(true));
  });
});
