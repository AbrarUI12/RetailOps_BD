import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { expectNoAxeViolations } from "../test/axe";
import { OrdersPage } from "./OrdersPage";

const apiMock = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock("../lib/api", async (original) => ({
  ...(await original()),
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));

const productPage = {
  items: [
    {
      id: "p1",
      name: "Premium Panjabi",
      sku: "PP",
      description: null,
      category_id: null,
      category_name: null,
      image_url: null,
      is_active: true,
      created_at: "2026-10-09T00:00:00Z",
      variants: [
        {
          id: "v1",
          product_id: "p1",
          name: "Emerald · L",
          sku: "PP-EL",
          barcode: "123",
          price: "1200.00",
          cost: "700.00",
          attributes: {},
          reorder_level: 3,
          is_active: true,
          available_quantity: 8,
        },
      ],
    },
  ],
};
const customer = {
  id: "c1",
  name: "Rahim Ahmed",
  normalized_phone: "+8801712345678",
};
const profile = {
  metrics: {
    successful_deliveries: 7,
    delivery_outcomes: 8,
    cod_risk: {
      score: 10,
      level: "LOW",
      reasons: ["Repeat customer"],
      recommendation: "Proceed normally",
    },
  },
  addresses: [{ address: "House 12, Road 4, Dhanmondi", area: "Dhanmondi" }],
};
const result = {
  id: "o1",
  order_number: "ORD-20261009-ABC123",
  total: "1130.00",
  risk: {
    score: 10,
    level: "LOW",
    reasons: ["Repeat customer"],
    recommendation: "Proceed normally",
  },
};
const order = {
  ...result,
  customer_id: "c1",
  source: "FACEBOOK",
  status: "PENDING_CONFIRMATION",
  subtotal: "1200.00",
  delivery_fee: "80.00",
  discount: "150.00",
  delivery_address: "House 12, Road 4, Dhanmondi",
  area: "Dhanmondi",
  created_at: "2026-10-09T06:00:00Z",
  items: [
    {
      variant_id: "v1",
      product_name: "Premium Panjabi",
      quantity: 1,
      unit_price: "1200.00",
      line_total: "1200.00",
    },
  ],
};
const detail = {
  order,
  customer: {
    id: "c1",
    name: "Rahim Ahmed",
    normalized_phone: "+8801712345678",
    phone_verified: true,
  },
  events: [
    {
      id: "e1",
      from_status: null,
      to_status: "PENDING_CONFIRMATION",
      note: "Order created",
      created_at: "2026-10-09T06:00:00Z",
    },
  ],
  reservations: [],
  shipment_booked: false,
};
const readyOrder = { ...order, status: "READY_FOR_SHIPMENT" };
const failedOrder = {
  ...order,
  status: "FAILED_DELIVERY",
  items: [{ ...order.items[0], quantity: 3 }],
};
const shipment = {
  id: "s1",
  order_id: "o1",
  provider: "MOCK_COURIER",
  tracking_code: "RBDABC123",
  status: "CREATED",
  created_at: "2026-10-09T07:00:00Z",
  order_status: "READY_FOR_SHIPMENT",
  events: [
    {
      status: "CREATED",
      description: "Booked with MOCK_COURIER",
      occurred_at: "2026-10-09T07:00:00Z",
    },
  ],
};

function requestBody(init: RequestInit) {
  if (typeof init.body !== "string")
    throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="always">
          <OrdersPage />
        </MotionConfig>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("fast manual order entry", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders" && init?.method === "POST")
        return Promise.resolve(result);
      if (path === "/api/v1/orders") return Promise.resolve([]);
      if (path.includes("/customers/lookup")) return Promise.resolve(customer);
      if (path.includes("/customers/c1/profile"))
        return Promise.resolve(profile);
      if (path.includes("/products")) return Promise.resolve(productPage);
      return Promise.resolve([]);
    });
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
        permissions: [
          "order:read",
          "order:write",
          "order:confirm",
          "order:cancel",
          "shipment:create",
          "return:create",
        ],
      },
    });
  });

  it("reuses a customer immediately and submits source, lines and totals", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await user.type(screen.getByLabelText("Customer phone"), "01712345678");
    expect(
      await screen.findByText("7 delivered · 1 returned"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Customer name")).toHaveValue("Rahim Ahmed");
    expect(screen.getByLabelText("Delivery address")).toHaveValue(
      "House 12, Road 4, Dhanmondi",
    );
    await user.selectOptions(
      screen.getByLabelText("Order source"),
      "INSTAGRAM",
    );
    await user.type(
      screen.getByLabelText("Search products for order"),
      "panjabi",
    );
    await user.click(
      await screen.findByRole("button", { name: /Premium Panjabi/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Increase Premium Panjabi" }),
    );
    await user.clear(screen.getByLabelText("Discount"));
    await user.type(screen.getByLabelText("Discount"), "150");
    await user.click(screen.getByRole("button", { name: /Create COD order/ }));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([path, init]) => {
          if (path !== "/api/v1/orders" || init?.method !== "POST")
            return false;
          const body = requestBody(init) as {
            customer_id: string;
            source: string;
            discount: string;
            items: { quantity: number }[];
          };
          return (
            body.customer_id === "c1" &&
            body.source === "INSTAGRAM" &&
            body.discount === "150" &&
            body.items[0]?.quantity === 2
          );
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("ORD-20261009-ABC123")).toBeInTheDocument();
    expect(screen.getByText("Proceed normally")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("creates a new customer inline when the normalized phone is unknown", async () => {
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders" && init?.method === "POST")
        return Promise.resolve(result);
      if (path === "/api/v1/orders") return Promise.resolve([]);
      if (path.includes("/customers/lookup"))
        return Promise.reject(
          new ApiError("Customer was not found", 404, "CUSTOMER_NOT_FOUND"),
        );
      if (path.includes("/products")) return Promise.resolve(productPage);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await user.type(screen.getByLabelText("Customer phone"), "01912345678");
    expect(await screen.findByText("New customer")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Customer name"), "New Customer");
    await user.type(
      screen.getByLabelText("Delivery address"),
      "Sector 4, Uttara, Dhaka",
    );
    await user.type(
      screen.getByLabelText("Search products for order"),
      "panjabi",
    );
    await user.click(
      await screen.findByRole("button", { name: /Premium Panjabi/ }),
    );
    await user.click(screen.getByRole("button", { name: /Create COD order/ }));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([path, init]) => {
          if (path !== "/api/v1/orders" || init?.method !== "POST")
            return false;
          const body = requestBody(init) as {
            customer?: { name: string; phone: string };
          };
          return (
            body.customer?.name === "New Customer" &&
            body.customer.phone === "01912345678"
          );
        }),
      ).toBe(true),
    );
  });

  it("filters the queue and opens status history with guarded actions", async () => {
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders/o1") return Promise.resolve(detail);
      if (path === "/api/v1/orders/o1/confirm" && init?.method === "POST")
        return Promise.resolve({ ...order, status: "CONFIRMED" });
      if (path.startsWith("/api/v1/orders")) return Promise.resolve([order]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(
      await screen.findByRole("button", { name: "Needs confirmation" }),
    );
    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([path]) =>
          path.includes("status=PENDING_CONFIRMATION"),
        ),
      ).toBe(true),
    );
    await user.click(
      (
        await screen.findAllByRole("button", {
          name: "View ORD-20261009-ABC123",
        })
      )[0],
    );
    expect(await screen.findByText("Status timeline")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rahim Ahmed/ })).toHaveAttribute(
      "href",
      "/customers?customer=c1",
    );
    expect(
      screen.getByRole("heading", { name: "Low — 10/100" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Repeat customer")).toBeInTheDocument();
    expect(screen.getByText("Proceed normally")).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole("button", { name: "Confirm & reserve" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/orders/o1/confirm",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("books a courier and operates the shipment tracking timeline", async () => {
    let booked = false;
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/orders/o1/shipment" && init?.method === "POST") {
        booked = true;
        return Promise.resolve(shipment);
      }
      if (path === "/api/v1/orders/o1/shipment")
        return Promise.resolve(shipment);
      if (path === "/api/v1/shipments/s1/refresh" && init?.method === "POST")
        return Promise.resolve(shipment);
      if (path === "/api/v1/shipments/s1/cancel" && init?.method === "POST")
        return Promise.resolve({ ...shipment, status: "CANCELLED" });
      if (path === "/api/v1/orders/o1")
        return Promise.resolve({
          ...detail,
          order: readyOrder,
          shipment_booked: booked,
        });
      if (path.startsWith("/api/v1/orders"))
        return Promise.resolve([readyOrder]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(
      (
        await screen.findAllByRole("button", {
          name: "View ORD-20261009-ABC123",
        })
      )[0],
    );
    await user.click(
      await screen.findByRole("button", { name: "Book courier" }),
    );
    expect(await screen.findByText("RBDABC123")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Shipment tracking timeline"),
    ).toHaveTextContent("Booked with MOCK_COURIER");
    await user.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/shipments/s1/refresh",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/shipments/s1/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await expectNoAxeViolations(container);
  });

  it("receives an RTO with an explicit disposition and shows its history", async () => {
    let records: Record<string, unknown>[] = [];
    apiMock.mockImplementation((path, init) => {
      if (path === "/api/v1/returns" && init?.method === "POST") {
        const body = requestBody(init);
        const record = {
          id: "r1",
          order_id: "o1",
          status: "RECEIVED",
          reason: body.reason,
          created_at: "2026-10-09T08:00:00Z",
          items: body.items,
        };
        records = [record];
        return Promise.resolve(record);
      }
      if (path === "/api/v1/returns?order_id=o1")
        return Promise.resolve(records);
      if (path === "/api/v1/orders/o1")
        return Promise.resolve({ ...detail, order: failedOrder });
      if (path.startsWith("/api/v1/orders"))
        return Promise.resolve([failedOrder]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(
      (
        await screen.findAllByRole("button", {
          name: "View ORD-20261009-ABC123",
        })
      )[0],
    );
    await user.click(
      await screen.findByRole("button", { name: "Receive return" }),
    );
    await user.clear(screen.getByLabelText("Quantity for Premium Panjabi"));
    await user.type(screen.getByLabelText("Quantity for Premium Panjabi"), "2");
    await user.selectOptions(screen.getByLabelText("Condition"), "DAMAGED");
    await user.type(
      screen.getByLabelText("Return reason"),
      "Customer refused parcel",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm received goods" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/returns",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = apiMock.mock.calls.find(
      ([path, init]) => path === "/api/v1/returns" && init?.method === "POST",
    );
    expect(requestBody(call?.[1] as RequestInit)).toMatchObject({
      order_id: "o1",
      reason: "Customer refused parcel",
      items: [{ variant_id: "v1", quantity: 2, disposition: "DAMAGED" }],
    });
    expect(
      await screen.findByText("Customer refused parcel"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 Damaged")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
