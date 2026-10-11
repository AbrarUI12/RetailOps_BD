import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  LoaderCircle,
  MapPin,
  Pencil,
  Save,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/Dialog";
import { SelectField, TextareaField } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { Tabs } from "../components/ui/Tabs";
import {
  ApiError,
  api,
  type BranchSettings,
  type OrganizationSettings,
  type StaffMember,
  type WorkspaceSettings,
} from "../lib/api";
import { can } from "../lib/permissions";
import { passwordProblems } from "../lib/passwordPolicy";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";

type SettingsTab = "business" | "branch" | "team";
type StaffRole = StaffMember["role"];
const ROLES: StaffRole[] = ["OWNER", "MANAGER", "CASHIER", "SUPPORT", "WAREHOUSE"];

const roleLabels: Record<StaffRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  SUPPORT: "Support",
  WAREHOUSE: "Warehouse",
};

function errorMessage(reason: unknown) {
  return reason instanceof ApiError ? reason.message : "Please try again.";
}

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const hasStaffAccess = can(user, "staff:manage");
  const [tab, setTab] = useState<SettingsTab>("business");
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<WorkspaceSettings>("/api/v1/settings"),
  });
  const staff = useQuery({
    queryKey: ["settings", "staff"],
    queryFn: () => api<StaffMember[]>("/api/v1/settings/staff"),
    enabled: hasStaffAccess,
  });

  return (
    <PageTransition>
      <FadeUp>
        <PageHeader
          description="Keep your business identity, branch details and team access accurate."
          eyebrow="Workspace"
          title="Settings"
        />
      </FadeUp>
      <DataState
        empty={{ icon: Building2, title: "Workspace unavailable", description: "No workspace settings were returned." }}
        query={settings}
        skeleton="page"
      >
        {(data) => {
          const tabs = [
            {
              value: "business" as const,
              label: "Business",
              content: <BusinessSettings key={`${data.organization.id}:${data.organization.name}`} organization={data.organization} />,
            },
            {
              value: "branch" as const,
              label: "Branch",
              content: <BranchSettingsForm key={`${data.current_branch.id}:${data.current_branch.name}:${data.current_branch.code}:${data.current_branch.address}`} branch={data.current_branch} />,
            },
            ...(hasStaffAccess
              ? [
                  {
                    value: "team" as const,
                    label: `Team${staff.data ? ` · ${staff.data.length}` : ""}`,
                    content: (
                      <TeamSettings
                        branches={data.branches}
                        currentUserId={user?.id ?? ""}
                        query={staff}
                      />
                    ),
                  },
                ]
              : []),
          ];
          return (
            <FadeUp delay={0.04}>
              <div className="settings-overview" aria-label="Workspace summary">
                <Summary icon={Building2} label="Organization" value={data.organization.name} />
                <Summary icon={MapPin} label="Current branch" value={data.current_branch.name} />
                <Summary
                  icon={ShieldCheck}
                  label="Your access"
                  value={user?.role ? roleLabels[user.role as StaffRole] ?? user.role : "—"}
                />
              </div>
              <Tabs
                className="settings-tabs"
                label="Settings areas"
                onChange={setTab}
                tabs={tabs}
                value={tab}
              />
            </FadeUp>
          );
        }}
      </DataState>
    </PageTransition>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <Card className="settings-summary-card">
      <span className="settings-summary-icon"><Icon aria-hidden="true" size={20} /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </Card>
  );
}

function BusinessSettings({ organization }: { organization: OrganizationSettings }) {
  const queryClient = useQueryClient();
  const refresh = useAuthStore((state) => state.refresh);
  const [name, setName] = useState(organization.name);
  const mutation = useMutation({
    mutationFn: () => api<OrganizationSettings>("/api/v1/settings/organization", {
      method: "PATCH",
      body: JSON.stringify({ name, timezone: "Asia/Dhaka" }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await refresh();
      toast.success("Business settings saved", "The updated name is now used across the workspace.");
    },
    onError: (reason) => toast.error("Could not save business settings", errorMessage(reason)),
  });
  const changed = name.trim() !== organization.name;
  return (
    <Card className="settings-card">
      <CardHeader>
        <div><CardTitle>Business identity</CardTitle><CardDescription>Shown in the workspace, reports and customer receipts.</CardDescription></div>
        <Badge tone="brand">Organization</Badge>
      </CardHeader>
      <CardContent>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <Input label="Business name" maxLength={160} onChange={(event) => setName(event.target.value)} required value={name} />
          <Input disabled hint="The public workspace identifier stays stable." label="Workspace slug" readOnly value={organization.slug} />
          <SelectField disabled hint="All business dates, reports and receipts use Bangladesh time." label="Business timezone" value={organization.timezone}>
            <option value="Asia/Dhaka">Asia/Dhaka (UTC+6)</option>
          </SelectField>
          <div className="settings-note full"><ShieldCheck aria-hidden="true" size={18} /><span><strong>Safe workspace change</strong><small>Historical sales and audit records keep their original identity and timestamps.</small></span></div>
          <div className="form-actions full">
            <Button disabled={!changed || !name.trim() || mutation.isPending} type="submit">
              {mutation.isPending ? <LoaderCircle className="spinner" size={17} /> : <Save size={17} />} Save business
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function BranchSettingsForm({ branch }: { branch: BranchSettings }) {
  const queryClient = useQueryClient();
  const refresh = useAuthStore((state) => state.refresh);
  const [form, setForm] = useState({ name: branch.name, code: branch.code, address: branch.address ?? "" });
  const mutation = useMutation({
    mutationFn: () => api<BranchSettings>(`/api/v1/settings/branches/${branch.id}`, {
      method: "PATCH",
      body: JSON.stringify(form),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await refresh();
      toast.success("Branch settings saved", "POS receipts now use these branch details.");
    },
    onError: (reason) => toast.error("Could not save branch settings", errorMessage(reason)),
  });
  const changed = form.name !== branch.name || form.code !== branch.code || form.address !== (branch.address ?? "");
  return (
    <Card className="settings-card">
      <CardHeader>
        <div><CardTitle>Branch profile</CardTitle><CardDescription>Operational identity for sales, stock and printed receipts.</CardDescription></div>
        <Badge tone="info">Current branch</Badge>
      </CardHeader>
      <CardContent>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <Input label="Branch name" maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <Input label="Branch code" maxLength={24} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} pattern={"[A-Za-z0-9_\\-]+"} required value={form.code} />
          <TextareaField className="full" hint="Printed on the 80mm receipt beneath the organization name." label="Receipt address" maxLength={500} onChange={(event) => setForm({ ...form, address: event.target.value })} value={form.address} />
          <div className="form-actions full">
            <Button disabled={!changed || !form.name.trim() || !form.code.trim() || mutation.isPending} type="submit">
              {mutation.isPending ? <LoaderCircle className="spinner" size={17} /> : <Save size={17} />} Save branch
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TeamSettings({ branches, currentUserId, query }: { branches: BranchSettings[]; currentUserId: string; query: ReturnType<typeof useQuery<StaffMember[], Error>> }) {
  const [dialog, setDialog] = useState<StaffMember | "new" | null>(null);
  const columns = useMemo<Column<StaffMember>[]>(() => [
    { key: "person", header: "Team member", primary: true, cell: (member) => <span className="staff-person"><span className="staff-avatar">{member.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{member.full_name}{member.id === currentUserId ? " (you)" : ""}</strong><small>{member.email}</small></span></span> },
    { key: "role", header: "Role", cell: (member) => <Badge tone={member.role === "OWNER" ? "brand" : "neutral"}>{roleLabels[member.role]}</Badge> },
    { key: "branch", header: "Branch", cell: (member) => member.branch_name },
    { key: "status", header: "Status", trailing: true, cell: (member) => <Badge tone={member.is_active ? "success" : "danger"}>{member.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", header: "", cardFooter: true, cell: (member) => <Button aria-label={`Edit ${member.full_name}`} onClick={() => setDialog(member)} size="sm" type="button" variant="secondary"><Pencil size={15} /> Edit</Button> },
  ], [currentUserId]);
  return (
    <Card className="settings-card team-card">
      <CardHeader>
        <div><CardTitle>Team access</CardTitle><CardDescription>Create accounts and keep every role scoped to the right branch.</CardDescription></div>
        <Button onClick={() => setDialog("new")} size="sm" type="button"><UserPlus size={16} /> Add team member</Button>
      </CardHeader>
      <CardContent>
        <DataState empty={{ icon: Users, title: "No team members", description: "Add the first person who will work in this workspace." }} query={query}>
          {(members) => <ResponsiveTable caption="Workspace team" columns={columns} rowKey={(member) => member.id} rows={members} />}
        </DataState>
      </CardContent>
      {dialog ? <StaffDialog branches={branches} currentUserId={currentUserId} key={dialog === "new" ? "new" : dialog.id} member={dialog} onOpenChange={(open) => { if (!open) setDialog(null); }} /> : null}
    </Card>
  );
}

function StaffDialog({ branches, currentUserId, member, onOpenChange }: { branches: BranchSettings[]; currentUserId: string; member: StaffMember | "new"; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const editing = member && member !== "new" ? member : null;
  const [form, setForm] = useState(editing ? { full_name: editing.full_name, email: editing.email, role: editing.role, branch_id: editing.branch_id, initial_password: "", is_active: editing.is_active } : { full_name: "", email: "", role: "CASHIER" as StaffRole, branch_id: branches[0]?.id ?? "", initial_password: "", is_active: true });
  const passwordIssues = member === "new" && form.initial_password ? passwordProblems(form.initial_password) : [];
  const mutation = useMutation({
    mutationFn: () => editing
      ? api<StaffMember>(`/api/v1/settings/staff/${editing.id}`, { method: "PATCH", body: JSON.stringify({ full_name: form.full_name, role: form.role, branch_id: form.branch_id, is_active: form.is_active }) })
      : api<StaffMember>("/api/v1/settings/staff", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "staff"] });
      toast.success(editing ? "Team member updated" : "Team member added", `${saved.full_name} can ${saved.is_active ? "access" : "no longer access"} this workspace.`);
      onOpenChange(false);
    },
    onError: (reason) => toast.error(editing ? "Could not update team member" : "Could not add team member", errorMessage(reason)),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (passwordIssues.length) return;
    mutation.mutate();
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={member !== null}>
      <DialogContent aria-describedby="staff-dialog-description" className="staff-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit team member" : "Add team member"}</DialogTitle>
          <DialogDescription id="staff-dialog-description">{editing ? "Update role, branch or account access." : "Create a secure account with an initial password."}</DialogDescription>
        </DialogHeader>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Full name" maxLength={120} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required value={form.full_name} />
          <Input disabled={Boolean(editing)} label="Email address" onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} />
          <SelectField disabled={editing?.id === currentUserId} label="Role" onChange={(event) => setForm({ ...form, role: event.target.value as StaffRole })} value={form.role}>
            {ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </SelectField>
          <SelectField label="Branch" onChange={(event) => setForm({ ...form, branch_id: event.target.value })} value={form.branch_id}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </SelectField>
          {!editing ? <Input className="full" error={passwordIssues[0]} hint="At least 10 characters with letters and numbers." label="Initial password" onChange={(event) => setForm({ ...form, initial_password: event.target.value })} required type="password" value={form.initial_password} /> : null}
          {editing ? <SelectField className="full" disabled={editing.id === currentUserId} hint={editing.id === currentUserId ? "You cannot deactivate your own account." : "Deactivation immediately revokes active sessions."} label="Account status" onChange={(event) => setForm({ ...form, is_active: event.target.value === "active" })} value={form.is_active ? "active" : "inactive"}><option value="active">Active</option><option value="inactive">Inactive</option></SelectField> : null}
          {mutation.isError ? <div className="form-alert full" role="alert">{errorMessage(mutation.error)}</div> : null}
          <div className="form-actions full">
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">Cancel</Button>
            <Button disabled={mutation.isPending || !form.full_name.trim() || !form.branch_id || (!editing && (!form.email || !form.initial_password || passwordIssues.length > 0))} type="submit">
              {mutation.isPending ? <LoaderCircle className="spinner" size={17} /> : editing ? <Save size={17} /> : <UserPlus size={17} />} {editing ? "Save member" : "Create account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
