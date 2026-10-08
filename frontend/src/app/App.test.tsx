import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { WorkspacePage } from "../routes/WorkspacePage";
import { useUIStore } from "../stores/uiStore";

function renderShell(path = "/products") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<WorkspacePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("application shell", () => {
  beforeEach(() => {
    useUIStore.setState({ commandOpen: false, sidebarCollapsed: false });
  });

  it("renders contextual route content and navigation", () => {
    renderShell("/inventory");

    expect(screen.getByRole("heading", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
  });

  it("marks the current route active", () => {
    renderShell("/products");

    const productLinks = screen.getAllByRole("link", { name: "Products" });
    expect(productLinks[0]).toHaveClass("active");
  });

  it("opens the command palette with the keyboard shortcut and closes with escape", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search products/i)).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes the preview state without losing the page", () => {
    renderShell("/orders");

    fireEvent.click(screen.getByRole("tab", { name: "offline" }));
    expect(screen.getByRole("heading", { name: "Working offline" })).toBeInTheDocument();
    expect(screen.getByText("2 changes waiting")).toBeInTheDocument();
  });
});

