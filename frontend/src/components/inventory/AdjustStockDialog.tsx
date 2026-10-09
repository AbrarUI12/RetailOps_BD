import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, type InventoryItem } from "../../lib/api";
import { formatNumber } from "../../lib/format";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { SelectField, TextareaField } from "../ui/Field";
import { Input } from "../ui/Input";
import { SegmentedControl } from "../ui/SegmentedControl";

const ADJUSTMENT_REASONS = [
  { value: "COUNT_CORRECTION", label: "Physical count correction" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "LOST_OR_STOLEN", label: "Lost or stolen" },
  { value: "FOUND", label: "Found stock" },
  { value: "OPENING_STOCK", label: "Opening stock" },
  { value: "RETURNED_TO_SUPPLIER", label: "Returned to supplier" },
  { value: "OTHER", label: "Other" },
] as const;

const MODES = [
  { value: "count", label: "Set counted quantity" },
  { value: "delta", label: "Add or remove" },
] as const;

/** No silent edits (plan §18): a quantity, a reason and a note, with the difference shown first. */
export function AdjustStockDialog({ item, onOpenChange }: { item: InventoryItem; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"count" | "delta">("count");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const amount = value === "" || value === "-" ? null : Number(value);
  const valid = amount !== null && Number.isInteger(amount) && (mode === "count" ? amount >= 0 : amount !== 0);
  const next = valid ? (mode === "count" ? amount : item.physical_quantity + amount) : null;
  const difference = next === null ? null : next - item.physical_quantity;
  const belowReserved = next !== null && next < item.reserved_quantity;

  const adjust = useMutation({
    mutationFn: () =>
      api<InventoryItem>("/api/v1/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          variant_id: item.variant_id,
          ...(mode === "count" ? { counted_quantity: amount } : { quantity_delta: amount }),
          reason,
          note,
        }),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-counts"] });
      toast.success("Stock updated", `${item.product_name} · ${item.variant_name}: ${formatNumber(updated.physical_quantity)} on hand`);
      onOpenChange(false);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && difference && reason && note.trim().length >= 3 && !belowReserved) adjust.mutate();
  }

  return (
    <Dialog onOpenChange={(open) => { if (!adjust.isPending) onOpenChange(open); }} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>{item.product_name} · {item.variant_name} <span className="mono">({item.sku})</span></DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={submit}>
          <SegmentedControl label="Adjustment type" onChange={(next) => { setMode(next); setValue(""); }} options={MODES} value={mode} />
          <Input
            autoFocus
            hint={mode === "count" ? "How many are physically on the shelf now" : "Use a minus sign to remove, e.g. -3"}
            inputMode="numeric"
            label={mode === "count" ? "Counted quantity" : "Change in quantity"}
            onChange={(event) => setValue(event.target.value)}
            required
            value={value}
          />
          <div aria-live="polite" className="preview-box">
            <span>Current<strong>{formatNumber(item.physical_quantity)}</strong></span>
            <span>New<strong>{next === null ? "—" : formatNumber(next)}</strong></span>
            <span>Difference<strong className={cn(difference && difference > 0 && "delta-up", difference && difference < 0 && "delta-down")}>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${formatNumber(difference)}`}</strong></span>
          </div>
          {difference === 0 ? <div className="form-notice" role="status">That matches the recorded stock; there is nothing to adjust.</div> : null}
          {belowReserved ? <div className="form-alert" role="alert">{formatNumber(item.reserved_quantity)} units are reserved for confirmed orders, so stock cannot go below that.</div> : null}
          <SelectField label="Reason" onChange={(event) => setReason(event.target.value)} required value={reason}>
            <option disabled value="">Choose a reason</option>
            {ADJUSTMENT_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <TextareaField hint="Recorded in the stock ledger with your name" label="Note" maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Counted during closing shift" required rows={2} value={note} />
          {adjust.error ? <div className="form-alert" role="alert">{adjust.error.message}</div> : null}
          <div className="dialog-footer">
            <Button disabled={adjust.isPending} onClick={() => onOpenChange(false)} type="button" variant="secondary">Cancel</Button>
            <Button aria-busy={adjust.isPending} disabled={adjust.isPending || !valid || !difference || !reason || note.trim().length < 3 || belowReserved} type="submit">
              {adjust.isPending ? <span aria-hidden="true" className="spinner" /> : null}
              {difference ? `Record ${difference > 0 ? "+" : ""}${formatNumber(difference)}` : "Record adjustment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
