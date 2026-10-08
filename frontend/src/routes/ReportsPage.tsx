import { AlertTriangle, Download, FileBarChart, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { api, downloadFile } from "../lib/api";
import { formatBDT } from "../lib/utils";

interface SummaryReport {
  start: string;
  end: string;
  sales: { transactions: number; revenue: string; discount: string; gross_profit: string; average_sale: string; offline_synced: number; by_payment_method: Record<string, string> };
  top_products: { product_name: string; variant_name: string; sku: string; quantity: number; revenue: string; gross_profit: string }[];
  inventory: { units_on_hand: number; units_reserved: number; cost_value: string; retail_value: string; low_stock: number; out_of_stock: number };
  cod: { total: number; value: string; by_status: Record<string, number>; by_risk: Record<string, number>; delivered: number; returned: number; delivery_rate: number | null };
  courier: { shipments: number; delivered: number; returned: number; in_transit: number; delivery_rate: number | null };
}

const RANGES = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "Last 7 days", days: 7 },
  { id: "month", label: "Last 30 days", days: 30 },
] as const;

/** Calendar date in Asia/Dhaka (UTC+6, no DST), matching how the API buckets business days. */
function dhakaDate(offsetDays = 0) {
  return new Date(Date.now() + 6 * 3_600_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const money = (value: string | undefined) => formatBDT(Number(value ?? 0));

function Row({ label, value }: { label: string; value: string }) {
  return <div className="sync-row"><span><strong>{label}</strong></span><span>{value}</span></div>;
}

export function ReportsPage() {
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("today");
  const range = RANGES.find((item) => item.id === rangeId)!;
  const query = `start=${dhakaDate(range.days - 1)}&end=${dhakaDate()}`;
  const report = useQuery({ queryKey: ["report-summary", query], queryFn: () => api<SummaryReport>(`/api/v1/reports/summary?${query}`) });
  const exportCsv = useMutation({ mutationFn: () => downloadFile(`/api/v1/reports/sales.csv?${query}`, `retailops-sales-${rangeId}.csv`) });
  const data = report.data;

  return <div>
    <PageHeader eyebrow="Decision support" title="Reports" description="Sales, profit, stock value, COD and courier outcomes for a Dhaka business-day range." actions={<Button disabled={!data?.sales.transactions || exportCsv.isPending} onClick={() => exportCsv.mutate()} variant="secondary"><Download size={17}/> {exportCsv.isPending ? "Preparing…" : "Export sales CSV"}</Button>}/>
    <div className="category-pills" role="group" aria-label="Report range">
      {RANGES.map((item) => <button aria-pressed={item.id === rangeId} className={item.id === rangeId ? "active" : ""} key={item.id} onClick={() => setRangeId(item.id)} type="button">{item.label}</button>)}
    </div>
    {report.isError ? <Card><CardContent className="inline-empty"><AlertTriangle/> {report.error.message} <Button onClick={() => void report.refetch()} size="sm" variant="secondary">Retry</Button></CardContent></Card> : null}
    {exportCsv.isError ? <div className="form-alert">{exportCsv.error.message}</div> : null}
    {!data && report.isPending ? <div aria-label="Loading report" className="loading-state"><div className="skeleton-grid"><Skeleton /><Skeleton /><Skeleton /></div></div> : null}
    {data ? <>
      <section className="metric-grid report-metrics">
        <MetricCard icon={Wallet} label="Revenue" tone="brand" value={money(data.sales.revenue)}/>
        <MetricCard icon={TrendingUp} label="Gross profit" tone="info" value={money(data.sales.gross_profit)}/>
        <MetricCard icon={ReceiptText} label="Sales" value={String(data.sales.transactions)}/>
        <MetricCard icon={FileBarChart} label="Average sale" value={money(data.sales.average_sale)}/>
      </section>
      <section className="report-grid">
        <Card><CardHeader><div><CardTitle>Top products</CardTitle><CardDescription>By revenue before sale-level discounts</CardDescription></div></CardHeader><CardContent>
          {data.top_products.length ? data.top_products.map((row) => <Row key={row.sku} label={`${row.product_name} · ${row.variant_name} ×${row.quantity}`} value={`${money(row.revenue)} · profit ${money(row.gross_profit)}`}/>) : <div className="inline-empty">No sales in this range.</div>}
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>Sales &amp; payments</CardTitle><CardDescription>{data.sales.offline_synced} synced from offline devices</CardDescription></div></CardHeader><CardContent>
          <Row label="Discounts given" value={money(data.sales.discount)}/>
          {Object.entries(data.sales.by_payment_method).map(([method, total]) => <Row key={method} label={method} value={money(total)}/>)}
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>Inventory valuation</CardTitle><CardDescription>Current snapshot</CardDescription></div></CardHeader><CardContent>
          <Row label="Units on hand" value={`${data.inventory.units_on_hand} (${data.inventory.units_reserved} reserved)`}/>
          <Row label="Cost value" value={money(data.inventory.cost_value)}/>
          <Row label="Retail value" value={money(data.inventory.retail_value)}/>
          <Row label="Low / out of stock" value={`${data.inventory.low_stock} / ${data.inventory.out_of_stock}`}/>
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>COD orders</CardTitle><CardDescription>{data.cod.total} orders worth {money(data.cod.value)}</CardDescription></div></CardHeader><CardContent>
          <Row label="Delivery success" value={percent(data.cod.delivery_rate)}/>
          <Row label="Delivered / returned" value={`${data.cod.delivered} / ${data.cod.returned}`}/>
          {Object.entries(data.cod.by_risk).map(([level, count]) => <Row key={level} label={`${level.toLowerCase()} risk`} value={String(count)}/>)}
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>Courier</CardTitle><CardDescription>Shipments created in this range</CardDescription></div></CardHeader><CardContent>
          <Row label="Shipments" value={String(data.courier.shipments)}/>
          <Row label="In transit" value={String(data.courier.in_transit)}/>
          <Row label="Delivery rate" value={percent(data.courier.delivery_rate)}/>
        </CardContent></Card>
      </section>
    </> : null}
  </div>;
}
