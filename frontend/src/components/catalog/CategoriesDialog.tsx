import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, type Category } from "../../lib/api";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";

interface CategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
}

export function CategoriesDialog({ categories, onOpenChange, open }: CategoriesDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const create = useMutation({
    mutationFn: (value: string) => api<Category>("/api/v1/categories", { method: "POST", body: JSON.stringify({ name: value }) }),
    onSuccess: (category) => { toast.success("Category added", category.name); setName(""); refresh(); },
  });
  const rename = useMutation({
    mutationFn: ({ id, name: value }: { id: string; name: string }) => api<Category>(`/api/v1/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name: value }) }),
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/v1/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Category deleted"); setDeleting(null); refresh(); },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  const error = create.error ?? rename.error;
  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categories</DialogTitle>
            <DialogDescription>Group products for filters, reports and the POS category bar.</DialogDescription>
          </DialogHeader>
          <form className="attribute-row" onSubmit={submit} style={{ marginTop: "var(--space-5)" }}>
            <Input label="New category" onChange={(event) => setName(event.target.value)} placeholder="Women's wear" value={name} />
            <span />
            <Button aria-busy={create.isPending} disabled={!name.trim() || create.isPending} type="submit"><Plus aria-hidden="true" size={16} /> Add</Button>
          </form>
          {error ? <div className="form-alert" role="alert" style={{ marginTop: "var(--space-3)" }}>{error.message}</div> : null}
          <div style={{ marginTop: "var(--space-4)" }}>
            {categories.length === 0 ? <p className="inline-empty">No categories yet.</p> : null}
            {categories.map((category) => (
              <div className="category-row" key={category.id}>
                {editing?.id === category.id ? (
                  <>
                    <input aria-label={`New name for ${category.name}`} autoFocus className="input" onChange={(event) => setEditing({ id: category.id, name: event.target.value })} value={editing.name} />
                    <Button aria-label="Save name" disabled={rename.isPending || !editing.name.trim()} onClick={() => rename.mutate(editing)} size="icon" variant="ghost"><Check aria-hidden="true" size={17} /></Button>
                    <Button aria-label="Cancel rename" onClick={() => setEditing(null)} size="icon" variant="ghost"><X aria-hidden="true" size={17} /></Button>
                  </>
                ) : (
                  <>
                    <span><strong>{category.name}</strong><br /><small>{category.product_count} product{category.product_count === 1 ? "" : "s"}</small></span>
                    <Button aria-label={`Rename ${category.name}`} onClick={() => setEditing({ id: category.id, name: category.name })} size="icon" variant="ghost"><Pencil aria-hidden="true" size={16} /></Button>
                    <Button aria-label={`Delete ${category.name}`} disabled={category.product_count > 0} onClick={() => setDeleting(category)} size="icon" title={category.product_count ? "Move its products first" : undefined} variant="ghost"><Trash2 aria-hidden="true" size={16} /></Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        confirmLabel="Delete category"
        description="Products are not affected; the category simply disappears from filters."
        error={remove.error?.message}
        onConfirm={() => { if (deleting) remove.mutate(deleting.id); }}
        onOpenChange={(value) => { if (!value) setDeleting(null); }}
        open={Boolean(deleting)}
        pending={remove.isPending}
        title={`Delete ${deleting?.name ?? "category"}?`}
        tone="danger"
      />
    </>
  );
}
