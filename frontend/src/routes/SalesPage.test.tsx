import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/authStore";
import { SalesPage } from "./SalesPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({ ...(await original()), api: (path: string, init?: RequestInit) => apiMock(path, init) }));

const sale = {
  id: "sale-1", invoice_number: "POS-20261009-123456-ABCD", subtotal: "2000.00", discount: "100.00", total: "1900.00",
  payment_method: "SPLIT", payments: [{ method: "BKASH", amount: "1000.00" }, { method: "CASH", amount: "900.00" }],
  amount_received: "2000.00", change_due: "100.00", created_at: "2026-10-09T06:30:00Z", cashier_name: "Owner User",
  customer_name: "Nusrat Jahan", synced_offline: false, inventory_conflict: false,
  items: [{ variant_id: "variant-1", product_name: "Premium Panjabi", variant_name: "Emerald · L", sku: "PAN-L", quantity: 2, unit_price: "1000.00", line_total: "2000.00", returned_quantity: 0 }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><SalesPage /></QueryClientProvider></MemoryRouter>);
}

describe("sales receipt and refund workflow", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useAuthStore.setState({ user: {
      id: "owner", organization_id: "org", organization_name: "RetailOps Demo Store", branch_id: "branch", branch_name: "Dhanmondi", branch_address: "Dhaka",
      email: "owner@example.com", full_name: "Owner User", role: "OWNER", permissions: ["sale:create", "sale:refund"],
    } });
    apiMock.mockImplementation((path, init) => {
      if (path.startsWith("/api/v1/pos/sales?") && !init?.method) return Promise.resolve({ items: [{ ...sale, item_count: 2, returned_quantity: 0 }], total: 1, page: 1, page_size: 25 });
      if (path === "/api/v1/pos/sales/sale-1" && !init?.method) return Promise.resolve(sale);
      if (path === "/api/v1/pos/sales/sale-1/refund" && init?.method === "POST") return Promise.resolve({ id: "return-1" });
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  it("opens complete sale detail and supports exact reprint", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /View POS-20261009/ }))[0]);
    const receipt = await screen.findByRole("article", { name: /Receipt POS-20261009/ });
    expect(within(receipt).getByText(/Cashier:/)).toBeInTheDocument();
    expect(within(receipt).getByText("Nusrat Jahan")).toBeInTheDocument();
    expect(within(receipt).getByText("Subtotal")).toBeInTheDocument();
    expect(within(receipt).getByText("BKASH")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reprint" }));
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it("submits a manager-approved partial refund", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /View POS-20261009/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Refund items" }));
    const dialog = screen.getByRole("dialog", { name: "Receive sale return" });
    const quantity = within(dialog).getByRole("spinbutton", { name: /Quantity for Premium Panjabi/ });
    await user.clear(quantity);
    await user.type(quantity, "1");
    await user.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Wrong size selected");
    await user.click(within(dialog).getByRole("button", { name: "Confirm return" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/pos/sales/sale-1/refund", expect.objectContaining({ method: "POST" })));
    const request = apiMock.mock.calls.find(([path, init]) => path.endsWith("/refund") && init?.method === "POST")?.[1];
    expect(typeof request?.body === "string" ? JSON.parse(request.body) : null).toEqual({ reason: "Wrong size selected", items: [{ variant_id: "variant-1", quantity: 1, disposition: "SELLABLE" }] });
  });

  it("hides refund controls without the refund permission", async () => {
    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, permissions: ["sale:create"] } : null }));
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /View POS-20261009/ }))[0]);
    expect(await screen.findByRole("button", { name: "Reprint" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund items" })).not.toBeInTheDocument();
  });
});
