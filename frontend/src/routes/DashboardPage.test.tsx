import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/authStore";
import { expectNoAxeViolations } from "../test/axe";
import { DashboardPage } from "./DashboardPage";

const apiMock = vi.fn<(path: string) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({ ...(await original()), api: (path: string) => apiMock(path) }));

const report = {
  start: "2026-10-09", end: "2026-10-09", branch_id: "branch-1", branches: [{ id: "branch-1", name: "Dhanmondi" }, { id: "branch-2", name: "Gulshan" }],
  kpis: { revenue: "5700.00", sales: 3, orders: 2, gross_profit: "2100.00", average_order_value: "1900.00", pending_orders: 1, low_stock: 2 },
  revenue_series: [{ label: "10 AM", revenue: "2000.00" }, { label: "12 PM", revenue: "3700.00" }],
  orders_by_source: { FACEBOOK: 2 },
  top_products: [{ product_name: "Premium Panjabi", variant_name: "Emerald · L", quantity: 3, revenue: "3600.00" }],
  low_stock_items: [{ variant_id: "v1", product_name: "Canvas Sneaker", variant_name: "42", sku: "SN-42", available_quantity: 2, reorder_level: 5 }],
  recent_sales: [{ id: "s1", invoice_number: "POS-20261009-001", total: "1900.00", created_at: "2026-10-09T05:00:00Z" }],
  recent_orders: [{ id: "o1", order_number: "ORD-001", source: "FACEBOOK", status: "PENDING_CONFIRMATION", total: "2500.00", created_at: "2026-10-09T05:00:00Z" }],
  courier_success_rate: 0.8,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><MotionConfig reducedMotion="always"><DashboardPage /></MotionConfig></QueryClientProvider></MemoryRouter>);
}

describe("dashboard vertical slice", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue(report);
    useAuthStore.setState({ user: {
      id: "owner", organization_id: "org", organization_name: "RetailOps", branch_id: "branch-1", branch_name: "Dhanmondi", branch_address: "Dhaka",
      email: "owner@example.com", full_name: "Abrar Rahman", role: "OWNER", permissions: ["report:read", "sale:create"],
    } });
  });

  it("renders KPIs, operational signals and linked recent activity", async () => {
    const { container } = renderPage();
    expect(await screen.findByText("৳5,700")).toBeInTheDocument();
    expect(screen.getByText("Revenue trend")).toBeInTheDocument();
    expect(screen.getByText("Orders by source")).toBeInTheDocument();
    expect(screen.getByText("Canvas Sneaker")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /POS-20261009-001/ })).toHaveAttribute("href", "/sales?sale=s1");
    expect(screen.getByRole("link", { name: /ORD-001/ })).toHaveAttribute("href", "/orders?focus=o1");
    await expectNoAxeViolations(container);
  });

  it("crossfades new timeframe and branch queries", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Revenue trend");
    await user.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.includes("start=") && path.includes("end=") && path.includes("branch_id=branch-1"))).toBe(true));
    await user.selectOptions(screen.getByRole("combobox", { name: "Branch" }), "branch-2");
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.includes("branch_id=branch-2"))).toBe(true));
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  });
});
