import { Banknote, ClipboardList, Clock3, MapPin, PackageCheck, Phone, RotateCcw, ShieldCheck, ShoppingBag, UserPlus, Users } from "lucide-react";
import { useDeferredValue, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { DataState, StateMessage } from "../components/ui/DataState";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { MetricCard } from "../components/ui/MetricCard";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/Sheet";
import { Tabs } from "../components/ui/Tabs";
import { api } from "../lib/api";
import { formatBDT, formatDate, formatDateTime, label } from "../lib/format";
import { can } from "../lib/permissions";
import { useAuthStore } from "../stores/authStore";

interface Customer { id: string; name: string; phone: string; normalized_phone: string; phone_verified: boolean; notes: string | null; created_at: string }
interface Address { id: string; label: string; address: string; area: string | null; city: string; created_at: string }
interface Purchase { id: string; kind: "SALE" | "ORDER"; reference: string; status: string; source: string; total: string; created_at: string }
interface Payment { id: string; reference: string; method: string; amount: string; created_at: string }
interface CustomerReturn { id: string; reference: string; status: string; reason: string; created_at: string }
interface Activity { id: string; kind: string; title: string; detail: string | null; created_at: string }
interface Profile {
  customer: Customer;
  metrics: { total_spend: string; sale_count: number; order_count: number; successful_deliveries: number; delivery_outcomes: number; delivery_success_rate: number | null; cod_risk: { score: number; level: string; reasons: string[]; recommendation: string } };
  addresses: Address[];
  purchases: Purchase[];
  payments: Payment[];
  returns: CustomerReturn[];
  activity: Activity[];
}
type ProfileTab = "overview" | "orders" | "addresses" | "payments" | "returns" | "activity";

export function CustomersPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [createOpen, setCreateOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("customer");
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const customers = useQuery({ queryKey: ["customers", deferredSearch], queryFn: () => api<Customer[]>(`/api/v1/customers?search=${encodeURIComponent(deferredSearch)}`) });
  const create = useMutation({ mutationFn: (body: object) => api<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(body) }), onSuccess: async (customer) => { setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: ["customers"] }); setParams({ customer: customer.id }); } });
  const columns: Column<Customer>[] = [
    { key: "customer", header: "Customer", primary: true, cell: (customer) => <><strong>{customer.name}</strong><small className="cell-subtitle">Since {formatDate(customer.created_at)}</small></> },
    { key: "phone", header: "Mobile", cell: (customer) => <span className="mono">{customer.normalized_phone}</span> },
    { key: "status", header: "Phone status", trailing: true, cell: (customer) => <Badge tone={customer.phone_verified ? "success" : "warning"}>{customer.phone_verified ? "Verified" : "Unverified"}</Badge> },
    { key: "notes", header: "Notes", hideOnMobile: true, cell: (customer) => customer.notes || "—" },
  ];
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const value = (key: string) => { const item = data.get(key); return typeof item === "string" ? item.trim() : ""; }; const address = value("address"); create.mutate({ name: value("name"), phone: value("phone"), notes: value("notes") || null, address: address ? { label: "Home", address, area: value("area") || null, city: value("city") || "Dhaka" } : null }); }
  return <div className="customers-page"><PageHeader eyebrow="Relationships" title="Customers" description="One customer record across checkout, social orders and delivery outcomes." actions={can(user, "customer:write") ? <Dialog onOpenChange={setCreateOpen} open={createOpen}><DialogTrigger asChild><Button><UserPlus size={17}/> Add customer</Button></DialogTrigger><DialogContent><DialogTitle>New customer</DialogTitle><DialogDescription>Bangladesh mobile formats are normalized to one customer record.</DialogDescription><form className="form-stack" onSubmit={submit}><Input label="Name" name="name" required/><Input hint="017… or +88017…" label="Mobile number" name="phone" required/><Input label="Delivery address (optional)" name="address"/><div className="form-grid"><Input label="Area" name="area"/><Input defaultValue="Dhaka" label="City" name="city"/></div><Input label="Notes" name="notes"/>{create.error ? <div className="form-alert">{create.error.message}</div> : null}<Button disabled={create.isPending} type="submit">{create.isPending ? "Saving…" : "Save customer"}</Button></form></DialogContent></Dialog> : undefined}/><Card><CardContent><div className="toolbar customers-toolbar"><div className="search-field"><Phone aria-hidden="true" size={16}/><input aria-label="Search customers" onChange={(event) => setSearch(event.target.value)} placeholder="Name or mobile number…" value={search}/></div><span className="result-count">{customers.data?.length ?? 0} customers</span></div><DataState query={customers} empty={{ icon: Users, title: search ? "No matching customers" : "No customers yet", description: search ? "Try a name or another Bangladesh mobile format." : "Customer profiles appear after checkout or manual entry." }} children={(rows) => <ResponsiveTable caption="Customers" columns={columns} onRowClick={(customer) => setParams({ customer: customer.id })} rowKey={(customer) => customer.id} rowLabel={(customer) => `View ${customer.name}`} rows={rows}/>} /></CardContent></Card><CustomerProfileSheet customerId={selectedId} onOpenChange={(open) => { if (!open) setParams({}); }}/></div>;
}

function CustomerProfileSheet({ customerId, onOpenChange }: { customerId: string | null; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<ProfileTab>("overview"); const [addressOpen, setAddressOpen] = useState(false); const queryClient = useQueryClient(); const user = useAuthStore((state) => state.user);
  const profile = useQuery({ queryKey: ["customer-profile", customerId], queryFn: () => api<Profile>(`/api/v1/customers/${customerId}/profile`), enabled: Boolean(customerId) });
  const addAddress = useMutation({ mutationFn: (body: object) => api<Address>(`/api/v1/customers/${customerId}/addresses`, { method: "POST", body: JSON.stringify(body) }), onSuccess: async () => { setAddressOpen(false); await queryClient.invalidateQueries({ queryKey: ["customer-profile", customerId] }); } });
  function submitAddress(event: FormEvent<HTMLFormElement>) { event.preventDefault(); addAddress.mutate(Object.fromEntries(new FormData(event.currentTarget).entries())); }
  return <Sheet onOpenChange={onOpenChange} open={Boolean(customerId)}><SheetContent className="customer-sheet"><SheetTitle>{profile.data?.customer.name ?? "Customer profile"}</SheetTitle><SheetDescription>{profile.data ? `${profile.data.customer.normalized_phone} · Customer since ${formatDate(profile.data.customer.created_at)}` : "Loading customer history"}</SheetDescription><DataState query={profile} isEmpty={() => false} skeleton="page" empty={{ icon: Users, title: "Customer unavailable", description: "This customer could not be loaded." }} children={(data) => { const risk = data.metrics.cod_risk; const tabs = [
    { value: "overview" as const, label: "Overview", content: <Overview profile={data}/> },
    { value: "orders" as const, label: "Orders", content: <Purchases purchases={data.purchases}/> },
    { value: "addresses" as const, label: "Addresses", content: <Addresses addresses={data.addresses} canWrite={can(user, "customer:write")} open={addressOpen} setOpen={setAddressOpen} submit={submitAddress} pending={addAddress.isPending} error={addAddress.error}/> },
    { value: "payments" as const, label: "Payments", content: <Payments payments={data.payments}/> },
    { value: "returns" as const, label: "Returns", content: <Returns returns={data.returns}/> },
    { value: "activity" as const, label: "Activity", content: <ActivityList activity={data.activity}/> },
  ]; return <div className="customer-profile"><div className="customer-identity"><div className="customer-avatar">{data.customer.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</div><div><div className="identity-line"><h2>{data.customer.name}</h2><Badge tone={data.customer.phone_verified ? "success" : "warning"}>{data.customer.phone_verified ? "Verified" : "Unverified phone"}</Badge></div><a href={`tel:${data.customer.normalized_phone}`}>{data.customer.normalized_phone}</a></div><div className={`risk-score risk-${risk.level.toLowerCase()}`}><span>{label(risk.level)} risk</span><strong>{risk.score}</strong></div></div><div className="customer-metrics"><MetricCard icon={Banknote} label="Total spend" tone="brand" value={formatBDT(data.metrics.total_spend)}/><MetricCard icon={ShoppingBag} label="Purchases" tone="info" value={String(data.metrics.order_count + data.metrics.sale_count)}/><MetricCard icon={PackageCheck} label="Delivered" tone="brand" value={String(data.metrics.successful_deliveries)}/><MetricCard icon={ShieldCheck} label="Delivery success" tone="warning" value={data.metrics.delivery_success_rate === null ? "New" : `${data.metrics.delivery_success_rate}%`}/></div><Tabs label="Customer profile sections" onChange={setTab} tabs={tabs} value={tab}/></div>; }}/></SheetContent></Sheet>;
}

function Overview({ profile }: { profile: Profile }) { const risk = profile.metrics.cod_risk; return <div className="profile-grid"><Card><CardContent><SectionTitle icon={ShieldCheck}>COD risk</SectionTitle><div className="risk-summary"><Badge tone={risk.level === "LOW" ? "success" : risk.level === "MEDIUM" ? "warning" : "danger"}>{label(risk.level)} · {risk.score}/100</Badge><strong>{risk.recommendation}</strong>{risk.reasons.length ? <ul>{risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>No risk flags for this customer.</p>}</div></CardContent></Card><Card><CardContent><SectionTitle icon={Clock3}>Recent history</SectionTitle>{profile.purchases.length ? <HistoryRows purchases={profile.purchases.slice(0, 4)}/> : <p className="muted-copy">No purchases yet.</p>}</CardContent></Card>{profile.customer.notes ? <Card className="full"><CardContent><SectionTitle icon={ClipboardList}>Notes</SectionTitle><p>{profile.customer.notes}</p></CardContent></Card> : null}</div>; }
function Purchases({ purchases }: { purchases: Purchase[] }) { return purchases.length ? <HistoryRows purchases={purchases}/> : <StateMessage icon={ShoppingBag} title="No purchases yet" description="POS sales and social orders will appear together here."/>; }
function HistoryRows({ purchases }: { purchases: Purchase[] }) { return <div className="profile-list">{purchases.map((item) => <a className="profile-row" href={item.kind === "SALE" ? `/sales?sale=${item.id}` : `/orders?focus=${item.id}`} key={`${item.kind}-${item.id}`}><span className="profile-row-icon">{item.kind === "SALE" ? <ShoppingBag size={17}/> : <ClipboardList size={17}/>}</span><span><strong>{item.reference}</strong><small>{label(item.source)} · {formatDateTime(item.created_at)}</small></span><span className="profile-row-end"><strong>{formatBDT(item.total)}</strong><Badge tone={item.status === "DELIVERED" || item.status === "COMPLETED" ? "success" : "info"}>{label(item.status)}</Badge></span></a>)}</div>; }
function Addresses({ addresses, canWrite, open, setOpen, submit, pending, error }: { addresses: Address[]; canWrite: boolean; open: boolean; setOpen: (open: boolean) => void; submit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; error: Error | null }) { return <div><div className="tab-actions"><h3>Saved addresses</h3>{canWrite ? <Dialog onOpenChange={setOpen} open={open}><DialogTrigger asChild><Button size="sm" variant="secondary"><MapPin size={15}/> Add address</Button></DialogTrigger><DialogContent><DialogTitle>Add an address</DialogTitle><DialogDescription>Save another delivery destination for faster order entry.</DialogDescription><form className="form-stack" onSubmit={submit}><Input defaultValue="Home" label="Label" name="label" required/><Input label="Address" name="address" required/><Input label="Area" name="area"/><Input defaultValue="Dhaka" label="City" name="city" required/>{error ? <div className="form-alert">{error.message}</div> : null}<Button disabled={pending} type="submit">Save address</Button></form></DialogContent></Dialog> : null}</div>{addresses.length ? <div className="address-grid">{addresses.map((address) => <Card key={address.id}><CardContent><Badge>{address.label}</Badge><strong>{address.address}</strong><p>{[address.area, address.city].filter(Boolean).join(", ")}</p></CardContent></Card>)}</div> : <StateMessage icon={MapPin} title="No saved addresses" description="Add a delivery address to speed up future orders."/>}</div>; }
function Payments({ payments }: { payments: Payment[] }) { return payments.length ? <div className="profile-list">{payments.map((payment) => <div className="profile-row" key={payment.id}><span className="profile-row-icon"><Banknote size={17}/></span><span><strong>{label(payment.method)}</strong><small>{payment.reference} · {formatDateTime(payment.created_at)}</small></span><strong className="profile-row-end">{formatBDT(payment.amount)}</strong></div>)}</div> : <StateMessage icon={Banknote} title="No payments yet" description="Recorded payments appear here."/>; }
function Returns({ returns }: { returns: CustomerReturn[] }) { return returns.length ? <div className="profile-list">{returns.map((item) => <div className="profile-row" key={item.id}><span className="profile-row-icon"><RotateCcw size={17}/></span><span><strong>{item.reference}</strong><small>{item.reason} · {formatDateTime(item.created_at)}</small></span><Badge tone="warning">{label(item.status)}</Badge></div>)}</div> : <StateMessage icon={RotateCcw} title="No returns" description="This customer has no recorded returns."/>; }
function ActivityList({ activity }: { activity: Activity[] }) { return activity.length ? <div className="timeline">{activity.map((item) => <div className="timeline-item" key={item.id}><span/><div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}<time>{formatDateTime(item.created_at)}</time></div></div>)}</div> : <StateMessage icon={Clock3} title="No activity yet" description="Customer changes and events appear here."/>; }
function SectionTitle({ children, icon: Icon }: { children: ReactNode; icon: typeof ShieldCheck }) { return <h3 className="section-title"><Icon aria-hidden="true" size={17}/>{children}</h3>; }
