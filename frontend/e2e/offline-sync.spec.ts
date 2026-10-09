import { expect, test } from "@playwright/test";

const user = {
  id: "user-1",
  organization_id: "org-1",
  organization_name: "RetailOps Demo",
  branch_id: "branch-1",
  branch_name: "Dhanmondi",
  email: "cashier@retailops.test",
  full_name: "Tanvir Ahmed",
  role: "CASHIER",
  permissions: [
    "sale:create",
    "product:read",
    "inventory:read",
    "customer:read",
  ],
};

const item = {
  variant_id: "variant-1",
  product_id: "product-1",
  product_name: "Leather Wallet",
  variant_name: "Walnut",
  sku: "WALLET-WN",
  barcode: "100003",
  price: "1290.00",
  category_id: null,
  category_name: null,
  image_url: null,
  attributes: {},
  reorder_level: 3,
  available_quantity: 9,
};

test("offline sale moves through the durable queue when connectivity returns", async ({
  context,
  page,
}) => {
  let syncRequests = 0;
  await page.route(/\/(api|health)\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/auth/refresh") {
      await route.fulfill({
        json: { access_token: "test-token", token_type: "bearer", user },
      });
    } else if (path === "/api/v1/sync/catalog-version") {
      await route.fulfill({
        json: { version: "catalog-v1", variant_count: 1 },
      });
    } else if (path === "/api/v1/sync/catalog") {
      await route.fulfill({
        json: {
          version: "catalog-v1",
          generated_at: new Date().toISOString(),
          categories: [],
          items: [item],
        },
      });
    } else if (path === "/api/v1/sync/stock") {
      await route.fulfill({
        json: {
          as_of: new Date().toISOString(),
          available: { "variant-1": 9 },
        },
      });
    } else if (path === "/api/v1/workspace/counts") {
      await route.fulfill({
        json: {
          pending_orders: 0,
          low_stock: 0,
          open_conflicts: 0,
          unread_notifications: 0,
        },
      });
    } else if (path === "/api/v1/notifications") {
      await route.fulfill({ json: [] });
    } else if (path === "/health/live") {
      await route.fulfill({ json: { status: "ok", version: "test" } });
    } else if (path === "/api/v1/sync/sales") {
      syncRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        json: {
          client_transaction_id: "local",
          status: "SYNCED",
          server_record_id: "sale-1",
          idempotent_replay: false,
          conflict: false,
        },
      });
    } else if (path === "/api/v1/sync/conflicts") {
      await route.fulfill({ json: [] });
    } else {
      await route.fulfill({ json: [] });
    }
  });

  await page.goto("/pos");
  await expect(
    page.getByRole("button", { name: /Add Leather Wallet/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Sync status: Synced/ }),
  ).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.evaluate(
    async () =>
      (await (await fetch("/manifest.webmanifest")).json()) as {
        display: string;
        icons: { sizes: string }[];
      },
  );
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );

  await context.setOffline(true);
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await page.getByRole("button", { name: /Add Leather Wallet/ }).click();
  await page.getByRole("button", { name: /^Checkout/ }).click();
  await page
    .getByRole("dialog", { name: "Checkout" })
    .getByRole("button", { name: /Complete sale/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sale saved offline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /1 waiting to sync/ }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add Leather Wallet/ }),
  ).toBeVisible();
  await expect(page.getByText("8 available")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /1 waiting to sync/ }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Syncing")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Sync status: Synced/ }),
  ).toBeVisible();
  expect(syncRequests).toBe(1);

  await page.goto("/sync");
  await expect(page.getByText("No pending local transactions")).toBeVisible();
});
