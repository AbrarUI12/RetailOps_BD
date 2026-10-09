import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { ReportsPage } from "./ReportsPage";

const apiMock = vi.fn<(path: string) => Promise<unknown>>();
const downloadMock = vi.fn<(path: string, filename: string) => Promise<void>>();
vi.mock("../lib/api", async (original) => ({
  ...(await original()),
  api: (path: string) => apiMock(path),
  downloadFile: (path: string, filename: string) => downloadMock(path, filename),
}));

const report = {
  start: "2026-10-01", end: "2026-10-09",
  sales: { transactions: 2, revenue: "6000.00", refunds: "1000.00", net_revenue: "5000.00", discount: "300.00", cost_of_goods_sold: "3000.00", gross_profit: "2000.00", average_sale: "3000.00", offline_synced: 1, by_payment_method: { CASH: "2500.00", BKASH: "3500.00" } },
  top_products: [{ product_name: "Premium Panjabi", variant_name: "Emerald · L", sku: "PAN-L", quantity: 4, returned_quantity: 1, net_quantity: 3, revenue: "3600.00", cost: "2100.00", gross_profit: "1500.00", margin: 0.4167 }],
  inventory: { units_on_hand: 25, units_reserved: 3, units_available: 22, cost_value: "15000.00", retail_value: "30000.00", low_stock: 2, out_of_stock: 1 },
  cod: { total: 5, value: "12000.00", by_status: { DELIVERED: 2 }, by_risk: { LOW: 3, HIGH: 2 }, delivered: 2, returned: 1, collected: "5000.00", pending: "4000.00", failed: "3000.00", return_loss: "3000.00", delivery_rate: 0.6667 },
  courier: { shipments: 4, delivered: 2, returned: 1, in_transit: 1, failed: 0, by_provider: { MOCK_COURIER: 4 }, by_status: { DELIVERED: 2, RETURNED: 1, IN_TRANSIT: 1 }, delivery_rate: 0.6667 },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><ReportsPage/></QueryClientProvider></MemoryRouter>);
}

describe("reports suite", () => {
  beforeEach(() => {
    apiMock.mockReset();
    downloadMock.mockReset();
    apiMock.mockResolvedValue(report);
    downloadMock.mockResolvedValue(undefined);
  });

  it("renders sales, product, inventory, COD and courier evidence accessibly", async () => {
    const { container } = renderPage();
    expect(await screen.findByRole("heading", { name: "Product performance" })).toBeInTheDocument();
    expect(screen.getAllByText("Premium Panjabi").length).toBeGreaterThan(0);
    expect(screen.getByText("Available units")).toBeInTheDocument();
    expect(screen.getByText("Collected")).toBeInTheDocument();
    expect(screen.getByText("Return loss exposure")).toBeInTheDocument();
    expect(screen.getByText("Courier outcomes")).toBeInTheDocument();
    expect(screen.getAllByText("67%").length).toBeGreaterThan(0);
    await expectNoAxeViolations(container);
  });

  it("supports custom dates and both useful CSV exports", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Product performance" });
    fireEvent.change(screen.getByLabelText("Report start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Report end date"), { target: { value: "2026-10-09" } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/reports/summary?start=2026-10-01&end=2026-10-09"));
    await user.click(screen.getByRole("button", { name: "Sales CSV" }));
    await user.click(screen.getByRole("button", { name: "Products CSV" }));
    expect(downloadMock).toHaveBeenCalledWith(expect.stringContaining("/reports/sales.csv?start=2026-10-01&end=2026-10-09"), expect.stringContaining("retailops-sales"));
    expect(downloadMock).toHaveBeenCalledWith(expect.stringContaining("/reports/products.csv?start=2026-10-01&end=2026-10-09"), expect.stringContaining("retailops-products"));
  });
});
