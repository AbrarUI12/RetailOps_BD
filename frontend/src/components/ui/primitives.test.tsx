import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackageOpen } from "lucide-react";
import { useState } from "react";

import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import { expectNoAxeViolations } from "../../test/axe";
import { ConfirmDialog } from "./ConfirmDialog";
import { DataState } from "./DataState";
import { ResponsiveTable, type Column } from "./ResponsiveTable";
import { SegmentedControl } from "./SegmentedControl";
import { Toaster } from "./Toast";

type Query<T> = Parameters<typeof DataState<T>>[0]["query"];

function query<T>(overrides: Partial<Query<T>>): Query<T> {
  return { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn(), ...overrides };
}

const empty = { icon: PackageOpen, title: "No products yet", description: "Add your first product to start selling." };

describe("DataState", () => {
  it("shows a loading skeleton rather than an empty state while pending", () => {
    render(<DataState empty={empty} query={query<string[]>({ isPending: true })}>{() => "content"}</DataState>);

    expect(screen.getByRole("status", { name: "Loading…" })).toBeInTheDocument();
    expect(screen.queryByText("No products yet")).not.toBeInTheDocument();
  });

  it("offers a retry on errors", async () => {
    const refetch = vi.fn();
    render(<DataState empty={empty} query={query<string[]>({ isError: true, error: new ApiError("Server is down", 503), refetch })}>{() => "content"}</DataState>);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Server is down");
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("explains a permission denial", () => {
    render(<DataState empty={empty} query={query<string[]>({ isError: true, error: new ApiError("Forbidden", 403) })}>{() => "content"}</DataState>);

    expect(screen.getByText("You don't have access")).toBeInTheDocument();
  });

  it("renders the empty state and the content", async () => {
    const { container, rerender } = render(<DataState empty={empty} query={query<string[]>({ data: [] })}>{(rows) => rows.join()}</DataState>);
    expect(screen.getByText("No products yet")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    rerender(<DataState empty={empty} query={query<string[]>({ data: ["Panjabi"] })}>{(rows) => rows.join()}</DataState>);
    expect(await screen.findByText("Panjabi")).toBeInTheDocument();
  });
});

interface Row { id: string; name: string; total: string }
const columns: Column<Row>[] = [
  { key: "name", header: "Product", primary: true, cell: (row) => row.name },
  { key: "total", header: "Total", numeric: true, trailing: true, cell: (row) => row.total },
];

describe("ResponsiveTable", () => {
  it("renders a table and mobile cards with keyboard-openable rows", async () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <ResponsiveTable caption="Products" columns={columns} onRowClick={onRowClick} rowKey={(row) => row.id} rowLabel={(row) => `Open ${row.name}`} rows={[{ id: "1", name: "Panjabi", total: "৳2,490" }]} />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Products" })).toBeInTheDocument();
    const [tableRow, mobileRow] = screen.getAllByRole("button", { name: "Open Panjabi" });
    tableRow.focus();
    await userEvent.keyboard("{Enter}");
    mobileRow.focus();
    await userEvent.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenCalledWith({ id: "1", name: "Panjabi", total: "৳2,490" });
    await expectNoAxeViolations(container);
  });
});

describe("ConfirmDialog", () => {
  function Harness({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(true);
    return <ConfirmDialog confirmLabel="Receive stock" description="Adds 12 units to inventory." onConfirm={onConfirm} onOpenChange={setOpen} open={open} title="Receive purchase PO-1001?" />;
  }

  it("confirms or cancels an irreversible action", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const dialog = screen.getByRole("alertdialog", { name: "Receive purchase PO-1001?" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Receive stock" }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("SegmentedControl", () => {
  it("marks the selected option as pressed", async () => {
    function Harness() {
      const [value, setValue] = useState<"today" | "week">("today");
      return <SegmentedControl label="Timeframe" onChange={setValue} options={[{ value: "today", label: "Today" }, { value: "week", label: "7 days" }]} value={value} />;
    }
    const { container } = render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "7 days" }));

    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
    await expectNoAxeViolations(container);
  });
});

describe("Toaster", () => {
  it("announces success feedback", async () => {
    render(<Toaster />);

    act(() => toast.success("Sale complete", "POS-0001 · ৳2,490"));

    expect(await screen.findByText("Sale complete")).toBeInTheDocument();
    expect(screen.getByText("POS-0001 · ৳2,490")).toBeInTheDocument();
  });
});
