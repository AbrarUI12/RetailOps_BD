import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Boxes, Clock3, PackageOpen, Plus, ReceiptText, ShoppingBag, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../lib/api";
import { dhakaDateISO, formatBDT, formatDateTime, formatLongDate, formatPercent } from "../lib/format";
import { useAuthStore } from "../stores/authStore";

interface DashboardReport {
  start: string;
  end: string;
  branch_id: string;
  branches: { id: string; name: string }[];
  kpis: { revenue: string; sales: number; orders: number; gross_profit: string; average_order_value: string; pending_orders: number; low_stock: number };
  revenue_series: { label: string; revenue: string }[];
  orders_by_source: Record<string, number>;
  top_products: { product_name: string; variant_name: string; quantity: number; revenue: string }[];
  low_stock_items: { variant_id: string; product_name: string; variant_name: string; sku: string; available_quantity: number; reorder_level: number }[];
  recent_sales: { id: string; invoice_number: string; total: string; created_at: string }[];
  recent_orders: { id: string; order_number: string; source: string; status: string; total: string; created_at: string }[];
  courier_success_rate: number | null;
}

const RANGES = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "30 days", days: 30 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const [rangeId, setRangeId] = useState<RangeId>("today");
  const [branchId, setBranchId] = useState(user?.branch_id ?? "");
  const range = RANGES.find((item) => item.id === rangeId)!;
  const start = dhakaDateISO(range.days - 1);
  const end = dhakaDateISO();
  const query = new URLSearchParams({ start, end });
  if (branchId) query.set("branch_id", branchId);
  const report = useQuery({ queryKey: ["dashboard", start, end, branchId], queryFn: () => api<DashboardReport>(`/api/v1/reports/dashboard?${query}`), refetchInterval: 60_000 });

  return <PageTransition><div className="dashboard-page">
    <FadeUp><PageHeader eyebrow={formatLongDate(new Date())} title={`Good to see you, ${user?.full_name.split(" ")[0] ?? "there"}`} description={`Live operating picture for ${report.data?.branches.find((branch) => branch.id === branchId)?.name ?? user?.branch_name ?? "your branch"}.`} actions={<Button asChild><Link to="/pos"><Plus aria-hidden="true" size={17} /> New sale</Link></Button>} /></FadeUp>
    <div className="dashboard-toolbar">
      <div aria-label="Dashboard timeframe" className="dashboard-range" role="group">{RANGES.map((item) => <button aria-pressed={item.id === rangeId} key={item.id} onClick={() => setRangeId(item.id)} type="button">{item.id === rangeId ? <motion.span className="dashboard-range-active" layoutId="dashboard-timeframe" transition={{ duration: 0.18 }} /> : null}<span>{item.label}</span></button>)}</div>
      <label className="dashboard-branch"><span>Branch</span><select aria-label="Branch" onChange={(event) => setBranchId(event.target.value)} value={branchId}>{(report.data?.branches ?? [{ id: user?.branch_id ?? "", name: user?.branch_name ?? "Current branch" }]).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <Badge tone="info"><Clock3 aria-hidden="true" size={13} /> {rangeId === "today" ? "Today · Dhaka time" : `${start} to ${end}`}</Badge>
    </div>
    <DataState empty={{ icon: ReceiptText, title: "No dashboard data", description: "Complete a sale or create an order to start the operating picture." }} isEmpty={() => false} query={report} skeleton="page">{(data) => <DashboardContent data={data} />}</DataState>
  </div></PageTransition>;
}

function DashboardContent({ data }: { data: DashboardReport }) {
  const maxRevenue = Math.max(...data.revenue_series.map((point) => Number(point.revenue)), 1);
  const maxOrders = Math.max(...Object.values(data.orders_by_source), 1);
  return <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key={`${data.start}-${data.end}-${data.branch_id}`} transition={{ duration: 0.2 }}>
    <section aria-label="Key metrics" className="metric-grid dashboard-metrics">
      <FadeUp delay={.02}><MetricCard icon={Banknote} label="Revenue" tone="brand" value={formatBDT(data.kpis.revenue)} /></FadeUp>
      <FadeUp delay={.04}><MetricCard icon={ReceiptText} label="Sales" tone="info" value={String(data.kpis.sales)} /></FadeUp>
      <FadeUp delay={.06}><MetricCard icon={TrendingUp} label="Gross profit" value={formatBDT(data.kpis.gross_profit)} /></FadeUp>
      <FadeUp delay={.08}><MetricCard icon={ShoppingBag} label="Average sale" value={formatBDT(data.kpis.average_order_value)} /></FadeUp>
      <FadeUp delay={.1}><MetricCard icon={Clock3} label="Pending orders" tone="warning" value={String(data.kpis.pending_orders)} /></FadeUp>
      <FadeUp delay={.12}><MetricCard icon={AlertTriangle} label="Low stock" tone="warning" value={String(data.kpis.low_stock)} /></FadeUp>
    </section>
    <section className="dashboard-grid dashboard-charts">
      <FadeUp className="revenue-card" delay={.1}><Card><CardHeader><div><CardTitle>Revenue trend</CardTitle><CardDescription>Completed POS sales in the selected range</CardDescription></div><Badge tone="success">Live</Badge></CardHeader><CardContent><div className="bar-chart" style={{ "--bars": data.revenue_series.length } as CSSProperties}>{data.revenue_series.map((point) => <div key={point.label}><span className="bar-value">{formatBDT(point.revenue)}</span><motion.span animate={{ height: `${Math.max(4, Number(point.revenue) / maxRevenue * 85)}%` }} aria-hidden="true" className="bar" initial={{ height: 0 }} transition={{ duration: .24 }} /><small>{point.label}</small></div>)}</div></CardContent></Card></FadeUp>
      <FadeUp delay={.14}><Card><CardHeader><div><CardTitle>Orders by source</CardTitle><CardDescription>{data.kpis.orders} orders captured</CardDescription></div></CardHeader><CardContent className="source-chart">{Object.keys(data.orders_by_source).length ? Object.entries(data.orders_by_source).map(([source, count]) => <div key={source}><span>{source.replaceAll("_", " ").toLowerCase()}</span><span className="source-track"><motion.i animate={{ scaleX: count / maxOrders }} initial={{ scaleX: 0 }} /></span><strong>{count}</strong></div>) : <div className="inline-empty">No orders in this range.</div>}</CardContent></Card></FadeUp>
    </section>
    <section className="dashboard-secondary">
      <Card className="dashboard-low-stock"><CardHeader><div><CardTitle>Low stock</CardTitle><CardDescription>Available units at or below reorder level</CardDescription></div><Button asChild size="sm" variant="ghost"><Link to="/inventory?status=reorder">View stock</Link></Button></CardHeader><CardContent>{data.low_stock_items.length ? data.low_stock_items.map((item) => <Link className="dashboard-row" key={item.variant_id} to={`/inventory?search=${encodeURIComponent(item.sku)}`}><span><strong>{item.product_name}</strong><small>{item.variant_name} · {item.sku}</small></span><Badge tone={item.available_quantity <= 0 ? "danger" : "warning"}>{item.available_quantity} left</Badge></Link>) : <div className="inline-empty"><Boxes aria-hidden="true" /> Inventory is healthy.</div>}</CardContent></Card>
      <Card><CardHeader><div><CardTitle>Top products</CardTitle><CardDescription>Revenue leaders in this range</CardDescription></div></CardHeader><CardContent>{data.top_products.length ? data.top_products.map((item) => <div className="dashboard-row" key={`${item.product_name}-${item.variant_name}`}><span><strong>{item.product_name}</strong><small>{item.variant_name} · {item.quantity} sold</small></span><strong>{formatBDT(item.revenue)}</strong></div>) : <div className="inline-empty"><PackageOpen aria-hidden="true" /> No product sales yet.</div>}</CardContent></Card>
      <Card><CardHeader><div><CardTitle>Courier success</CardTitle><CardDescription>Delivered vs terminal courier outcomes</CardDescription></div></CardHeader><CardContent className="courier-score"><strong>{data.courier_success_rate === null ? "—" : formatPercent(data.courier_success_rate)}</strong><span>{data.courier_success_rate === null ? "No completed shipments in range" : "successful delivery rate"}</span><Button asChild size="sm" variant="secondary"><Link to="/orders">Open fulfillment</Link></Button></CardContent></Card>
    </section>
    <section className="dashboard-activity-grid">
      <Card><CardHeader><div><CardTitle>Recent sales</CardTitle><CardDescription>Latest register transactions</CardDescription></div><Button asChild size="sm" variant="ghost"><Link to="/sales">All sales</Link></Button></CardHeader><CardContent>{data.recent_sales.length ? data.recent_sales.slice(0, 5).map((sale) => <Link className="dashboard-row" key={sale.id} to={`/sales?sale=${sale.id}`}><span><strong className="mono">{sale.invoice_number}</strong><small>{formatDateTime(sale.created_at)}</small></span><strong>{formatBDT(sale.total)}</strong></Link>) : <div className="inline-empty">No sales in this range.</div>}</CardContent></Card>
      <Card><CardHeader><div><CardTitle>Recent orders</CardTitle><CardDescription>Latest social and phone orders</CardDescription></div><Button asChild size="sm" variant="ghost"><Link to="/orders">All orders</Link></Button></CardHeader><CardContent>{data.recent_orders.length ? data.recent_orders.slice(0, 5).map((order) => <Link className="dashboard-row" key={order.id} to={`/orders?focus=${order.id}`}><span><strong className="mono">{order.order_number}</strong><small>{order.source.toLowerCase()} · {order.status.replaceAll("_", " ").toLowerCase()}</small></span><strong>{formatBDT(order.total)}</strong></Link>) : <div className="inline-empty">No orders in this range.</div>}</CardContent></Card>
    </section>
  </motion.div>;
}
