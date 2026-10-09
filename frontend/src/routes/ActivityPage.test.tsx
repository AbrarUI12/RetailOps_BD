import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationLink } from "../lib/notifications";
import { useAuthStore } from "../stores/authStore";
import { expectNoAxeViolations } from "../test/axe";
import { ActivityPage } from "./ActivityPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({
  ...(await original()),
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));

const event = {
  id: "audit-1", action: "inventory.adjusted", entity_type: "product_variant", entity_id: "variant-1",
  user_id: "owner", actor_name: "Owner User", actor_email: "owner@example.com",
  old_data: { physical_quantity: 3 }, new_data: { physical_quantity: 5, reason: "Stock count" },
  request_id: "req-123", ip_address: "127.0.0.1", user_agent: "Chrome", created_at: "2026-10-09T12:00:00Z",
};
const notification = {
  id: "notice-1", kind: "LOW_STOCK", title: "Low stock", message: "Panjabi L has 2 available.",
  read_at: null, entity_type: "product_variant", entity_id: "variant-1", created_at: "2026-10-09T12:00:00Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><ActivityPage/></QueryClientProvider></MemoryRouter>);
}

describe("activity and notifications", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useAuthStore.setState({ user: {
      id: "owner", organization_id: "org", organization_name: "RetailOps", branch_id: "branch", branch_name: "Dhanmondi",
      email: "owner@example.com", full_name: "Owner User", role: "OWNER", permissions: ["product:read", "audit:read"],
    } });
    apiMock.mockImplementation((path, init) => {
      if (path.startsWith("/api/v1/audit?") && !init?.method) return Promise.resolve({ items: [event], page: 1, page_size: 25, total: 1 });
      if (path === "/api/v1/notifications" && !init?.method) return Promise.resolve([notification]);
      if (path === "/api/v1/notifications/notice-1/read" && init?.method === "POST") return Promise.resolve({ ...notification, read_at: "2026-10-09T12:10:00Z" });
      if (path === "/api/v1/notifications/read-all" && init?.method === "POST") return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected API call: ${path}`));
    });
  });

  it("filters and inspects immutable audit context", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    const row = await screen.findByRole("button", { name: /Inventory · Adjusted/ });
    await user.click(row);
    const drawer = screen.getByRole("dialog", { name: "Inventory · Adjusted" });
    expect(within(drawer).getByText("req-123")).toBeInTheDocument();
    expect(within(drawer).getByText("Stock count")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Open record" })).toHaveAttribute("href", "/inventory?variant=variant-1");
    await expectNoAxeViolations(container);
  });

  it("marks individual and all notifications read", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Low stock/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/notifications/notice-1/read", { method: "POST" }));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/v1/notifications/read-all", { method: "POST" }));
  });

  it("shows notifications without requesting audit data for a cashier", async () => {
    useAuthStore.setState((state) => ({ user: state.user ? { ...state.user, role: "CASHIER", permissions: ["product:read"] } : null }));
    renderPage();
    expect(await screen.findByText("Low stock")).toBeInTheDocument();
    expect(screen.queryByText("Audit trail")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.some(([path]) => path.startsWith("/api/v1/audit"))).toBe(false);
  });

  it("maps entity notifications to useful deep links", () => {
    expect(notificationLink(notification)).toBe("/inventory?variant=variant-1");
    expect(notificationLink({ kind: "SYNC_CONFLICT", entity_type: "sale", entity_id: "sale-1" })).toBe("/sync");
  });
});
