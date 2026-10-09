import { ArrowRight, ClipboardList, Plus, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { OrderEntrySheet } from "../components/orders/OrderEntrySheet";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { api } from "../lib/api";
import { formatBDT, formatDateTime, label } from "../lib/format";

interface Order { id: string; order_number: string; source: string; status: string; total: string; delivery_address: string; created_at: string; risk: { score: number; level: string; reasons: string[]; recommendation: string }; items: { product_name: string; quantity: number }[] }
const nextStatus: Record<string, string | undefined> = { PENDING_CONFIRMATION: "CONFIRMED", CONFIRMED: "PACKING", PACKING: "READY_FOR_SHIPMENT", READY_FOR_SHIPMENT: "SHIPPED", SHIPPED: "DELIVERED" };

export function OrdersPage() {
  const [entryOpen, setEntryOpen] = useState(false);
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<Order[]>("/api/v1/orders") });
  const transition = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api<Order>(`/api/v1/orders/${id}/transition`, { method: "POST", body: JSON.stringify({ status }) }), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["orders"] }) });
  const columns: Column<Order>[] = [
    { key: "order", header: "Order", primary: true, cell: (order) => <><strong className="mono">{order.order_number}</strong><small className="cell-subtitle">{order.items.map((item) => `${item.product_name} × ${item.quantity}`).join(", ")}</small></> },
    { key: "source", header: "Source", cell: (order) => <Badge>{label(order.source)}</Badge> },
    { key: "status", header: "Status", trailing: true, cell: (order) => <Badge tone={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "info"}>{label(order.status)}</Badge> },
    { key: "risk", header: "COD risk", cell: (order) => <Badge tone={order.risk.level === "LOW" ? "success" : order.risk.level === "MEDIUM" ? "warning" : "danger"}><ShieldAlert size={12}/> {label(order.risk.level)} · {order.risk.score}</Badge> },
    { key: "created", header: "Created", hideOnMobile: true, cell: (order) => formatDateTime(order.created_at) },
    { key: "total", header: "Total", numeric: true, cell: (order) => <strong>{formatBDT(order.total)}</strong> },
    { key: "actions", header: "", cardFooter: true, cell: (order) => { const next = nextStatus[order.status]; return next ? <Button disabled={transition.isPending} onClick={() => transition.mutate({ id: order.id, status: next })} size="sm" variant="secondary">{label(next)} <ArrowRight size={13}/></Button> : null; } },
  ];
  return <div><PageHeader eyebrow="Fulfillment" title="Orders" description="Capture social orders quickly, assess COD risk and move fulfillment forward." actions={<Button onClick={() => setEntryOpen(true)}><Plus size={17}/> Create order</Button>}/><Card><CardContent><DataState query={orders} empty={{ icon: ClipboardList, title: "No orders yet", description: "Facebook, phone and WhatsApp orders will appear in one operational queue.", action: <Button onClick={() => setEntryOpen(true)} size="sm">Create first order</Button> }} children={(rows) => <ResponsiveTable caption="Orders" columns={columns} rowKey={(order) => order.id} rows={rows}/>} /></CardContent></Card><OrderEntrySheet onOpenChange={setEntryOpen} open={entryOpen}/></div>;
}
