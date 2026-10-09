import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Eye,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/Card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/Dialog";
import { SelectField, TextareaField } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { api } from "../lib/api";
import { offlineDb, type PendingSale } from "../lib/offlineDb";
import { processSyncQueue } from "../lib/syncEngine";
import { formatDateTime, label } from "../lib/format";
import { can } from "../lib/permissions";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";
import { useSyncStore } from "../stores/syncStore";

export interface Conflict {
  id: string;
  sync_transaction_id: string;
  type: string;
  details: {
    sale_id: string;
    invoice_number: string;
    lines?: {
      variant_id?: string;
      product?: string;
      sku?: string;
      quantity_sold?: number;
      stock_before?: number;
      stock_after?: number;
      paid?: string;
      catalog?: string;
    }[];
  };
  created_at: string;
  reviewed: boolean;
  reviewed_at: string | null;
  resolution: string | null;
  resolution_note: string | null;
}

export function SyncPage() {
  const { status, pending } = useSyncStore();
  const user = useAuthStore((state) => state.user);
  const [queue, setQueue] = useState<PendingSale[]>([]);
  const [selected, setSelected] = useState<Conflict | null>(null);
  const conflicts = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => api<Conflict[]>("/api/v1/sync/conflicts"),
    refetchInterval: 20_000,
  });
  useEffect(() => {
    void offlineDb.pendingSales
      .orderBy("created_at")
      .reverse()
      .toArray()
      .then(setQueue);
  }, [pending, status]);
  const Icon =
    status === "OFFLINE"
      ? CloudOff
      : status === "ERROR"
        ? AlertTriangle
        : status === "SYNCED"
          ? CheckCircle2
          : RefreshCw;
  return (
    <div>
      <PageHeader
        eyebrow="Device POS-01"
        title="Sync Center"
        description="Every offline transaction is durable, idempotent and visible through reconciliation."
        actions={
          <Button
            disabled={status === "OFFLINE" || status === "SYNCING"}
            onClick={() => void processSyncQueue()}
          >
            <RefreshCw size={17} /> Sync now
          </Button>
        }
      />
      <section className="sync-summary">
        <Card>
          <CardContent className="sync-hero">
            <span className={`sync-icon ${status.toLowerCase()}`}>
              <Icon size={25} />
            </span>
            <div>
              <Badge
                tone={
                  status === "ERROR"
                    ? "danger"
                    : status === "OFFLINE"
                      ? "warning"
                      : "success"
                }
              >
                {status}
              </Badge>
              <h2>
                {pending
                  ? `${pending} transactions waiting`
                  : "Everything is safely synced"}
              </h2>
              <p>
                The device keeps sales locally until the server acknowledges
                each transaction exactly once.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reconciliation</CardTitle>
              <CardDescription>Manager attention queue</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <strong className="sync-number">
              {conflicts.data?.filter((item) => !item.reviewed).length ?? 0}
            </strong>
            <span className="muted">inventory conflicts</span>
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Local queue</CardTitle>
            <CardDescription>
              Durable IndexedDB transactions on this device
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {queue.length ? (
            queue.map((item) => (
              <div className="sync-row" key={item.client_transaction_id}>
                <span>
                  <strong>
                    {item.client_transaction_id.slice(0, 8).toUpperCase()}
                  </strong>
                  <small>
                    {new Date(item.created_at).toLocaleString("en-BD")}
                    {item.error ? ` · ${item.error}` : ""}
                  </small>
                </span>
                <Badge
                  tone={
                    item.status === "REJECTED"
                      ? "danger"
                      : item.status === "FAILED"
                        ? "warning"
                        : "info"
                  }
                >
                  {item.status === "REJECTED" ? "Needs review" : item.status}
                </Badge>
              </div>
            ))
          ) : (
            <div className="inline-empty">
              <CheckCircle2 /> No pending local transactions.
            </div>
          )}
          {conflicts.data?.map((conflict) => (
            <button
              className="sync-row conflict"
              key={conflict.id}
              onClick={() => setSelected(conflict)}
              type="button"
            >
              <span>
                <strong>{conflict.type.replaceAll("_", " ")}</strong>
                <small>Sale {conflict.details.invoice_number}</small>
              </span>
              <Badge tone={conflict.reviewed ? "success" : "danger"}>
                {conflict.reviewed ? "Resolved" : "Review"}
              </Badge>
              <Eye aria-hidden="true" size={16} />
            </button>
          ))}
        </CardContent>
      </Card>
      <ConflictDialog
        conflict={selected}
        canResolve={can(user, "inventory:adjust")}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function ConflictDialog({
  conflict,
  canResolve,
  onOpenChange,
}: {
  conflict: Conflict | null;
  canResolve: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: (body: object) =>
      api<Conflict>(`/api/v1/sync/conflicts/${conflict!.id}/resolve`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async (result) => {
      toast.success(
        "Conflict resolved",
        `${result.details.invoice_number} is no longer in the attention queue.`,
      );
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conflicts"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-counts"] }),
      ]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const resolution = data.get("resolution");
    const note = data.get("note");
    if (typeof resolution === "string" && typeof note === "string")
      resolve.mutate({ resolution, note });
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(conflict)}>
      <DialogContent className="conflict-dialog">
        <DialogTitle>
          {conflict ? label(conflict.type) : "Sync conflict"}
        </DialogTitle>
        <DialogDescription>
          {conflict
            ? `${conflict.details.invoice_number} · Synced ${formatDateTime(conflict.created_at)}`
            : "Reconciliation detail"}
        </DialogDescription>
        {conflict ? (
          <div className="conflict-detail">
            <div className="conflict-explainer">
              <AlertTriangle size={20} />
              <span>
                <strong>The sale is preserved.</strong>
                <p>
                  PostgreSQL remains authoritative. Review the stock difference
                  and record the operational follow-up.
                </p>
              </span>
            </div>
            <div className="conflict-lines">
              {conflict.details.lines?.map((line, index) => (
                <div key={`${line.variant_id ?? line.sku}-${index}`}>
                  <span>
                    <strong>{line.product ?? line.sku ?? "Sale line"}</strong>
                    <small>
                      {line.sku}
                      {line.quantity_sold
                        ? ` · ${line.quantity_sold} sold`
                        : ""}
                    </small>
                  </span>
                  {line.stock_before !== undefined ? (
                    <span className="stock-difference">
                      <small>Recorded stock</small>
                      <strong>
                        {line.stock_before} → {line.stock_after}
                      </strong>
                    </span>
                  ) : (
                    <span className="stock-difference">
                      <small>Price paid → catalog</small>
                      <strong>
                        {line.paid} → {line.catalog}
                      </strong>
                    </span>
                  )}
                </div>
              ))}
            </div>
            {conflict.reviewed ? (
              <div className="resolution-summary">
                <CheckCircle2 size={18} />
                <span>
                  <strong>{label(conflict.resolution)}</strong>
                  <p>{conflict.resolution_note}</p>
                  {conflict.reviewed_at ? (
                    <small>{formatDateTime(conflict.reviewed_at)}</small>
                  ) : null}
                </span>
              </div>
            ) : canResolve ? (
              <form className="form-stack" onSubmit={submit}>
                <SelectField label="Resolution" name="resolution">
                  <option value="STOCK_RECOUNT_REQUESTED">
                    Request physical stock recount
                  </option>
                  <option value="ACKNOWLEDGED">Acknowledge discrepancy</option>
                  <option value="RESOLVED_EXTERNALLY">
                    Resolved outside RetailOps
                  </option>
                </SelectField>
                <TextareaField
                  label="Resolution note"
                  minLength={3}
                  name="note"
                  placeholder="What will happen next?"
                  required
                />
                {resolve.error ? (
                  <div className="form-alert" role="alert">
                    {resolve.error.message}
                  </div>
                ) : null}
                <Button disabled={resolve.isPending} type="submit">
                  {resolve.isPending ? "Saving…" : "Resolve conflict"}
                </Button>
              </form>
            ) : (
              <p className="form-notice">
                A manager with inventory-adjust permission must resolve this
                conflict.
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
