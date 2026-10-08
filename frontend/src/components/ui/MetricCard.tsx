import type { LucideIcon } from "lucide-react";

import { Badge } from "./Badge";
import { Card } from "./Card";

interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  icon: LucideIcon;
  tone?: "brand" | "info" | "warning" | "neutral";
}

export function MetricCard({ change, icon: Icon, label, tone = "neutral", value }: MetricCardProps) {
  return (
    <Card className="metric-card">
      <div className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" size={18} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {change ? <Badge tone="success">{change}</Badge> : null}
    </Card>
  );
}

