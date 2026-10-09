import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, LogOut, ShieldOff } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api";
import { initials, label } from "../../lib/format";
import { toast } from "../../lib/toast";
import { useAuthStore } from "../../stores/authStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export function ProfileMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [pending, setPending] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  if (!user) return null;

  async function signOutEverywhere() {
    setPending(true);
    try {
      await api<void>("/api/v1/auth/logout-all", { method: "POST" });
      toast.success("Signed out on every device");
    } catch {
      toast.error("Could not reach the server", "You were signed out on this device only.");
    } finally {
      setPending(false);
      setConfirmEverywhere(false);
      await logout();
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label={`Account menu for ${user.full_name}`} className="profile-button" type="button">
            <span aria-hidden="true" className="avatar">{initials(user.full_name)}</span>
            <span>
              <strong>{user.full_name}</strong>
              <small>{label(user.role)} · {user.branch_name}</small>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" className="menu-content" sideOffset={8}>
            <DropdownMenu.Label className="menu-label">
              Signed in as <strong>{user.email}</strong>
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" onSelect={() => setChangingPassword(true)}>
              <KeyRound aria-hidden="true" size={16} /> Change password
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" onSelect={() => void logout()}>
              <LogOut aria-hidden="true" size={16} /> Sign out
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => setConfirmEverywhere(true)}>
              <ShieldOff aria-hidden="true" size={16} /> Sign out on all devices
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ChangePasswordDialog onOpenChange={setChangingPassword} open={changingPassword} />
      <ConfirmDialog
        confirmLabel="Sign out everywhere"
        description="Every phone, tablet and computer signed in as you will need to sign in again. Unsynced sales stay on their devices."
        onConfirm={() => void signOutEverywhere()}
        onOpenChange={setConfirmEverywhere}
        open={confirmEverywhere}
        pending={pending}
        title="Sign out on all devices?"
        tone="danger"
      />
    </>
  );
}
