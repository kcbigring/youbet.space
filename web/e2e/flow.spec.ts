import { test, expect, type Browser, type Page } from "@playwright/test";
import { createPublicClient, http, formatUnits } from "viem";
import { foundry } from "viem/chains";
import { wagerBookAbi, playDollarAbi } from "../lib/abi";

/// The whole loop, in a browser, against a real chain: two people sign in, make
/// wallets, take play money, agree a bet, fund opposite sides of it, settle it
/// and collect.
///
/// This is the test that would have caught most of what shipped broken. Every
/// one of those bugs lived in a seam — a payload shape, a chain list order, an
/// env var name, a component unmounted by the event it was meant to report —
/// and seams are invisible until the pieces are actually joined.
///
/// The one thing not covered is Coinbase's own onboarding, which demands a
/// verified email before it will mint a passkey. wagmi's mock connector stands
/// in: it answers `wallet_sendCalls` by forwarding each call to the node, so
/// the batching, the waiting and the reconciling all run for real.

const BOOK = process.env.E2E_WAGER_BOOK as `0x${string}`;
const TOKEN = process.env.E2E_STAKE_TOKEN as `0x${string}`;
const ALICE = process.env.E2E_ALICE as `0x${string}`;
const BOB = process.env.E2E_BOB as `0x${string}`;

const chain = createPublicClient({ chain: foundry, transport: http(process.env.E2E_RPC_URL) });

const read = <T,>(functionName: string, args: unknown[] = []): Promise<T> =>
  chain.readContract({ address: BOOK, abi: wagerBookAbi, functionName, args } as never) as Promise<T>;

const balance = (who: `0x${string}`) =>
  chain.readContract({
    address: TOKEN,
    abi: playDollarAbi,
    functionName: "balanceOf",
    args: [who],
  } as never) as Promise<bigint>;

const usd = (v: bigint) => Number(formatUnits(v, 6));

/// A browser holding one person's session and one person's wallet.
async function player(browser: Browser, name: string, account: `0x${string}`) {
  const context = await browser.newContext();
  // Set before any page script runs, so the wallet is this person's from the
  // first render rather than after a reload.
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    ["youbet.e2e.account", account]
  );
  const page = await context.newPage();

  const phone = "512555" + String(1000 + Math.floor(Math.random() * 8999));
  await page.goto("/signin", { waitUntil: "networkidle" });
  await page.fill("#phone", phone);
  await page.fill("#name", name);
  await page.click('button:has-text("Send code")');
  await page.waitForSelector("#code");

  // Without Firebase configured the API returns the code in the page, which is
  // what makes an unattended sign-in possible at all.
  const code = ((await page.textContent(".banner.info")) || "").match(/(\d{6})/)?.[1];
  expect(code, "the API should surface a development sign-in code").toBeTruthy();
  await page.fill("#code", code!);
  await page.click('button:has-text("Verify")');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"));

  await page.goto("/wallet", { waitUntil: "networkidle" });
  const connect = page.locator("button", { hasText: /create your wallet/i });
  if (await connect.count()) await connect.first().click();
  await expect(page.getByText(account, { exact: false })).toBeVisible({ timeout: 30_000 });

  return { page, phone, account };
}

/// Takes the daily play money. A missing button is a failure, not a skip: an
/// invited friend arrives with nothing, so this is the only way they can bet.
///
/// The assertion is on the token, not on the confirmation: the wallet page
/// reloads itself once the money lands, which takes the banner with it.
async function topUp(page: Page, who: `0x${string}`) {
  const before = await balance(who);
  await page.goto("/wallet", { waitUntil: "networkidle" });
  const button = page.locator("button", { hasText: /to play with|get play money/i });
  await expect(button.first()).toBeVisible({ timeout: 30_000 });
  await button.first().click();
  await expect.poll(() => balance(who), { timeout: 120_000 }).toBeGreaterThan(before);
}

test.describe.configure({ mode: "serial" });

test.describe("a bet between two people", () => {
  let alice: Awaited<ReturnType<typeof player>>;
  let bob: Awaited<ReturnType<typeof player>>;
  let wagerUrl: string;
  let wagerId: number;

  test.beforeAll(async ({ browser }) => {
    alice = await player(browser, "Alice", ALICE);
    bob = await player(browser, "Bob", BOB);
  });

  test.afterAll(async () => {
    await alice?.page.context().close();
    await bob?.page.context().close();
  });

  // The address is how on-chain activity maps back to a person. It once was
  // never recorded at all, and the funded player showed as merely invited.
  test("each wallet is recorded against the person who connected it", async () => {
    for (const who of [alice, bob]) {
      const token = await who.page.evaluate(() => localStorage.getItem("youbet.session"));
      const res = await who.page.request.get(`${process.env.E2E_API_URL}/users/me/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.ok()).toBeTruthy();
      expect((await res.json()).wallet?.address?.toLowerCase()).toBe(who.account.toLowerCase());
    }
  });

  test("play money arrives, with the founding bonus on top", async () => {
    const before = await balance(ALICE);
    await topUp(alice.page, ALICE);
    await topUp(bob.page, BOB);

    // The first hundred accounts get a founding bonus on top of the top-up.
    expect(usd((await balance(ALICE)) - before)).toBeGreaterThan(1_000);
    expect(usd(await balance(BOB))).toBeGreaterThan(1_000);
  });

  test("a challenge is created, and the deadline is the one that was said", async () => {
    const before = await read<bigint>("wagerCount");

    await alice.page.goto("/create", { waitUntil: "networkidle" });
    await alice.page.fill("textarea", "$10 that it rains before 6am tomorrow");
    await alice.page.click('button:has-text("Continue")');

    // The parser has to hear the clock time, not only the day.
    expect(await alice.page.inputValue("#deadline"), "6am should survive the parse").toContain("06:00");

    await alice.page.click('button:has-text("Send challenge")');
    await alice.page.waitForURL(/\/w\//, { timeout: 120_000 });

    wagerUrl = new URL(alice.page.url()).pathname;
    wagerId = Number(await read<bigint>("wagerCount"));
    expect(BigInt(wagerId)).toBe(before + 1n);
  });

  // Joining is an approve and a join in one batch across two contracts — the
  // only flow that spans both, and the only one a half-filled paymaster
  // allowlist would break.
  test("the creator funds their side", async () => {
    await alice.page.locator("button", { hasText: /^Back:/ }).first().click();
    await expect
      .poll(async () => (await read<string[]>("getParticipants", [wagerId])).length, {
        timeout: 120_000,
      })
      .toBe(1);
  });

  test("the invite link brings the other player in, and the wager locks", async () => {
    const link = await alice.page.locator(".share-link input").first().inputValue();
    expect(link).toContain("/j/");

    await bob.page.goto(new URL(link).pathname, { waitUntil: "networkidle" });
    await bob.page.click('button:has-text("Take the bet")');
    await bob.page.waitForURL(/\/w\//, { timeout: 60_000 });

    await bob.page.locator("button", { hasText: /^Back:/ }).last().click();
    await expect
      .poll(async () => (await read<string[]>("getParticipants", [wagerId])).length, {
        timeout: 120_000,
      })
      .toBe(2);
  });

  // Conceding settles at once and returns every bond, because nobody disputed
  // it. The loser is still owed that bond, which is why the claim button has to
  // say the number rather than call it winnings.
  test("the loser concedes, and the money lands where it should", async () => {
    const aliceBefore = await balance(ALICE);
    const bobBefore = await balance(BOB);

    await bob.page.reload({ waitUntil: "networkidle" });
    await bob.page.locator("button", { hasText: /I (lost|give up)/ }).first().click();
    await bob.page.locator("button", { hasText: /Yes, pay them/ }).click();

    await expect
      .poll(async () => usd(await read<bigint>("credits", [ALICE])), { timeout: 120_000 })
      .toBeGreaterThan(0);

    // $20 pot, 1% fee, and a bond back for each of them.
    expect(usd(await read<bigint>("credits", [ALICE]))).toBeCloseTo(20.8, 2);
    expect(usd(await read<bigint>("credits", [BOB]))).toBeCloseTo(1, 2);

    await alice.page.goto(wagerUrl, { waitUntil: "networkidle" });
    await alice.page.locator("button", { hasText: /^Claim \$/ }).click();
    await expect
      .poll(async () => usd((await balance(ALICE)) - aliceBefore), { timeout: 120_000 })
      .toBeCloseTo(20.8, 2);

    await bob.page.reload({ waitUntil: "networkidle" });
    await bob.page.locator("button", { hasText: /^Claim \$/ }).click();
    await expect
      .poll(async () => usd((await balance(BOB)) - bobBefore), { timeout: 120_000 })
      .toBeCloseTo(1, 2);
  });
});
