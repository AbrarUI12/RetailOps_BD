import { Boxes, History, ListPlus as PlusMinus } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/Table";
import { api, type InventoryItem } from "../lib/api";

export function InventoryPage() {
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const queryClient = useQueryClient();
  const inventory = useQuery({ queryKey: ["inventory"], queryFn: () => api<InventoryItem[]>("/api/v1/inventory") });
  const adjust = useMutation({ mutationFn: (body: Record<string, unknown>) => api<InventoryItem>("/api/v1/inventory/adjustments", { method: "POST", body: JSON.stringify(body) }), onSuccess: async () => { setSelected(null); await queryClient.invalidateQueries({ queryKey: ["inventory"] }); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); if (selected) adjust.mutate({ variant_id: selected.variant_id, quantity_delta: Number(data.get("quantity")), reason: data.get("reason"), note: data.get("note") }); }
  return <PageTransition><div><PageHeader eyebrow="Stock control" title="Inventory ledger" description="Physical, reserved and available quantities—every change accounted for." actions={<Button variant="secondary"><History size={17}/> Movement history</Button>}/><Card><CardContent><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>SKU</TableHead><TableHead className="align-right">Physical</TableHead><TableHead className="align-right">Reserved</TableHead><TableHead className="align-right">Available</TableHead><TableHead>Status</TableHead><TableHead/></TableRow></TableHeader><TableBody>{inventory.data?.map((item) => <TableRow key={item.variant_id}><TableCell><strong>{item.product_name}</strong><small className="cell-subtitle">{item.variant_name}</small></TableCell><TableCell className="mono">{item.sku}</TableCell><TableCell className="align-right">{item.physical_quantity}</TableCell><TableCell className="align-right">{item.reserved_quantity}</TableCell><TableCell className="align-right strong">{item.available_quantity}</TableCell><TableCell><Badge tone={item.stock_status === "IN_STOCK" ? "success" : item.stock_status === "LOW_STOCK" ? "warning" : "danger"}>{item.stock_status.replaceAll("_", " ")}</Badge></TableCell><TableCell className="align-right"><Button onClick={() => setSelected(item)} size="sm" variant="ghost"><PlusMinus size={15}/> Adjust</Button></TableCell></TableRow>)}</TableBody></Table>{inventory.data?.length === 0 ? <div className="inline-empty"><Boxes/> Add products before receiving stock.</div> : null}</CardContent></Card>
    <Dialog onOpenChange={(open) => { if (!open) setSelected(null); }} open={Boolean(selected)}><DialogContent><DialogTitle>Adjust {selected?.product_name}</DialogTitle><DialogDescription>Creates an immutable ledger movement. Use a negative number to remove stock.</DialogDescription><form className="form-stack" onSubmit={submit}><Input label="Quantity change" name="quantity" placeholder="e.g. 12 or -2" required type="number"/><Input defaultValue="Stock count" label="Reason" name="reason" required/><Input defaultValue="Verified physical count" label="Note" name="note" required/>{adjust.error ? <div className="form-alert">{adjust.error.message}</div> : null}<Button disabled={adjust.isPending} type="submit">Record adjustment</Button></form></DialogContent></Dialog>
  </div></PageTransition>;
}
