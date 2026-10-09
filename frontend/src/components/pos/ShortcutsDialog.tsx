import { POS_SHORTCUTS } from "../../lib/shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";

/** Shortcuts documented inside the app (plan §13). */
export function ShortcutsDialog({ onOpenChange, open }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Barcode scanners work like a keyboard: scan, and the item is added.</DialogDescription>
        </DialogHeader>
        <dl className="shortcut-list">
          {POS_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys}>
              <dt><kbd>{shortcut.keys}</kbd></dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
