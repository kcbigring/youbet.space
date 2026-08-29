import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/// Drives the real browser paths that typechecking cannot reach: the session
/// guard, SMS sign-in, and the passkey wallet handshake.
///
/// Passkeys are satisfied by Chrome's virtual authenticator over CDP, so no
/// hardware is involved. The final step — creating a Base Account — stops at
/// Coinbase's own email prompt, which cannot be automated; that boundary is
/// asserted rather than skipped, so we notice if their onboarding changes.

async function virtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function signIn(page: Page) {
  const phone = "512555" + String(1000 + Math.floor(Math.random() * 8999));
  await page.goto("/signin", { waitUntil: "networkidle" });
  await page.fill("#phone", phone);
  await page.fill("#name", "E2E Kevin");
  await page.click('button:has-text("Send code")');

  await page.waitForSelector("#code");
  // Development returns the code in the page so the flow needs no real SMS.
  const banner = await page.textContent(".banner.info");
  const code = (banner || "").match(/(\d{6})/)?.[1];
  expect(code, "development sign-in code should be shown").toBeTruthy();

  await page.fill("#code", code!);
  await page.click('button:has-text("Verify")');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"));
  return phone;
}

test("sends signed-out visitors to sign-in and remembers where they were going", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page).toHaveURL(/\/signin\?next=%2Fwallet/);
});

test("signs in with an SMS code and lands on the home feed", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("h1")).toContainText("Hey");
});

test("offers a passkey wallet and opens the Base Account handshake", async ({ page, context }) => {
  const { cdp, authenticatorId } = await virtualAuthenticator(context, page);
  await signIn(page);

  await page.goto("/wallet", { waitUntil: "networkidle" });
  const create = page.locator("button", { hasText: /create your wallet/i });
  await expect(create).toHaveCount(1);

  const popupPromise = context.waitForEvent("page");
  await create.first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");

  // The connector must hand off to Coinbase's key service, not fail silently.
  expect(popup.url()).toContain("keys.coinbase.com");
  await popup.waitForTimeout(4000);
  await expect(popup.locator("body")).toContainText(/Create account|Sign in/i);

  // No passkey exists yet: Coinbase requires an email before the WebAuthn
  // ceremony, which is where automation has to stop.
  const credentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials.credentials).toHaveLength(0);
});

test("Base Account onboarding still demands an email before any passkey", async ({ page, context }) => {
  // This is a funnel fact, not an implementation detail: an invited friend must
  // create a Coinbase account with a verified email before they can take a bet.
  // If Coinbase ever drops that step, this test fails and we should notice.
  await virtualAuthenticator(context, page);
  await signIn(page);
  await page.goto("/wallet", { waitUntil: "networkidle" });

  const popupPromise = context.waitForEvent("page");
  await page.locator("button", { hasText: /create your wallet/i }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.waitForTimeout(4000);

  const createAccount = popup.locator(':text("Create account")');
  await createAccount.first().click();
  await popup.waitForTimeout(6000);

  await expect(popup.locator("body")).toContainText(/email/i);
  await expect(popup.locator('input[type="email"]')).toHaveCount(1);
});
