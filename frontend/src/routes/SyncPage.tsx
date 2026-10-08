import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../lib/api";
import { offlineDb, type PendingSale } from "../lib/offlineDb";
import { processSyncQueue } from "../lib/syncEngine";
import { useSyncStore } from "../stores/syncStore";

interface Conflict { id: string; type: string; details: Record<string, string>; created_at: string; reviewed: boolean }

export function SyncPage() {
  const { status, pending } = useSyncStore();
  const [queue, setQueue] = useState<PendingSale[]>([]);
  const conflicts = useQuery({ queryKey: ["conflicts"], queryFn: () => api<Conflict[]>("/api/v1/sync/conflicts"), refetchInterval: 20_000 });
  useEffect(() => { void offlineDb.pendingSales.orderBy("created_at").reverse().toArray().then(setQueue); }, [pending, status]);
  const Icon = status === "OFFLINE" ? CloudOff : status === "ERROR" ? AlertTriangle : status === "SYNCED" ? CheckCircle2 : RefreshCw;
  return <div><PageHeader eyebrow="Device POS-01" title="Sync Center" description="Every offline transaction is durable, idempotent and visible through reconciliation." actions={<Button disabled={status === "OFFLINE" || status === "SYNCING"} onClick={() => void processSyncQueue()}><RefreshCw size={17}/> Sync now</Button>}/><section className="sync-summary"><Card><CardContent className="sync-hero"><span className={`sync-icon ${status.toLowerCase()}`}><Icon size={25}/></span><div><Badge tone={status === "ERROR" ? "danger" : status === "OFFLINE" ? "warning" : "success"}>{status}</Badge><h2>{pending ? `${pending} transactions waiting` : "Everything is safely synced"}</h2><p>The device keeps sales locally until the server acknowledges each transaction exactly once.</p></div></CardContent></Card><Card><CardHeader><div><CardTitle>Reconciliation</CardTitle><CardDescription>Manager attention queue</CardDescription></div></CardHeader><CardContent><strong className="sync-number">{conflicts.data?.length ?? 0}</strong><span className="muted">inventory conflicts</span></CardContent></Card></section><Card><CardHeader><div><CardTitle>Local queue</CardTitle><CardDescription>Durable IndexedDB transactions on this device</CardDescription></div></CardHeader><CardContent>{queue.length ? queue.map((item) => <div className="sync-row" key={item.client_transaction_id}><span><strong>{item.client_transaction_id.slice(0, 8).toUpperCase()}</strong><small>{new Date(item.created_at).toLocaleString("en-BD")}{item.error ? ` · ${item.error}` : ""}</small></span><Badge tone={item.status === "REJECTED" ? "danger" : item.status === "FAILED" ? "warning" : "info"}>{item.status === "REJECTED" ? "Needs review" : item.status}</Badge></div>) : <div className="inline-empty"><CheckCircle2/> No pending local transactions.</div>}{conflicts.data?.map((conflict) => <div className="sync-row conflict" key={conflict.id}><span><strong>{conflict.type.replaceAll("_", " ")}</strong><small>Sale {conflict.details.invoice_number}</small></span><Badge tone="danger">Review</Badge></div>)}</CardContent></Card></div>;
}
