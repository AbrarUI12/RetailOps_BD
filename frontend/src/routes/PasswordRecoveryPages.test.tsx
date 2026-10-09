import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { passwordProblems } from "../lib/passwordPolicy";
import { ForgotPasswordPage, ResetPasswordPage } from "./PasswordRecoveryPages";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("password recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches the server password policy", () => {
    expect(passwordProblems("short1")).toEqual(["Use at least 10 characters"]);
    expect(passwordProblems("onlyletterslong")).toEqual(["Mix letters and numbers"]);
    expect(passwordProblems("Fresh-start-2026")).toEqual([]);
  });

  it("confirms a reset request without revealing whether the account exists", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: "ok" }), { status: 202 }))));
    renderAt("/forgot-password");

    await userEvent.type(screen.getByLabelText("Email address"), "owner@retailopsbd.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("If owner@retailopsbd.com has an account");
  });

  it("validates the new password before sending and returns to sign in", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/reset-password?token=abcdefghijklmnopqrstuvwxyz");
    const submit = screen.getByRole("button", { name: "Set new password" });

    await userEvent.type(screen.getByLabelText("New password"), "short");
    expect(screen.getByText("Use at least 10 characters")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "Fresh-start-2026");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "Fresh-start-2026");
    await userEvent.click(submit);

    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
