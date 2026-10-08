import { Bell, History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../lib/api";

interface Audit { id: string; action: string; entity_type: string; created_at: string }
interface Notification { id: string; kind: string; title: string; message: string; read_at: string | null; created_at: string }

export function ActivityPage() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<Audit[]>("/api/v1/audit") });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api<Notification[]>("/api/v1/notifications") });
  return <div><PageHeader eyebrow="Accountability" title="Activity & notifications" description="Security-sensitive actions and operational alerts in one place."/><section className="activity-grid"><Card><CardHeader><div><CardTitle><History size={16}/> Audit trail</CardTitle><CardDescription>Immutable business activity</CardDescription></div></CardHeader><CardContent>{audit.data?.map((item) => <div className="activity-row" key={item.id}><span><strong>{item.action.replaceAll(".", " ")}</strong><small>{item.entity_type}</small></span><time>{new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</time></div>)}</CardContent></Card><Card><CardHeader><div><CardTitle><Bell size={16}/> Notifications</CardTitle><CardDescription>Low stock, risk and sync signals</CardDescription></div></CardHeader><CardContent>{notifications.data?.map((item) => <div className="activity-row" key={item.id}><span><strong>{item.title}</strong><small>{item.message}</small></span><Badge tone={item.read_at ? "neutral" : "warning"}>{item.read_at ? "Read" : "New"}</Badge></div>)}</CardContent></Card></section></div>;
}
