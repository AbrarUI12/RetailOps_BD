import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PackageOpen } from "lucide-react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Input } from "./Input";
import { StatusDot } from "./StatusDot";

describe("design system primitives", () => {
  it("renders semantic variants", () => {
    render(
      <>
        <Button variant="danger">Delete</Button>
        <Badge tone="warning">Needs review</Badge>
        <StatusDot label="Online" tone="online" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("button-danger");
    expect(screen.getByText("Needs review")).toHaveClass("badge-warning");
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("connects input errors to the control", async () => {
    const user = userEvent.setup();
    render(<Input error="SKU is required" label="SKU" name="sku" />);

    const input = screen.getByRole("textbox", { name: "SKU" });
    await user.click(input);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("SKU is required");
  });

  it("exposes empty-state actions", async () => {
    const user = userEvent.setup();
    let invoked = false;
    render(
      <EmptyState
        action="Add product"
        description="Begin your catalog."
        icon={PackageOpen}
        onAction={() => { invoked = true; }}
        title="No products"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(invoked).toBe(true);
  });
});

