import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { User, WorkspaceSettings } from "../lib/api";
import { expectNoAxeViolations } from "../test/axe";
import { useAuthStore } from "../stores/authStore";
import { SettingsPage } from "./SettingsPage";

const settings: WorkspaceSettings = {
  organization: { id: "org-1", name: "RetailOps Demo", slug: "retailops-demo", timezone: "Asia/Dhaka" },
  current_branch: { id: "branch-1", name: "Dhanmondi", code: "DHK", address: "Road 27, Dhaka" },
  branches: [{ id: "branch-1", name: "Dhanmondi", code: "DHK", address: "Road 27, Dhaka" }],
};

const owner: User = {
  id: "user-1",
  organization_id: "org-1",
  organization_name: "RetailOps Demo",
  branch_id: "branch-1",
  branch_name: "Dhanmondi",
  email: "owner@demo.local",
  full_name: "Demo Owner",
  role: "OWNER",
  permissions: ["settings:manage", "staff:manage"],
};

const staff = [
  { id: "user-1", full_name: "Demo Owner", email: "owner@demo.local", role: "OWNER" as const, branch_id: "branch-1", branch_name: "Dhanmondi", is_active: true, created_at: "2026-10-01T00:00:00Z" },
  { id: "user-2", full_name: "Counter Cashier", email: "cashier@demo.local", role: "CASHIER" as const, branch_id: "branch-1", branch_name: "Dhanmondi", is_active: true, created_at: "2026-10-02T00:00:00Z" },
];

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
}

function requestBody(init?: RequestInit) {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

function renderPage(user: User = owner) {
  useAuthStore.setState({ user, accessToken: "token", bootstrapped: true, offlineSession: false, refresh: vi.fn(() => Promise.resolve(true)) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
}

describe("settings page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
      if (url.endsWith("/api/v1/settings/staff") && init?.method === "POST") {
        const payload = requestBody(init);
        return json({ id: "user-3", ...payload, branch_name: "Dhanmondi", is_active: true, created_at: "2026-10-11T00:00:00Z" }, 201);
      }
      if (url.endsWith("/api/v1/settings/staff")) return json(staff);
      if (url.endsWith("/api/v1/settings/organization") && init?.method === "PATCH") return json({ ...settings.organization, ...requestBody(init) });
      if (url.endsWith("/api/v1/settings")) return json(settings);
      return json({});
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads workspace details and saves the business identity", async () => {
    const user = userEvent.setup();
    const view = renderPage();

    expect(await screen.findByRole("heading", { name: "Business identity" })).toBeInTheDocument();
    expect(screen.getByText("Dhanmondi")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Business name" }));
    await user.type(screen.getByRole("textbox", { name: "Business name" }), "Abrar Retail");
    await user.click(screen.getByRole("button", { name: "Save business" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/settings/organization"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Abrar Retail", timezone: "Asia/Dhaka" }) }),
    ));
    await expectNoAxeViolations(view.container);
  });

  it("lets an owner create a role-scoped team account", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: /Team/ }));
    expect((await screen.findAllByText("Counter Cashier")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Add team member" }));
    const dialog = screen.getByRole("dialog", { name: "Add team member" });
    await user.type(within(dialog).getByRole("textbox", { name: "Full name" }), "Warehouse Lead");
    await user.type(within(dialog).getByRole("textbox", { name: "Email address" }), "warehouse@example.com");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Role" }), "WAREHOUSE");
    await user.type(within(dialog).getByLabelText("Initial password"), "Stockroom2026");
    await user.click(within(dialog).getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/settings/staff"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.queryByRole("dialog", { name: "Add team member" })).not.toBeInTheDocument();
  });

  it("hides team administration without staff permission", async () => {
    renderPage({ ...owner, id: "manager-1", role: "MANAGER", permissions: ["settings:manage"] });
    expect(await screen.findByRole("heading", { name: "Business identity" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Team/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings/staff"), expect.anything());
  });
});
