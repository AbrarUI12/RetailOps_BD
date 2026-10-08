import { AlertTriangle, ArrowUpRight, Banknote, Boxes, Plus, ShoppingBag, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/Table";
import { api } from "../lib/api";
import { formatBDT } from "../lib/utils";
import { useAuthStore } from "../stores/authStore";

interface DashboardReport {
  kpis: { revenue: string; orders: number; gross_profit: string; average_order_value: string; low_stock: number };
  revenue_series: { label: string; revenue: string }[];
  recent_sales: { invoice_number: string; total: string; created_at: string }[];
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const report = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardReport>("/api/v1/reports/dashboard"), refetchInterval: 60_000 });
  const formattedDate = new Intl.DateTimeFormat("en-BD", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" }).format(new Date());
  if (report.isLoading) return <div className="loading-state"><Skeleton className="skeleton-title"/><Skeleton className="skeleton-line"/><div className="skeleton-grid"><Skeleton/><Skeleton/><Skeleton/></div></div>;
  const data = report.data ?? { kpis: { revenue: "0", orders: 0, gross_profit: "0", average_order_value: "0", low_stock: 0 }, revenue_series: [], recent_sales: [] };
  const max = Math.max(...data.revenue_series.map((point) => Number(point.revenue)), 1);
  return <PageTransition><div className="dashboard-page"><FadeUp><PageHeader eyebrow={formattedDate} title={`Good to see you, ${user?.full_name.split(" ")[0] ?? "there"}`} description="Here’s the live pulse of your Dhanmondi store." actions={<Button asChild><Link to="/pos"><Plus size={17}/> New sale</Link></Button>}/></FadeUp>
    {report.isError ? <div className="form-alert">Live reporting is temporarily unavailable: {report.error.message}</div> : null}
    <section aria-label="Key metrics" className="metric-grid"><FadeUp delay={.03}><MetricCard icon={Banknote} label="Net revenue" tone="brand" value={formatBDT(Number(data.kpis.revenue))}/></FadeUp><FadeUp delay={.06}><MetricCard icon={ShoppingBag} label="Sales" tone="info" value={String(data.kpis.orders)}/></FadeUp><FadeUp delay={.09}><MetricCard icon={TrendingUp} label="Gross profit" value={formatBDT(Number(data.kpis.gross_profit))}/></FadeUp><FadeUp delay={.12}><MetricCard icon={AlertTriangle} label="Low stock" tone="warning" value={`${data.kpis.low_stock} items`}/></FadeUp></section>
    <section className="dashboard-grid"><FadeUp className="revenue-card" delay={.1}><Card><CardHeader><div><CardTitle>Revenue pulse</CardTitle><CardDescription>Two-hour sales windows today</CardDescription></div><Badge tone="success"><ArrowUpRight size={12}/> Live</Badge></CardHeader><CardContent><div className="bar-chart">{data.revenue_series.map((point) => <div key={point.label}><span className="bar-value">{formatBDT(Number(point.revenue))}</span><span aria-hidden="true" className="bar" style={{ height: `${Math.max(4, Number(point.revenue) / max * 85)}%` }}/><small>{point.label}</small></div>)}</div></CardContent></Card></FadeUp><FadeUp className="quick-card" delay={.14}><Card><CardHeader><div><CardTitle>Operational signal</CardTitle><CardDescription>What needs attention now</CardDescription></div></CardHeader><CardContent className="signal-card"><span><Boxes size={23}/></span><strong>{data.kpis.low_stock ? `${data.kpis.low_stock} products need attention` : "Inventory is healthy"}</strong><p>Review reorder levels and recent stock movements before the next rush.</p><Button asChild size="sm" variant="secondary"><Link to="/inventory">Open inventory</Link></Button></CardContent></Card></FadeUp></section>
    <FadeUp delay={.16}><Card className="activity-card"><CardHeader><div><CardTitle>Recent sales</CardTitle><CardDescription>The latest completed register transactions</CardDescription></div></CardHeader><CardContent>{data.recent_sales.length ? <Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Status</TableHead><TableHead className="align-right">Amount</TableHead><TableHead className="align-right">Time</TableHead></TableRow></TableHeader><TableBody>{data.recent_sales.map((sale) => <TableRow key={sale.invoice_number}><TableCell className="mono strong">{sale.invoice_number}</TableCell><TableCell><Badge tone="success">Paid</Badge></TableCell><TableCell className="align-right strong">{formatBDT(Number(sale.total))}</TableCell><TableCell className="align-right muted">{new Intl.DateTimeFormat("en-BD", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Dhaka" }).format(new Date(sale.created_at))}</TableCell></TableRow>)}</TableBody></Table> : <div className="inline-empty">Complete the first sale to see live activity here.</div>}</CardContent></Card></FadeUp>
  </div></PageTransition>;
}
