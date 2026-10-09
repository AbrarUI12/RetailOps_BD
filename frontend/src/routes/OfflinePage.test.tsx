import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { expectNoAxeViolations } from "../test/axe";
import { OfflinePage } from "./OfflinePage";

it("offers an offline-safe route back to the cached POS", async () => {
  const { container } = render(
    <MemoryRouter>
      <OfflinePage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "You’re offline" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open POS" })).toHaveAttribute(
    "href",
    "/pos",
  );
  await expectNoAxeViolations(container);
});
