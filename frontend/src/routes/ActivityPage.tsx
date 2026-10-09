import { Bell, CheckCheck, ExternalLink, Filter, History, Search } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { Drawer } from "../components/ui/Drawer";
import { SelectField } from "../components/ui/Field";
import { Pagination } from "../components/ui/Pagination";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { api, type AppNotification } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { auditLink, notificationLink } from "../lib/notifications";
import { can } from "../lib/permissions";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";

interface Audit {
  id: string; action: string; entity_type: string; entity_id: string | null; user_id: string | null;
  actor_name: string | null; actor_email: string | null; old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null; request_id: string | null; ip_address: string | null;
  user_agent: string | null; created_at: string;
}
interface AuditPage { items: Audit[]; page: number; page_size: number; total: number }

const ENTITY_TYPES = ["product", "product_variant", "customer", "sale", "order", "shipment", "purchase", "return", "sync_conflict", "user"];
const titleCase = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayValue = (value: unknown) => {
  if (value === null || value === undefined) return "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return `${value}`;
  return "Unsupported value";
};

export function ActivityPage() {
  const user = useAuthStore((state) => state.user);
  const auditAllowed = can(user, "audit:read");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [selected, setSelected] = useState<Audit | null>(null);
  const [notificationView, setNotificationView] = useState<"all" | "unread">("all");
  const debounced = useDebounced(search);
  const auditParams = new URLSearchParams({ page: String(page), page_size: "25" });
  if (debounced) auditParams.set("q", debounced);
  if (entityType) auditParams.set("entity_type", entityType);
  const audit = useQuery({ queryKey: ["audit", page, debounced, entityType], queryFn: () => api<AuditPage>(`/api/v1/audit?${auditParams}`), enabled: auditAllowed });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api<AppNotification[]>("/api/v1/notifications") });
  const refreshNotifications = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-counts"] }),
  ]);
  const markRead = useMutation({
    mutationFn: (id: string) => api<AppNotification>(`/api/v1/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refreshNotifications,
  });
  const markAll = useMutation({
    mutationFn: () => api<void>("/api/v1/notifications/read-all", { method: "POST" }),
    onSuccess: async () => { await refreshNotifications(); toast.success("Notifications cleared", "Everything visible is marked read for you."); },
  });
  const visibleNotifications = (notifications.data ?? []).filter((item) => notificationView === "all" || !item.read_at);
  const unread = (notifications.data ?? []).filter((item) => !item.read_at).length;

  async function openNotification(item: AppNotification) {
    if (!item.read_at) await markRead.mutateAsync(item.id);
    void navigate(notificationLink(item));
  }

  return <div className="activity-page">
    <PageHeader eyebrow="Accountability" title="Activity & notifications" description="Trace sensitive changes and act on stock, risk and synchronization alerts."/>
    <section className={auditAllowed ? "activity-layout" : "activity-layout notifications-only"}>
      {auditAllowed ? <Card className="audit-card"><CardHeader><div><CardTitle><History aria-hidden="true" size={17}/> Audit trail</CardTitle><CardDescription>Immutable who, what and request context</CardDescription></div></CardHeader><CardContent>
        <div className="audit-toolbar"><div className="search-field"><Search aria-hidden="true" size={16}/><input aria-label="Search audit trail" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Action, entity or team member…" value={search}/></div><SelectField aria-label="Audit entity type" label="Entity" onChange={(event) => { setEntityType(event.target.value); setPage(1); }} value={entityType}><option value="">All entities</option>{ENTITY_TYPES.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}</SelectField></div>
        <DataState query={audit} empty={{ icon: Filter, title: "No matching activity", description: "Change the search or entity filter." }}>{(data) => <><div className="audit-list">{data.items.map((item) => <button className="audit-row" key={item.id} onClick={() => setSelected(item)} type="button"><span className="audit-action-icon"><History aria-hidden="true" size={15}/></span><span><strong>{titleCase(item.action)}</strong><small>{item.actor_name ?? "System"} · {titleCase(item.entity_type)}</small></span><time dateTime={item.created_at}>{formatRelative(item.created_at)}</time></button>)}</div><Pagination noun="events" onPage={setPage} page={data.page} pageSize={data.page_size} total={data.total}/></>}</DataState>
      </CardContent></Card> : null}
      <Card className="notifications-card"><CardHeader><div><CardTitle><Bell aria-hidden="true" size={17}/> Notifications</CardTitle><CardDescription>{unread ? `${unread} need attention` : "Everything is up to date"}</CardDescription></div><Button disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()} size="sm" type="button" variant="ghost"><CheckCheck aria-hidden="true" size={16}/> Mark all read</Button></CardHeader><CardContent>
        <SegmentedControl label="Notification view" onChange={setNotificationView} options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread (${unread})` }]} value={notificationView}/>
        <DataState query={notifications} isEmpty={() => visibleNotifications.length === 0} empty={{ icon: Bell, title: notificationView === "unread" ? "No unread notifications" : "No notifications yet", description: notificationView === "unread" ? "You are all caught up." : "Operational alerts will appear here." }}>{() => <div className="activity-notifications">{visibleNotifications.map((item) => <button className={item.read_at ? "activity-notification" : "activity-notification unread"} key={item.id} onClick={() => void openNotification(item)} type="button"><span className="notification-dot"/><span><strong>{item.title}</strong><small>{item.message}</small><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></span><Badge tone={item.read_at ? "neutral" : "warning"}>{item.read_at ? "Read" : "New"}</Badge></button>)}</div>}</DataState>
      </CardContent></Card>
    </section>
    <Drawer description={selected ? `${selected.actor_name ?? "System"} · ${formatDateTime(selected.created_at)}` : undefined} footer={selected && auditLink(selected.entity_type, selected.entity_id) ? <Button asChild type="button"><Link to={auditLink(selected.entity_type, selected.entity_id)!}><ExternalLink aria-hidden="true" size={16}/> Open record</Link></Button> : undefined} meta={selected ? <Badge tone="info">{titleCase(selected.entity_type)}</Badge> : undefined} onOpenChange={(open) => { if (!open) setSelected(null); }} open={Boolean(selected)} title={selected ? titleCase(selected.action) : "Audit event"} wide>
      {selected ? <div className="audit-detail"><dl className="audit-context"><div><dt>Actor</dt><dd>{selected.actor_name ?? "System"}</dd></div><div><dt>Email</dt><dd>{selected.actor_email ?? "—"}</dd></div><div><dt>IP address</dt><dd className="mono">{selected.ip_address ?? "—"}</dd></div><div><dt>Request ID</dt><dd className="mono">{selected.request_id ?? "—"}</dd></div></dl><ChangeSet title="Before" values={selected.old_data}/><ChangeSet title="After" values={selected.new_data}/>{selected.user_agent ? <p className="audit-user-agent"><strong>User agent</strong>{selected.user_agent}</p> : null}</div> : null}
    </Drawer>
  </div>;
}

function ChangeSet({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  if (!values || !Object.keys(values).length) return null;
  return <section className="audit-change-set"><h3>{title}</h3><dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{titleCase(key)}</dt><dd>{displayValue(value)}</dd></div>)}</dl></section>;
}
