import type { ReactNode } from "react";

import { Button } from "./Button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./Dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** "danger" for destructive or irreversible actions. */
  tone?: "primary" | "danger";
  pending?: boolean;
  error?: string | null;
  /** Extra context shown before confirming, e.g. a stock difference preview. */
  children?: ReactNode;
}

export function ConfirmDialog({
  children,
  confirmLabel,
  description,
  error,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
  tone = "primary",
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={(next) => { if (!pending) onOpenChange(next); }} open={open}>
      <DialogContent aria-describedby="confirm-description" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="confirm-description">{description}</DialogDescription>
        </DialogHeader>
        {children ? <div className="form-stack">{children}</div> : null}
        {error ? <div className="form-alert" role="alert" style={{ marginTop: "var(--space-4)" }}>{error}</div> : null}
        <div className="dialog-footer">
          <DialogClose asChild>
            <Button disabled={pending} type="button" variant="secondary">Cancel</Button>
          </DialogClose>
          <Button aria-busy={pending} disabled={pending} onClick={onConfirm} type="button" variant={tone === "danger" ? "danger" : "primary"}>
            {pending ? <span aria-hidden="true" className="spinner" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
