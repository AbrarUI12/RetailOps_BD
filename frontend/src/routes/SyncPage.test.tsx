import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { useAuthStore } from "../stores/authStore";
import { useSyncStore } from "../stores/syncStore";
import { expectNoAxeViolations } from "../test/axe";
import { SyncPage, type Conflict } from "./SyncPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", () => ({
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));
vi.mock("../lib/offlineDb", () => ({
  offlineDb: {
    pendingSales: {
      orderBy: () => ({
        reverse: () => ({ toArray: () => Promise.resolve([]) }),
      }),
    },
  },
}));
vi.mock("../lib/syncEngine", () => ({ processSyncQueue: vi.fn() }));

const conflict: Conflict = {
  id: "conflict-1",
  sync_transaction_id: "sync-1",
  type: "INVENTORY_OVERSELL",
  details: {
    sale_id: "sale-1",
    invoice_number: "POS-20261009-0042",
    lines: [
      {
        variant_id: "v1",
        product: "Leather Wallet · Walnut",
        sku: "WALLET-WN",
        quantity_sold: 3,
        stock_before: 1,
        stock_after: -2,
      },
    ],
  },
  created_at: "2026-10-09T06:00:00Z",
  reviewed: false,
  reviewed_at: null,
  resolution: null,
  resolution_note: null,
};

function requestBody(init: RequestInit | undefined) {
  if (typeof init?.body !== "string") throw new Error("Expected JSON body");
  return JSON.parse(init.body) as { resolution: string; note: string };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SyncPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("sync conflict reconciliation", () => {
  beforeEach(() => {
    let current = conflict;
    apiMock.mockReset();
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/sync/conflicts" && !init)
        return Promise.resolve([current]);
      if (
        path === "/api/v1/sync/conflicts/conflict-1/resolve" &&
        init?.method === "POST"
      ) {
        const body = requestBody(init);
        current = {
          ...current,
          reviewed: true,
          reviewed_at: "2026-10-09T07:00:00Z",
          resolution: body.resolution,
          resolution_note: body.note,
        };
        return Promise.resolve(current);
      }
      return Promise.resolve([]);
    });
    useSyncStore.setState({ status: "SYNCED", pending: 0 });
    useAuthStore.setState({
      user: {
        id: "owner",
        organization_id: "org",
        organization_name: "RetailOps",
        branch_id: "branch",
        branch_name: "Dhanmondi",
        email: "owner@example.com",
        full_name: "Owner",
        role: "OWNER",
        permissions: ["inventory:read", "inventory:adjust"],
      },
      bootstrapped: true,
    });
  });

  it("shows oversell evidence and records a manager resolution", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(
      await screen.findByRole("button", { name: /INVENTORY OVERSELL/i }),
    );
    const dialog = screen.getByRole("dialog", { name: "Sold beyond stock" });
    expect(
      within(dialog).getByText("Leather Wallet · Walnut"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 → -2")).toBeInTheDocument();
    expect(
      within(dialog).getByText("The sale is preserved."),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Resolution"),
      "STOCK_RECOUNT_REQUESTED",
    );
    await user.type(
      within(dialog).getByLabelText("Resolution note"),
      "Warehouse recount assigned to Rafiq",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Resolve conflict" }),
    );
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(
          ([path, init]) =>
            path === "/api/v1/sync/conflicts/conflict-1/resolve" &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
    const call = apiMock.mock.calls.find(
      ([path, init]) =>
        path === "/api/v1/sync/conflicts/conflict-1/resolve" &&
        init?.method === "POST",
    );
    expect(requestBody(call?.[1])).toEqual({
      resolution: "STOCK_RECOUNT_REQUESTED",
      note: "Warehouse recount assigned to Rafiq",
    });
    expect(await screen.findByText("Resolved")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
