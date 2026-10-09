import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api";
import { passwordProblems } from "../../lib/passwordPolicy";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";

export function ChangePasswordDialog({ onOpenChange, open }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const problems = next ? passwordProblems(next) : [];
  const mismatch = Boolean(confirm) && confirm !== next;
  const change = useMutation({
    mutationFn: () => api<void>("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }),
    onSuccess: () => {
      toast.success("Password changed", "Other devices were signed out.");
      setCurrent(""); setNext(""); setConfirm("");
      onOpenChange(false);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!problems.length && !mismatch) change.mutate();
  }

  return (
    <Dialog onOpenChange={(value) => { if (!change.isPending) onOpenChange(value); }} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You stay signed in here; every other device signs out.</DialogDescription>
        </DialogHeader>
        <form className="form-stack" onSubmit={submit}>
          <Input autoComplete="current-password" label="Current password" onChange={(event) => setCurrent(event.target.value)} required type="password" value={current} />
          <Input autoComplete="new-password" error={problems[0]} hint="At least 10 characters, with letters and numbers" label="New password" onChange={(event) => setNext(event.target.value)} required type="password" value={next} />
          <Input autoComplete="new-password" error={mismatch ? "Passwords do not match" : undefined} label="Confirm new password" onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
          {change.error ? <div className="form-alert" role="alert">{change.error.message}</div> : null}
          <div className="dialog-footer">
            <Button disabled={change.isPending} onClick={() => onOpenChange(false)} type="button" variant="secondary">Cancel</Button>
            <Button aria-busy={change.isPending} disabled={change.isPending || !current || !next || !confirm || problems.length > 0 || mismatch} type="submit">
              {change.isPending ? <span aria-hidden="true" className="spinner" /> : null}
              Change password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
