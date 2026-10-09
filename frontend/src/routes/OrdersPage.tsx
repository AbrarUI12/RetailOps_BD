import {
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  PackageCheck,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { OrderEntrySheet } from "../components/orders/OrderEntrySheet";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataState } from "../components/ui/DataState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { SelectField, TextareaField } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../components/ui/Sheet";
import { api } from "../lib/api";
import { formatBDT, formatDateTime, label } from "../lib/format";
import { can } from "../lib/permissions";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";

interface OrderItem {
  variant_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}
interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  source: string;
  status: string;
  subtotal: string;
  delivery_fee: string;
  discount: string;
  total: string;
  delivery_address: string;
  area: string | null;
  created_at: string;
  risk: {
    score: number;
    level: string;
    reasons: string[];
    recommendation: string;
  };
  items: OrderItem[];
}
interface OrderDetail {
  order: Order;
  customer: {
    id: string;
    name: string;
    normalized_phone: string;
    phone_verified: boolean;
  };
  events: {
    id: string;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }[];
  reservations: {
    variant_id: string;
    product_name: string;
    quantity: number;
    active: boolean;
  }[];
  shipment_booked: boolean;
}
interface Shipment {
  id: string;
  order_id: string;
  provider: string;
  tracking_code: string;
  status: string;
  created_at: string;
  order_status: string;
  events: { status: string; description: string; occurred_at: string }[];
}
interface ReturnRecord {
  id: string;
  order_id: string;
  status: string;
  reason: string;
  created_at: string;
  items: { variant_id: string; quantity: number; disposition: string }[];
}

const statuses = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PACKING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "DELIVERED",
  "FAILED_DELIVERY",
  "RETURN_REQUESTED",
  "RETURNED",
  "CANCELLED",
];
const sources = [
  "FACEBOOK",
  "INSTAGRAM",
  "PHONE",
  "WHATSAPP",
  "WEBSITE",
  "OTHER",
];
const riskTone = (level: string) =>
  level === "LOW"
    ? ("success" as const)
    : level === "MEDIUM"
      ? ("warning" as const)
      : ("danger" as const);
const statusTone = (status: string) =>
  status === "DELIVERED"
    ? ("success" as const)
    : status === "CANCELLED" ||
        status === "FAILED_DELIVERY" ||
        status === "RETURNED"
      ? ("danger" as const)
      : status === "PENDING_CONFIRMATION"
        ? ("warning" as const)
        : ("info" as const);

export function OrdersPage() {
  const [entryOpen, setEntryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [risk, setRisk] = useState("");
  const [date, setDate] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [params, setParams] = useSearchParams();
  const focused = params.get("focus");
  const filters = new URLSearchParams();
  if (deferredSearch) filters.set("search", deferredSearch);
  if (status) filters.set("status", status);
  if (source) filters.set("source", source);
  if (risk) filters.set("risk", risk);
  if (date) {
    filters.set("created_from", date);
    filters.set("created_to", date);
  }
  const query = filters.toString();
  const orders = useQuery({
    queryKey: ["orders", query],
    queryFn: () => api<Order[]>(`/api/v1/orders${query ? `?${query}` : ""}`),
  });
  const columns: Column<Order>[] = [
    {
      key: "order",
      header: "Order",
      primary: true,
      cell: (order) => (
        <>
          <strong className="mono">{order.order_number}</strong>
          <small className="cell-subtitle">
            {order.items
              .map((item) => `${item.product_name} × ${item.quantity}`)
              .join(", ")}
          </small>
        </>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (order) => <Badge>{label(order.source)}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      trailing: true,
      cell: (order) => (
        <Badge tone={statusTone(order.status)}>{label(order.status)}</Badge>
      ),
    },
    {
      key: "risk",
      header: "COD risk",
      cell: (order) => (
        <Badge tone={riskTone(order.risk.level)}>
          <ShieldAlert size={12} /> {label(order.risk.level)} ·{" "}
          {order.risk.score}
        </Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      hideOnMobile: true,
      cell: (order) => formatDateTime(order.created_at),
    },
    {
      key: "total",
      header: "Total",
      numeric: true,
      cell: (order) => <strong>{formatBDT(order.total)}</strong>,
    },
  ];
  const clear = () => {
    setSearch("");
    setStatus("");
    setSource("");
    setRisk("");
    setDate("");
  };
  return (
    <div>
      <PageHeader
        eyebrow="Fulfillment"
        title="Orders"
        description="An operational queue for social orders, reservations and fulfillment."
        actions={
          <Button onClick={() => setEntryOpen(true)}>
            <Plus size={17} /> Create order
          </Button>
        }
      />
      <div className="order-view-chips">
        <button
          aria-pressed={status === "PENDING_CONFIRMATION"}
          onClick={() =>
            setStatus(
              status === "PENDING_CONFIRMATION" ? "" : "PENDING_CONFIRMATION",
            )
          }
          type="button"
        >
          Needs confirmation
        </button>
        <button
          aria-pressed={status === "CONFIRMED"}
          onClick={() => setStatus(status === "CONFIRMED" ? "" : "CONFIRMED")}
          type="button"
        >
          Ready to pack
        </button>
        <button
          aria-pressed={status === "READY_FOR_SHIPMENT"}
          onClick={() =>
            setStatus(
              status === "READY_FOR_SHIPMENT" ? "" : "READY_FOR_SHIPMENT",
            )
          }
          type="button"
        >
          Ready for courier
        </button>
        <button
          aria-pressed={status === "FAILED_DELIVERY"}
          onClick={() =>
            setStatus(status === "FAILED_DELIVERY" ? "" : "FAILED_DELIVERY")
          }
          type="button"
        >
          Failed delivery
        </button>
        <button
          aria-pressed={risk === "HIGH"}
          onClick={() => setRisk(risk === "HIGH" ? "" : "HIGH")}
          type="button"
        >
          High COD risk
        </button>
      </div>
      <Card>
        <CardContent>
          <div className="order-filters">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search orders"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order, customer or phone…"
                value={search}
              />
            </div>
            <label>
              <span className="sr-only">Status</span>
              <select
                aria-label="Status"
                className="input"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="">All statuses</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {label(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Source</span>
              <select
                aria-label="Source"
                className="input"
                onChange={(event) => setSource(event.target.value)}
                value={source}
              >
                <option value="">All sources</option>
                {sources.map((item) => (
                  <option key={item} value={item}>
                    {label(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">COD risk</span>
              <select
                aria-label="COD risk"
                className="input"
                onChange={(event) => setRisk(event.target.value)}
                value={risk}
              >
                <option value="">All risk levels</option>
                {["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].map((item) => (
                  <option key={item} value={item}>
                    {label(item)}
                  </option>
                ))}
              </select>
            </label>
            <Input
              aria-label="Created date"
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
            {query ? (
              <Button onClick={clear} size="sm" variant="ghost">
                Clear
              </Button>
            ) : null}
          </div>
          <DataState
            query={orders}
            empty={{
              icon: ClipboardList,
              title: query ? "No orders match" : "No orders yet",
              description: query
                ? "Adjust or clear the operational filters."
                : "Facebook, phone and WhatsApp orders appear here.",
              action: query ? (
                <Button onClick={clear} size="sm" variant="secondary">
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => setEntryOpen(true)} size="sm">
                  Create first order
                </Button>
              ),
            }}
            children={(rows) => (
              <ResponsiveTable
                caption="Orders"
                columns={columns}
                onRowClick={(order) => setParams({ focus: order.id })}
                rowKey={(order) => order.id}
                rowLabel={(order) => `View ${order.order_number}`}
                rows={rows}
              />
            )}
          />
        </CardContent>
      </Card>
      <OrderDetailSheet
        onOpenChange={(open) => {
          if (!open) setParams({});
        }}
        orderId={focused}
      />
      <OrderEntrySheet onOpenChange={setEntryOpen} open={entryOpen} />
    </div>
  );
}

function OrderDetailSheet({
  onOpenChange,
  orderId,
}: {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [cancelOpen, setCancelOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: () => api<OrderDetail>(`/api/v1/orders/${orderId}`),
    enabled: Boolean(orderId),
  });
  const action = useMutation({
    mutationFn: ({ path, status }: { path: string; status?: string }) =>
      api<Order>(`/api/v1/orders/${orderId}/${path}`, {
        method: "POST",
        ...(status ? { body: JSON.stringify({ status }) } : {}),
      }),
    onSuccess: async () => {
      setCancelOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["order-detail", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-counts"] }),
      ]);
    },
  });
  const run = (path: string, status?: string) =>
    action.mutate({ path, status });
  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(orderId)}>
      <SheetContent className="order-detail-sheet">
        <SheetTitle>
          {detail.data?.order.order_number ?? "Order detail"}
        </SheetTitle>
        <SheetDescription>
          {detail.data
            ? `${label(detail.data.order.source)} · Created ${formatDateTime(detail.data.order.created_at)}`
            : "Loading fulfillment detail"}
        </SheetDescription>
        <DataState
          query={detail}
          isEmpty={() => false}
          skeleton="page"
          empty={{
            icon: ClipboardList,
            title: "Order unavailable",
            description: "This order could not be loaded.",
          }}
          children={(data) => {
            const order = data.order;
            const cancellable = ![
              "SHIPPED",
              "DELIVERED",
              "RETURNED",
              "CANCELLED",
              "FAILED_DELIVERY",
            ].includes(order.status);
            return (
              <div className="order-detail">
                <div className="detail-badges">
                  <Badge tone={statusTone(order.status)}>
                    {label(order.status)}
                  </Badge>
                  <Badge>{label(order.source)}</Badge>
                </div>
                <div
                  className={`cod-risk-card risk-${order.risk.level.toLowerCase()}`}
                >
                  <span className="cod-risk-icon">
                    <ShieldAlert size={22} />
                  </span>
                  <div>
                    <p>COD risk</p>
                    <h3>
                      {label(order.risk.level)} — {order.risk.score}/100
                    </h3>
                    <strong>{order.risk.recommendation}</strong>
                    {order.risk.reasons.length ? (
                      <ul>
                        {order.risk.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <small>No risk flags for this order.</small>
                    )}
                  </div>
                </div>
                <div className="order-detail-metrics">
                  <div>
                    <span>Total</span>
                    <strong>{formatBDT(order.total)}</strong>
                  </div>
                  <div>
                    <span>Items</span>
                    <strong>
                      {order.items.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Reserved</span>
                    <strong>
                      {data.reservations
                        .filter((item) => item.active)
                        .reduce((sum, item) => sum + item.quantity, 0)}
                    </strong>
                  </div>
                </div>
                <Card>
                  <CardContent>
                    <h3>
                      <UserRound size={17} /> Customer
                    </h3>
                    <a
                      className="detail-customer"
                      href={`/customers?customer=${data.customer.id}`}
                    >
                      <span>
                        <strong>{data.customer.name}</strong>
                        <small>{data.customer.normalized_phone}</small>
                      </span>
                      <Badge
                        tone={
                          data.customer.phone_verified ? "success" : "warning"
                        }
                      >
                        {data.customer.phone_verified
                          ? "Verified"
                          : "Unverified"}
                      </Badge>
                    </a>
                    <div className="detail-address">
                      <MapPin size={16} />
                      <span>
                        {order.delivery_address}
                        {order.area ? <small>{order.area}</small> : null}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <h3>
                      <PackageCheck size={17} /> Order items
                    </h3>
                    <div className="detail-lines">
                      {order.items.map((item) => (
                        <div key={item.variant_id}>
                          <span>
                            <strong>{item.product_name}</strong>
                            <small>
                              {item.quantity} × {formatBDT(item.unit_price)}
                            </small>
                          </span>
                          <strong>{formatBDT(item.line_total)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="detail-totals">
                      <span>
                        Subtotal <strong>{formatBDT(order.subtotal)}</strong>
                      </span>
                      <span>
                        Delivery{" "}
                        <strong>{formatBDT(order.delivery_fee)}</strong>
                      </span>
                      <span>
                        Discount <strong>−{formatBDT(order.discount)}</strong>
                      </span>
                    </div>
                  </CardContent>
                </Card>
                {data.reservations.length ? (
                  <Card>
                    <CardContent>
                      <h3>
                        <PackageCheck size={17} /> Inventory reservations
                      </h3>
                      <div className="reservation-list">
                        {data.reservations.map((reservation) => (
                          <div key={reservation.variant_id}>
                            <span>
                              <strong>{reservation.product_name}</strong>
                              <small>{reservation.quantity} units</small>
                            </span>
                            <Badge
                              tone={reservation.active ? "success" : "neutral"}
                            >
                              {reservation.active
                                ? "Reserved"
                                : "Released / consumed"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
                <Card>
                  <CardContent>
                    <h3>
                      <CalendarDays size={17} /> Status timeline
                    </h3>
                    <div className="order-timeline">
                      {data.events.map((event, index) => (
                        <div className="order-event" key={event.id}>
                          <span
                            className={
                              index === data.events.length - 1 ? "current" : ""
                            }
                          >
                            {index === data.events.length - 1 ? (
                              <CheckCircle2 size={14} />
                            ) : null}
                          </span>
                          <div>
                            <strong>{label(event.to_status)}</strong>
                            {event.note ? <p>{event.note}</p> : null}
                            <time>{formatDateTime(event.created_at)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <CourierPanel booked={data.shipment_booked} order={order} />
                <OrderReturnPanel order={order} />
                <div className="order-detail-actions">
                  {order.status === "PENDING_CONFIRMATION" &&
                  can(user, "order:confirm") ? (
                    <Button
                      disabled={action.isPending}
                      onClick={() => run("confirm")}
                    >
                      Confirm & reserve
                    </Button>
                  ) : null}
                  {order.status === "CONFIRMED" && can(user, "order:write") ? (
                    <Button
                      disabled={action.isPending}
                      onClick={() => run("pack")}
                    >
                      Start packing
                    </Button>
                  ) : null}
                  {order.status === "PACKING" && can(user, "order:write") ? (
                    <Button
                      disabled={action.isPending}
                      onClick={() => run("transition", "READY_FOR_SHIPMENT")}
                    >
                      Mark ready for courier
                    </Button>
                  ) : null}
                  {cancellable && can(user, "order:cancel") ? (
                    <Button
                      disabled={action.isPending}
                      onClick={() => setCancelOpen(true)}
                      variant="danger"
                    >
                      <XCircle size={16} /> Cancel order
                    </Button>
                  ) : null}
                </div>
                {action.error ? (
                  <div className="form-alert">{action.error.message}</div>
                ) : null}
                <ConfirmDialog
                  confirmLabel="Cancel order"
                  description="Active inventory reservations will be released immediately. This cannot be undone."
                  error={action.error?.message}
                  onConfirm={() => run("cancel")}
                  onOpenChange={setCancelOpen}
                  open={cancelOpen}
                  pending={action.isPending}
                  title={`Cancel ${order.order_number}?`}
                  tone="danger"
                />
              </div>
            );
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function CourierPanel({ booked, order }: { booked: boolean; order: Order }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [cancelOpen, setCancelOpen] = useState(false);
  const shipment = useQuery({
    queryKey: ["shipment", order.id],
    queryFn: () => api<Shipment>(`/api/v1/orders/${order.id}/shipment`),
    enabled: booked,
  });
  const changed = async () => {
    setCancelOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shipment", order.id] }),
      queryClient.invalidateQueries({ queryKey: ["order-detail", order.id] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () =>
      api<Shipment>(`/api/v1/orders/${order.id}/shipment`, { method: "POST" }),
    onSuccess: changed,
  });
  const shipmentAction = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "refresh" | "cancel";
    }) =>
      api<Shipment>(`/api/v1/shipments/${id}/${action}`, { method: "POST" }),
    onSuccess: changed,
  });
  const current = shipment.data;

  if (!booked) {
    return order.status === "READY_FOR_SHIPMENT" &&
      can(user, "shipment:create") ? (
      <div className="courier-callout">
        <Truck size={20} />
        <span>
          <strong>Ready for courier booking</strong>
          <small>Create a Mock Courier shipment and tracking code.</small>
        </span>
        <Button
          disabled={create.isPending}
          onClick={() => create.mutate()}
          size="sm"
        >
          {create.isPending ? "Booking…" : "Book courier"}
        </Button>
        {create.error ? (
          <small className="error-text">{create.error.message}</small>
        ) : null}
      </div>
    ) : null;
  }
  if (shipment.isLoading || !current) {
    return (
      <div className="courier-panel courier-loading">
        <RefreshCw className="spin" size={18} /> Loading shipment…
      </div>
    );
  }
  const cancelled = current.status === "CANCELLED";
  return (
    <Card>
      <CardContent className="courier-panel">
        <div className="courier-heading">
          <span className="courier-icon">
            <Truck size={19} />
          </span>
          <div>
            <p>Courier shipment</p>
            <h3>{current.provider.replaceAll("_", " ")}</h3>
            <code>{current.tracking_code}</code>
          </div>
          <Badge
            tone={
              cancelled
                ? "danger"
                : current.status === "DELIVERED"
                  ? "success"
                  : "info"
            }
          >
            {label(current.status)}
          </Badge>
        </div>
        <div
          aria-label="Shipment tracking timeline"
          className="shipment-timeline"
        >
          {current.events.map((event, index) => (
            <div
              className="shipment-event"
              key={`${event.status}-${event.occurred_at}`}
            >
              <span
                className={index === current.events.length - 1 ? "current" : ""}
              >
                {index === current.events.length - 1 ? (
                  <CheckCircle2 size={13} />
                ) : null}
              </span>
              <div>
                <strong>{label(event.status)}</strong>
                <p>{event.description}</p>
                <time>{formatDateTime(event.occurred_at)}</time>
              </div>
            </div>
          ))}
        </div>
        {can(user, "shipment:create") ? (
          <div className="courier-actions">
            {cancelled && order.status === "READY_FOR_SHIPMENT" ? (
              <Button
                disabled={create.isPending}
                onClick={() => create.mutate()}
                size="sm"
              >
                <Truck size={15} /> Rebook courier
              </Button>
            ) : (
              <Button
                disabled={shipmentAction.isPending}
                onClick={() =>
                  shipmentAction.mutate({ id: current.id, action: "refresh" })
                }
                size="sm"
                variant="secondary"
              >
                <RefreshCw size={15} /> Refresh status
              </Button>
            )}
            {current.status === "CREATED" ? (
              <Button
                disabled={shipmentAction.isPending}
                onClick={() => setCancelOpen(true)}
                size="sm"
                variant="ghost"
              >
                <Ban size={15} /> Cancel booking
              </Button>
            ) : null}
          </div>
        ) : null}
        {create.error || shipmentAction.error ? (
          <div className="form-alert">
            {create.error?.message ?? shipmentAction.error?.message}
          </div>
        ) : null}
        <ConfirmDialog
          confirmLabel="Cancel booking"
          description="The courier booking will be cancelled. Inventory remains reserved and you can book a new shipment."
          onConfirm={() =>
            shipmentAction.mutate({ id: current.id, action: "cancel" })
          }
          onOpenChange={setCancelOpen}
          open={cancelOpen}
          pending={shipmentAction.isPending}
          title={`Cancel ${current.tracking_code}?`}
          tone="danger"
        />
      </CardContent>
    </Card>
  );
}

const returnableStatuses = new Set([
  "SHIPPED",
  "DELIVERED",
  "FAILED_DELIVERY",
  "RETURN_REQUESTED",
]);

function OrderReturnPanel({ order }: { order: Order }) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const permitted = can(user, "return:create");
  const history = useQuery({
    queryKey: ["order-returns", order.id],
    queryFn: () => api<ReturnRecord[]>(`/api/v1/returns?order_id=${order.id}`),
    enabled: permitted,
  });
  const returned = new Map<string, number>();
  for (const record of history.data ?? []) {
    for (const item of record.items) {
      returned.set(
        item.variant_id,
        (returned.get(item.variant_id) ?? 0) + item.quantity,
      );
    }
  }
  const available = order.items.map((item) => ({
    ...item,
    returnable: Math.max(
      0,
      item.quantity - (returned.get(item.variant_id) ?? 0),
    ),
  }));
  const receive = useMutation({
    mutationFn: (body: object) =>
      api<ReturnRecord>("/api/v1/returns", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setOpen(false);
      toast.success(
        "Return received",
        "Inventory and the order timeline are updated.",
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["order-returns", order.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["order-detail", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string, fallback = "") => {
      const item = data.get(key);
      return typeof item === "string" ? item : fallback;
    };
    const items = available.flatMap((line) => {
      const quantity = Number(
        data.get(`return-quantity-${line.variant_id}`) ?? 0,
      );
      const disposition = value(
        `return-disposition-${line.variant_id}`,
        "SELLABLE",
      );
      return quantity > 0
        ? [{ variant_id: line.variant_id, quantity, disposition }]
        : [];
    });
    if (!items.length) return;
    receive.mutate({
      order_id: order.id,
      reason: value("reason"),
      items,
    });
  }

  if (
    !permitted ||
    (!returnableStatuses.has(order.status) && !history.data?.length)
  ) {
    return null;
  }
  return (
    <Card>
      <CardContent className="return-panel">
        <div className="return-heading">
          <div>
            <PackageOpen size={18} />
            <span>
              <h3>Returns & RTO</h3>
              <p>Inspect every received unit before inventory changes.</p>
            </span>
          </div>
          {returnableStatuses.has(order.status) &&
          available.some((item) => item.returnable) ? (
            <Button onClick={() => setOpen(true)} size="sm" variant="danger">
              <RotateCcw size={15} /> Receive return
            </Button>
          ) : null}
        </div>
        {history.data?.length ? (
          <div className="return-history">
            {history.data.map((record) => (
              <div key={record.id}>
                <span>
                  <strong>{record.reason}</strong>
                  <small>{formatDateTime(record.created_at)}</small>
                </span>
                <span>
                  {record.items
                    .map(
                      (item) => `${item.quantity} ${label(item.disposition)}`,
                    )
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="return-empty">
            No goods have been received back for this order.
          </p>
        )}
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogContent className="return-dialog">
            <DialogTitle>Receive and inspect return</DialogTitle>
            <DialogDescription>
              Count only goods physically received. Sellable adds stock; damaged
              and missing create ledger records without adding sellable stock.
            </DialogDescription>
            <form onSubmit={submit}>
              <div className="return-lines">
                {available
                  .filter((line) => line.returnable > 0)
                  .map((line) => (
                    <div className="return-line" key={line.variant_id}>
                      <span>
                        <strong>{line.product_name}</strong>
                        <small>{line.returnable} returnable</small>
                      </span>
                      <Input
                        aria-label={`Quantity for ${line.product_name}`}
                        defaultValue="0"
                        max={line.returnable}
                        min="0"
                        name={`return-quantity-${line.variant_id}`}
                        type="number"
                      />
                      <SelectField
                        label="Condition"
                        name={`return-disposition-${line.variant_id}`}
                      >
                        <option value="SELLABLE">
                          Sellable · return to stock
                        </option>
                        <option value="DAMAGED">Damaged · ledger only</option>
                        <option value="MISSING">Missing · loss record</option>
                      </SelectField>
                    </div>
                  ))}
              </div>
              <TextareaField
                label="Return reason"
                minLength={3}
                name="reason"
                placeholder="Customer unreachable, refused parcel, wrong item…"
                required
              />
              {receive.error ? (
                <div className="form-alert" role="alert">
                  {receive.error.message}
                </div>
              ) : null}
              <div className="form-actions">
                <Button
                  disabled={receive.isPending}
                  type="submit"
                  variant="danger"
                >
                  {receive.isPending ? "Receiving…" : "Confirm received goods"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
