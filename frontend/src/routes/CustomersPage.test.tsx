import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/authStore";
import { expectNoAxeViolations } from "../test/axe";
import { CustomersPage } from "./CustomersPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({ ...(await original()), api: (path: string, init?: RequestInit) => apiMock(path, init) }));

const customer = { id: "c1", name: "Rahim Ahmed", phone: "01712345678", normalized_phone: "+8801712345678", phone_verified: false, notes: "Prefers evening delivery", created_at: "2026-10-09T05:00:00Z" };
const profile = {
  customer,
  metrics: { total_spend: "3250.00", sale_count: 1, order_count: 2, successful_deliveries: 1, delivery_outcomes: 1, delivery_success_rate: 100, cod_risk: { score: 5, level: "LOW", reasons: ["Repeat customer"], recommendation: "Proceed normally" } },
  addresses: [{ id: "a1", label: "Home", address: "House 12, Road 4", area: "Dhanmondi", city: "Dhaka", created_at: "2026-10-09T05:00:00Z" }],
  purchases: [{ id: "s1", kind: "SALE", reference: "POS-001", status: "COMPLETED", source: "POS", total: "1250.00", created_at: "2026-10-09T06:00:00Z" }],
  payments: [{ id: "p1", reference: "POS-001", method: "CASH", amount: "1250.00", created_at: "2026-10-09T06:00:00Z" }], returns: [],
  activity: [{ id: "x1", kind: "customer.created", title: "Customer Created", detail: null, created_at: "2026-10-09T05:00:00Z" }],
};

function renderPage(path = "/customers") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><MotionConfig reducedMotion="always"><CustomersPage /></MotionConfig></QueryClientProvider></MemoryRouter>);
}

describe("customers vertical slice", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path) => {
      if (path.includes("/profile")) return Promise.resolve(profile);
      if (path.includes("/addresses")) return Promise.resolve(profile.addresses[0]);
      return Promise.resolve([customer]);
    });
    useAuthStore.setState({ user: { id: "owner", organization_id: "org", organization_name: "RetailOps", branch_id: "branch", branch_name: "Dhanmondi", email: "owner@example.com", full_name: "Owner", role: "OWNER", permissions: ["customer:read", "customer:write"] } });
  });

  it("opens an accessible profile with real metrics and history", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click((await screen.findAllByRole("button", { name: "View Rahim Ahmed" }))[0]);
    expect(await screen.findByText("৳3,250")).toBeInTheDocument();
    expect(screen.getByText("Proceed normally")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /POS-001/ })).toHaveAttribute("href", "/sales?sale=s1");
    await expectNoAxeViolations(container);
  });

  it("supports keyboard tab navigation and adding an address", async () => {
    const user = userEvent.setup();
    renderPage("/customers?customer=c1");
    const overview = await screen.findByRole("tab", { name: "Overview" });
    overview.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Addresses" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Add address" }));
    await user.clear(screen.getByLabelText("Address"));
    await user.type(screen.getByLabelText("Address"), "Level 4, Motijheel Commercial Area");
    await user.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/customers/c1/addresses", expect.objectContaining({ method: "POST" })));
  });

  it("hides write actions from read-only staff", async () => {
    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, permissions: ["customer:read"] } : null }));
    renderPage("/customers?customer=c1");
    expect(await screen.findByText("Rahim Ahmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add customer" })).not.toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Addresses" }));
    expect(screen.queryByRole("button", { name: "Add address" })).not.toBeInTheDocument();
  });
});
