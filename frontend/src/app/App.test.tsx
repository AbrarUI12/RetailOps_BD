import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import type { User } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { useUIStore } from "../stores/uiStore";

const OWNER_PERMISSIONS = [
  "product:read", "product:write", "inventory:read", "inventory:adjust", "sale:create", "customer:read",
  "order:read", "order:write", "purchase:write", "report:read", "audit:read", "settings:manage",
];

function signIn(role: "OWNER" | "CASHIER") {
  const user: User = {
    id: "u1",
    organization_id: "o1",
    organization_name: "RetailOps Demo",
    branch_id: "b1",
    branch_name: "Dhanmondi",
    email: `${role.toLowerCase()}@retailopsbd.com`,
    full_name: role === "OWNER" ? "Abrar Rahman" : "Tanvir Ahmed",
    role,
    permissions: role === "OWNER" ? OWNER_PERMISSIONS : ["product:read", "inventory:read", "sale:create", "customer:read"],
  };
  useAuthStore.setState({ user, accessToken: "token", bootstrapped: true, offlineSession: false });
}

function renderShell(path = "/products") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<h1>Page body</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("application shell", () => {
  beforeEach(() => {
    useUIStore.setState({ commandOpen: false, sidebarCollapsed: false });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.includes("/workspace/counts")
                ? { orders_to_action: 4, low_stock: 2, open_conflicts: 1, unread_notifications: 3 }
                : [],
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the owner every area with live badge counts", async () => {
    signIn("OWNER");
    renderShell("/inventory");

    const primary = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(primary).getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(await within(primary).findByRole("link", { name: "Orders, 4" })).toBeInTheDocument();
    expect(within(primary).getByRole("link", { name: "Inventory, 2" })).toHaveClass("active");
    expect(await screen.findByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    expect(screen.getByText("RetailOps Demo")).toBeInTheDocument();
  });

  it("hides areas a cashier cannot open", () => {
    signIn("CASHIER");
    renderShell("/pos");

    const primary = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(primary).getByRole("link", { name: "Point of sale" })).toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: /Orders/ })).not.toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: "Reports" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("opens search with the keyboard and lists only permitted actions", async () => {
    signIn("CASHIER");
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    expect(screen.getByRole("option", { name: /Start a new sale/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create an order/ })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("gives phones a More menu with every area and sign-out", async () => {
    signIn("OWNER");
    const user = userEvent.setup();
    renderShell("/dashboard");

    await user.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "Menu" });

    expect(within(sheet).getByRole("link", { name: /Purchases/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
