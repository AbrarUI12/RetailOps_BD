import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { PlaceholderPage } from "../routes/PlaceholderPage";

describe("application foundation", () => {
  it("renders route content", () => {
    render(<PlaceholderPage title="Inventory" />);

    expect(screen.getByRole("heading", { name: "Inventory" })).toBeInTheDocument();
  });

  it("provides primary navigation", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/pos");
  });
});

