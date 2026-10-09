import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { User } from "../lib/api";
import { offlineDb } from "../lib/offlineDb";
import { useAuthStore } from "../stores/authStore";
import { useCartStore } from "../stores/cartStore";
import { expectNoAxeViolations } from "../test/axe";
import { PosPage } from "./PosPage";

const cashier: User = {
  id: "u1", organization_id: "o1", organization_name: "Demo Store", branch_id: "b1", branch_name: "Dhanmondi",
  email: "cashier@retailopsbd.com", full_name: "Tanvir Ahmed", role: "CASHIER", permissions: ["sale:create", "product:read", "customer:read"],
};
const item = {
  variant_id: "v1", product_id: "p1", product_name: "Leather Wallet", variant_name: "Walnut", sku: "WALLET-WN", barcode: "100003", price: "1290.00",
  category_id: null, category_name: null, image_url: null, attributes: {}, reorder_level: 5, available_quantity: 9,
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

let sales: Record<string, unknown>[] = [];
let rejectSale = false;

function stubServer() {
  sales = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/sync/catalog-version")) return json({ version: "v1", variant_count: 1 });
    if (url.endsWith("/sync/catalog")) return json({ version: "v1", generated_at: "2026-10-09T06:00:00Z", categories: [], items: [item] });
    if (url.endsWith("/sync/stock")) return json({ as_of: "2026-10-09T06:00:00Z", available: { v1: 9 } });
    if (url.includes("/customers?search=")) return json([{ id: "c1", name: "Nusrat Jahan", phone: "+8801712345678" }]);
    if (url.endsWith("/pos/sales") && init?.method === "POST") {
      if (rejectSale) return json({ error: { code: "INSUFFICIENT_STOCK", message: "Stock changed before checkout", details: {} } }, 409);
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      sales.push(body);
      return json({ id: "s1", invoice_number: "POS-20261009-0001", total: "1290.00", amount_received: String(body.amount_received), change_due: "210.00", created_at: "2026-10-09T06:00:00Z", items: [], inventory_conflict: false }, 201);
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  }));
}

function renderPos() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><PosPage /></MemoryRouter></QueryClientProvider>);
}

async function addWallet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Add Leather Wallet/ }));
  expect(within(screen.getByRole("complementary", { name: "Current cart" })).getByText("Leather Wallet")).toBeInTheDocument();
}

describe("POS checkout", () => {
  beforeEach(async () => {
    rejectSale = false;
    await Promise.all([offlineDb.catalog.clear(), offlineDb.categories.clear(), offlineDb.meta.clear(), offlineDb.pendingSales.clear()]);
    useCartStore.getState().clear();
    useAuthStore.setState({ user: cashier, accessToken: "token", bootstrapped: true });
    stubServer();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens checkout with F9, gives change on quick cash and completes with F9", async () => {
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);

    await user.keyboard("{F9}");
    const sheet = await screen.findByRole("dialog", { name: "Checkout" });
    await user.click(within(sheet).getByRole("button", { name: "৳1,500" }));
    expect(within(sheet).getByText("Change due").nextSibling).toHaveTextContent("৳210");
    await user.keyboard("{F9}");

    expect(await screen.findByRole("heading", { name: "Payment successful" })).toBeInTheDocument();
    expect(sales[0]).toMatchObject({ payment_method: "CASH", amount_received: 1500, discount: "0.00", customer_id: null, items: [{ variant_id: "v1", quantity: 1, unit_price: "1290.00" }] });
  });

  it("takes split payments", async () => {
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);
    await user.click(screen.getByRole("button", { name: /^Checkout/ }));
    const sheet = await screen.findByRole("dialog", { name: "Checkout" });

    await user.click(within(sheet).getByRole("button", { name: "Split" }));
    const complete = within(sheet).getByRole("button", { name: /Complete sale/ });
    expect(complete).toBeDisabled();
    await user.type(within(sheet).getByLabelText("Payment line 1 amount"), "1000");
    await user.click(within(sheet).getAllByRole("button", { name: "Rest" })[1]);
    await user.click(complete);

    await screen.findByRole("heading", { name: "Payment successful" });
    expect(sales[0]).toMatchObject({ payment_method: "SPLIT", payments: [{ method: "BKASH", amount: "1000.00" }, { method: "CASH", amount: "290.00" }] });
  });

  it("finds a customer with F4 and applies a percentage discount", async () => {
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);

    await user.keyboard("{F4}");
    const sheet = await screen.findByRole("dialog", { name: "Checkout" });
    await vi.waitFor(() => expect(within(sheet).getByLabelText("Find customer by phone or name")).toHaveFocus());
    await user.keyboard("01712345678");
    await user.click(await within(sheet).findByRole("button", { name: /Nusrat Jahan/ }));
    await user.click(within(sheet).getByRole("button", { name: "%" }));
    await user.type(within(sheet).getByLabelText("Discount percent"), "10");
    expect(within(sheet).getAllByText("−৳129")).toHaveLength(2);
    await expectNoAxeViolations(sheet);
    await user.click(within(sheet).getByRole("button", { name: /Complete sale/ }));

    await screen.findByRole("heading", { name: "Payment successful" });
    expect(sales[0]).toMatchObject({ customer_id: "c1", discount: "129.00", amount_received: 1161 });
  });

  it("jumps to discount with F6 and payment with F8", async () => {
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);

    await user.keyboard("{F6}");
    await vi.waitFor(() => expect(screen.getByLabelText("Discount in taka")).toHaveFocus());
    await user.keyboard("{Escape}");
    await user.keyboard("{F8}");

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Cash", pressed: true })).toHaveFocus());
  });

  it("refuses underpayment and closes with Escape", async () => {
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);
    await user.keyboard("{F9}");
    const sheet = await screen.findByRole("dialog", { name: "Checkout" });

    await user.type(within(sheet).getByLabelText("Cash received"), "1000");
    expect(within(sheet).getByText("৳290 still to pay")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Complete sale/ })).toBeDisabled();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Checkout" })).not.toBeInTheDocument();
    expect(sales).toHaveLength(0);
  });

  it("keeps the cart open when the server rejects an online sale", async () => {
    rejectSale = true;
    const user = userEvent.setup();
    renderPos();
    await addWallet(user);
    await user.keyboard("{F9}");
    const sheet = await screen.findByRole("dialog", { name: "Checkout" });

    await user.click(within(sheet).getByRole("button", { name: /Complete sale/ }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Stock changed before checkout",
    );
    expect(within(sheet).getByRole("button", { name: /Complete sale/ })).toBeEnabled();
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(await offlineDb.pendingSales.count()).toBe(0);
    expect(screen.queryByRole("heading", { name: "Payment successful" })).not.toBeInTheDocument();
  });
});
