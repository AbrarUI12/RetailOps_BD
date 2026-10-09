import { expect, test } from "@playwright/test";

test("sign-in stays keyboard-first and stable on tablet and mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of [
    { width: 900, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in securely" })).toBeFocused();

  const reducedDuration = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.animation = "fade-in 1s linear";
    document.body.append(probe);
    const duration = Number.parseFloat(getComputedStyle(probe).animationDuration) || 0;
    probe.remove();
    return duration;
  });
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
});

test("slow authentication keeps an explicit busy and recoverable error state", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect", details: {} },
      }),
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();

  await expect(page.getByRole("button", { name: "Signing in…" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect");
  await expect(page.getByRole("button", { name: "Sign in securely" })).toBeEnabled();
});
