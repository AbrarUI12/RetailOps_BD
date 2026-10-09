import { Boxes, Download, PackageOpen, ReceiptText, RotateCcw, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { Input } from "../components/ui/Input";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { api, downloadFile } from "../lib/api";
import { dhakaDateISO, formatBDT, formatPercent, label } from "../lib/format";

interface ProductPerformance {
  product_name: string; variant_name: string; sku: string; quantity: number; returned_quantity: number;
  net_quantity: number; revenue: string; cost: string; gross_profit: string; margin: number | null;
}
interface SummaryReport {
  start: string;
  end: string;
  sales: { transactions: number; revenue: string; refunds: string; net_revenue: string; discount: string; cost_of_goods_sold: string; gross_profit: string; average_sale: string; offline_synced: number; by_payment_method: Record<string, string> };
  top_products: ProductPerformance[];
  inventory: { units_on_hand: number; units_reserved: number; units_available: number; cost_value: string; retail_value: string; low_stock: number; out_of_stock: number };
  cod: { total: number; value: string; by_status: Record<string, number>; by_risk: Record<string, number>; delivered: number; returned: number; collected: string; pending: string; failed: string; return_loss: string; delivery_rate: number | null };
  courier: { shipments: number; delivered: number; returned: number; in_transit: number; failed: number; by_provider: Record<string, number>; by_status: Record<string, number>; delivery_rate: number | null };
}

const RANGES = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "Last 7 days", days: 7 },
  { id: "month", label: "Last 30 days", days: 30 },
] as const;

function ReportRow({ name, value, tone }: { name: string; value: string; tone?: "danger" | "success" }) {
  return <div className="report-stat-row"><span>{name}</span><strong className={tone}>{value}</strong></div>;
}

export function ReportsPage() {
  const [rangeId, setRangeId] = useState("today");
  const [start, setStart] = useState(dhakaDateISO());
  const [end, setEnd] = useState(dhakaDateISO());
  const query = `start=${start}&end=${end}`;
  const report = useQuery({ queryKey: ["report-summary", start, end], queryFn: () => api<SummaryReport>(`/api/v1/reports/summary?${query}`) });
  const exportFile = useMutation({
    mutationFn: ({ kind }: { kind: "sales" | "products" }) => downloadFile(`/api/v1/reports/${kind}.csv?${query}`, `retailops-${kind}-${start}-to-${end}.csv`),
  });
  const data = report.data;
  const productColumns: Column<ProductPerformance>[] = [
    { key: "product", header: "Product", primary: true, cell: (row) => <span className="report-product"><strong>{row.product_name}</strong><small>{row.variant_name} · {row.sku}</small></span> },
    { key: "units", header: "Sold / returned", cell: (row) => `${row.quantity} / ${row.returned_quantity}` },
    { key: "revenue", header: "Net revenue", numeric: true, cell: (row) => formatBDT(row.revenue, { precise: true }) },
    { key: "cost", header: "Cost", numeric: true, hideOnMobile: true, cell: (row) => formatBDT(row.cost, { precise: true }) },
    { key: "profit", header: "Gross profit", numeric: true, trailing: true, cell: (row) => <strong>{formatBDT(row.gross_profit, { precise: true })}</strong> },
    { key: "margin", header: "Margin", numeric: true, trailing: true, cell: (row) => <Badge tone={(row.margin ?? 0) >= 0 ? "success" : "danger"}>{formatPercent(row.margin, 1)}</Badge> },
  ];

  function setPreset(id: string, days: number) {
    setRangeId(id);
    setStart(dhakaDateISO(days - 1));
    setEnd(dhakaDateISO());
  }

  return <div className="reports-page">
    <PageHeader eyebrow="Decision support" title="Reports" description="Sales, product margin, stock value, COD and courier outcomes by Dhaka business day." actions={<div className="page-actions"><Button disabled={!data?.sales.transactions || exportFile.isPending} onClick={() => exportFile.mutate({ kind: "sales" })} size="sm" type="button" variant="secondary"><Download aria-hidden="true" size={16}/> Sales CSV</Button><Button disabled={!data?.top_products.length || exportFile.isPending} onClick={() => exportFile.mutate({ kind: "products" })} size="sm" type="button" variant="secondary"><Download aria-hidden="true" size={16}/> Products CSV</Button></div>}/>
    <Card className="report-filter-card"><CardContent><div aria-label="Report range" className="report-filters" role="group"><div className="category-pills">{RANGES.map((item) => <button aria-pressed={rangeId === item.id} className={rangeId === item.id ? "active" : ""} key={item.id} onClick={() => setPreset(item.id, item.days)} type="button">{item.label}</button>)}</div><div className="report-dates"><Input aria-label="Report start date" label="From" max={end} onChange={(event) => { setRangeId("custom"); setStart(event.target.value); }} type="date" value={start}/><Input aria-label="Report end date" label="To" min={start} onChange={(event) => { setRangeId("custom"); setEnd(event.target.value); }} type="date" value={end}/></div></div></CardContent></Card>
    {exportFile.error ? <div className="form-alert" role="alert">{exportFile.error.message}</div> : null}
    <DataState empty={{ icon: ReceiptText, title: "No report data", description: "Complete a sale or create an order to populate this range." }} isEmpty={() => false} query={report} skeleton="page">{(summary) => <>
      <section aria-label="Sales metrics" className="metric-grid report-metrics">
        <MetricCard icon={Wallet} label="Net revenue" tone="brand" value={formatBDT(summary.sales.net_revenue)}/>
        <MetricCard icon={RotateCcw} label="Refunds" tone="warning" value={formatBDT(summary.sales.refunds)}/>
        <MetricCard icon={TrendingUp} label="Gross profit" tone="info" value={formatBDT(summary.sales.gross_profit)}/>
        <MetricCard icon={ReceiptText} label="Transactions" value={String(summary.sales.transactions)}/>
      </section>
      <section className="report-grid">
        <Card className="report-products-card"><CardHeader><div><CardTitle>Product performance</CardTitle><CardDescription>Discount-adjusted revenue, cost and gross margin; returns are dated when received.</CardDescription></div></CardHeader><CardContent>{summary.top_products.length ? <ResponsiveTable caption="Product performance" columns={productColumns} rowKey={(row) => row.sku} rows={summary.top_products}/> : <div className="inline-empty"><PackageOpen aria-hidden="true"/> No product activity in this range.</div>}</CardContent></Card>
        <Card><CardHeader><div><CardTitle>Sales & payments</CardTitle><CardDescription>{summary.sales.offline_synced} synced offline · average {formatBDT(summary.sales.average_sale)}</CardDescription></div></CardHeader><CardContent>
          <ReportRow name="Gross sales" value={formatBDT(summary.sales.revenue, { precise: true })}/><ReportRow name="Discounts" value={formatBDT(summary.sales.discount, { precise: true })}/><ReportRow name="Refunds received" tone="danger" value={formatBDT(summary.sales.refunds, { precise: true })}/><ReportRow name="Cost of goods sold" value={formatBDT(summary.sales.cost_of_goods_sold, { precise: true })}/>{Object.entries(summary.sales.by_payment_method).map(([method, total]) => <ReportRow key={method} name={label(method)} value={formatBDT(total, { precise: true })}/>) }
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>Inventory snapshot</CardTitle><CardDescription>Current branch stock; quantities are not date-ranged.</CardDescription></div></CardHeader><CardContent>
          <ReportRow name="Physical units" value={String(summary.inventory.units_on_hand)}/><ReportRow name="Reserved units" value={String(summary.inventory.units_reserved)}/><ReportRow name="Available units" tone="success" value={String(summary.inventory.units_available)}/><ReportRow name="Cost value" value={formatBDT(summary.inventory.cost_value, { precise: true })}/><ReportRow name="Retail value" value={formatBDT(summary.inventory.retail_value, { precise: true })}/><ReportRow name="Low / out of stock" value={`${summary.inventory.low_stock} / ${summary.inventory.out_of_stock}`}/>
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>COD financials</CardTitle><CardDescription>{summary.cod.total} orders · {formatBDT(summary.cod.value)} booked COD</CardDescription></div></CardHeader><CardContent>
          <ReportRow name="Collected" tone="success" value={formatBDT(summary.cod.collected, { precise: true })}/><ReportRow name="Pending collection" value={formatBDT(summary.cod.pending, { precise: true })}/><ReportRow name="Failed COD value" tone="danger" value={formatBDT(summary.cod.failed, { precise: true })}/><ReportRow name="Return loss exposure" tone="danger" value={formatBDT(summary.cod.return_loss, { precise: true })}/><ReportRow name="Delivery success" value={formatPercent(summary.cod.delivery_rate)}/>{Object.entries(summary.cod.by_risk).map(([risk, count]) => <ReportRow key={risk} name={`${label(risk)} risk`} value={String(count)}/>) }
        </CardContent></Card>
        <Card><CardHeader><div><CardTitle>Courier outcomes</CardTitle><CardDescription>Shipments created in this range.</CardDescription></div></CardHeader><CardContent>
          <ReportRow name="Shipments" value={String(summary.courier.shipments)}/><ReportRow name="Delivered" tone="success" value={String(summary.courier.delivered)}/><ReportRow name="In transit" value={String(summary.courier.in_transit)}/><ReportRow name="Returned / cancelled" tone="danger" value={`${summary.courier.returned} / ${summary.courier.failed}`}/><ReportRow name="Delivery rate" value={formatPercent(summary.courier.delivery_rate)}/>{Object.entries(summary.courier.by_provider).map(([provider, count]) => <ReportRow key={provider} name={label(provider)} value={String(count)}/>) }
        </CardContent></Card>
      </section>
      <p className="report-footnote"><Boxes aria-hidden="true" size={15}/> Gross profit is net revenue minus snapshot cost of goods sold. “Return loss exposure” is uncollected COD value, not accounting net profit.</p>
    </>}</DataState>
  </div>;
}
