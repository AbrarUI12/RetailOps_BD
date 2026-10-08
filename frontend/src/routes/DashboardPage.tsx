import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  MoreHorizontal,
  PackagePlus,
  Plus,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/Table";
import { formatBDT } from "../lib/utils";

const activity = [
  { id: "POS-000284", customer: "Walk-in customer", source: "POS", total: 4850, status: "Paid", time: "2 min ago" },
  { id: "ORD-000912", customer: "Nusrat Jahan", source: "Facebook", total: 2600, status: "Confirm", time: "12 min ago" },
  { id: "POS-000283", customer: "Hasan Mahmud", source: "POS", total: 1220, status: "Paid", time: "24 min ago" },
] as const;

export function DashboardPage() {
  const formattedDate = new Intl.DateTimeFormat("en-BD", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dhaka",
  }).format(new Date());

  return (
    <PageTransition>
      <div className="dashboard-page">
      <FadeUp>
        <PageHeader
          eyebrow={formattedDate}
          title="Good evening, Abrar"
          description="Here’s the pulse of your Dhanmondi store today."
          actions={
            <>
              <Select defaultValue="today">
                <SelectTrigger aria-label="Dashboard date range"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 days</SelectItem>
                  <SelectItem value="month">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Button asChild><Link to="/pos"><Plus size={17} /> New sale</Link></Button>
            </>
          }
        />
      </FadeUp>

      <section aria-label="Key metrics" className="metric-grid">
        <FadeUp delay={0.03}><MetricCard change="12.4%" icon={Banknote} label="Net revenue" tone="brand" value="৳128,450" /></FadeUp>
        <FadeUp delay={0.06}><MetricCard change="8.2%" icon={ShoppingBag} label="Orders" tone="info" value="84" /></FadeUp>
        <FadeUp delay={0.09}><MetricCard change="5.6%" icon={TrendingUp} label="Gross profit" value="৳31,840" /></FadeUp>
        <FadeUp delay={0.12}><MetricCard icon={AlertTriangle} label="Low stock" tone="warning" value="12 items" /></FadeUp>
      </section>

      <section className="dashboard-grid">
        <FadeUp className="revenue-card" delay={0.1}>
          <Card>
            <CardHeader>
              <div><CardTitle>Revenue pulse</CardTitle><CardDescription>Sales volume across today</CardDescription></div>
              <Button aria-label="More revenue options" size="icon" variant="ghost"><MoreHorizontal size={18} /></Button>
            </CardHeader>
            <CardContent>
              <div className="chart-summary"><strong>৳128,450</strong><Badge tone="success"><ArrowUpRight size={12} /> 12.4%</Badge></div>
              <div className="chart" aria-label="Illustrative revenue chart" role="img">
                <svg preserveAspectRatio="none" viewBox="0 0 700 210">
                  <defs>
                    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#0f9f78" stopOpacity=".3" />
                      <stop offset="100%" stopColor="#0f9f78" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="chart-gridline" d="M0 35H700M0 105H700M0 175H700" />
                  <path className="chart-area" d="M0 170 C60 160 90 115 150 135 S235 170 290 110 S370 45 430 90 S515 140 565 76 S645 70 700 24 L700 210 L0 210 Z" />
                  <path className="chart-line" d="M0 170 C60 160 90 115 150 135 S235 170 290 110 S370 45 430 90 S515 140 565 76 S645 70 700 24" />
                </svg>
                <div className="chart-labels"><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span><span>6 PM</span><span>8 PM</span></div>
              </div>
            </CardContent>
          </Card>
        </FadeUp>

        <FadeUp className="quick-card" delay={0.14}>
          <Card>
            <CardHeader><div><CardTitle>Quick actions</CardTitle><CardDescription>Keep work moving</CardDescription></div></CardHeader>
            <CardContent className="quick-actions">
              <Link to="/pos"><span className="quick-icon"><ReceiptText size={19} /></span><span><strong>New sale</strong><small>Open the register</small></span><ArrowUpRight size={16} /></Link>
              <Link to="/orders"><span className="quick-icon blue"><ClipboardCheck size={19} /></span><span><strong>Create order</strong><small>Facebook or phone</small></span><ArrowUpRight size={16} /></Link>
              <Link to="/products"><span className="quick-icon amber"><PackagePlus size={19} /></span><span><strong>Add product</strong><small>Catalog and variants</small></span><ArrowUpRight size={16} /></Link>
              <Link to="/inventory"><span className="quick-icon violet"><Boxes size={19} /></span><span><strong>Adjust stock</strong><small>Record movement</small></span><ArrowUpRight size={16} /></Link>
            </CardContent>
          </Card>
        </FadeUp>
      </section>

      <FadeUp delay={0.16}>
        <Card className="activity-card">
          <CardHeader>
            <div><CardTitle>Recent activity</CardTitle><CardDescription>Latest sales and orders across this branch</CardDescription></div>
            <Button asChild size="sm" variant="secondary"><Link to="/orders">View all</Link></Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Customer</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead className="align-right">Amount</TableHead><TableHead className="align-right">Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {activity.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="mono strong">{item.id}</TableCell>
                    <TableCell>{item.customer}</TableCell>
                    <TableCell><Badge>{item.source}</Badge></TableCell>
                    <TableCell><Badge tone={item.status === "Paid" ? "success" : "warning"}>{item.status}</Badge></TableCell>
                    <TableCell className="align-right strong">{formatBDT(item.total)}</TableCell>
                    <TableCell className="align-right muted">{item.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </FadeUp>

      <div className="demo-note"><Sparkles size={14} /> Interface preview uses sample data until reporting is connected.</div>
      </div>
    </PageTransition>
  );
}

