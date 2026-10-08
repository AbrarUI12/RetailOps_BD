import { Phone, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/Table";
import { api } from "../lib/api";

interface Customer { id: string; name: string; phone: string; normalized_phone: string; phone_verified: boolean; notes: string | null; created_at: string }

export function CustomersPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ["customers", search], queryFn: () => api<Customer[]>(`/api/v1/customers?search=${encodeURIComponent(search)}`) });
  const create = useMutation({ mutationFn: (body: object) => api<Customer>("/api/v1/customers", { method: "POST", body: JSON.stringify(body) }), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ["customers"] }); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const value = (key: string) => { const item = data.get(key); return typeof item === "string" ? item : ""; }; create.mutate({ name: value("name"), phone: value("phone"), notes: value("notes"), address: { address: value("address"), area: value("area"), city: "Dhaka" } }); }
  return <div><PageHeader eyebrow="Relationships" title="Customers" description="One customer record across POS, Facebook orders and delivery outcomes." actions={<Dialog onOpenChange={setOpen} open={open}><DialogTrigger asChild><Button><UserPlus size={17}/> Add customer</Button></DialogTrigger><DialogContent><DialogTitle>New customer</DialogTitle><DialogDescription>Bangladesh phone formats are normalized automatically.</DialogDescription><form className="form-stack" onSubmit={submit}><Input label="Name" name="name" required/><Input hint="017… or +88017…" label="Mobile number" name="phone" required/><Input label="Delivery address" name="address" required/><Input label="Area" name="area"/><Input label="Notes" name="notes"/>{create.error ? <div className="form-alert">{create.error.message}</div> : null}<Button disabled={create.isPending} type="submit">Save customer</Button></form></DialogContent></Dialog>}/><Card><CardContent><div className="toolbar"><div className="search-field"><Phone size={16}/><input aria-label="Search customers" onChange={(event) => setSearch(event.target.value)} placeholder="Name or mobile number…" value={search}/></div></div>{customers.data?.length ? <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Phone</TableHead><TableHead>Verification</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader><TableBody>{customers.data.map((customer) => <TableRow key={customer.id}><TableCell><strong>{customer.name}</strong><small className="cell-subtitle">{customer.notes}</small></TableCell><TableCell className="mono">{customer.normalized_phone}</TableCell><TableCell><Badge tone={customer.phone_verified ? "success" : "warning"}>{customer.phone_verified ? "Verified" : "Unverified"}</Badge></TableCell><TableCell>{new Intl.DateTimeFormat("en-BD", { dateStyle: "medium" }).format(new Date(customer.created_at))}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState action="Add customer" description="Customer profiles, addresses and purchase history will appear here." icon={Users} title="No customers found"/>}</CardContent></Card></div>;
}
