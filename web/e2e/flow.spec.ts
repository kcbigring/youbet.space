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
const CAROL = process.env.E2E_CAROL as `0x${string}`;

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

/// Moves the chain's clock. Deadlines are the whole mechanism here — when
/// voting opens, when it shuts, when a bond is forfeit — and waiting hours to
/// watch one pass is not a test anyone will run.
async function chainJump(seconds: number) {
  for (const [method, params] of [
    ["evm_increaseTime", [seconds]],
    ["evm_mine", []],
  ] as const) {
    await fetch(process.env.E2E_RPC_URL!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }
}

const chainNow = async () => Number((await chain.getBlock()).timestamp) * 1000;

/// The browser's clock, moved to match. `setFixedTime` leaves real timers
/// running, so polling and transaction waits still work — only `Date.now()`
/// moves, which is all the app reads a deadline against.
async function browserJump(page: Page, to: number) {
  await page.clock.setFixedTime(new Date(to));
  await page.reload({ waitUntil: "networkidle" });
}

/// A `datetime-local` value, in the browser's timezone.
const localInput = (ms: number) =>
  new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/// Creates a wager whose outcome is due shortly, and whose voting window is the
/// shortest the creator can pick.
///
/// The deadline is set from the chain's clock, not the wall clock: earlier
/// tests move the chain forward, and a wager whose funding deadline is already
/// past on-chain cannot be joined at all.
async function createWager(page: Page, text: string, { dueInSeconds = 600, seats = 2 } = {}) {
  const due = (await chainNow()) + dueInSeconds * 1000;

  await page.goto("/create", { waitUntil: "networkidle" });
  await page.fill("textarea", text);
  await page.click('button:has-text("Continue")');
  await page.fill("#deadline", localInput(due));
  await page.selectOption("#voteWindow", "6");
  await page.selectOption("#seats", String(seats));
  await page.click('button:has-text("Send challenge")');
  await page.waitForURL(/\/w\//, { timeout: 120_000 });

  return { url: new URL(page.url()).pathname, id: Number(await read<bigint>("wagerCount")), due };
}

/// Puts money on a side and waits for the escrow to say so.
async function fund(page: Page, id: number, expected: number) {
  const button = page.locator("button", { hasText: /^Back:/ });
  await expect(button.first()).toBeVisible({ timeout: 30_000 });
  await (expected === 1 ? button.first() : button.last()).click();
  await expect
    .poll(async () => (await read<string[]>("getParticipants", [id])).length, { timeout: 120_000 })
    .toBe(expected);
}

/// Hands the invite link to the other player and has them take the other side.
async function bringIn(from: Page, to: Page, id: number) {
  const link = await from.locator(".share-link input").first().inputValue();
  expect(link).toContain("/j/");
  await to.goto(new URL(link).pathname, { waitUntil: "networkidle" });
  await to.click('button:has-text("Take the bet")');
  await to.waitForURL(/\/w\//, { timeout: 60_000 });
  await fund(to, id, 2);
}

/// Two funded players on opposite sides of a fresh wager, with the outcome
/// already due — the state every settlement path starts from.
async function aBetReadyToSettle(alice: Page, bob: Page, text: string) {
  const wager = await createWager(alice, text);
  await fund(alice, wager.id, 1);
  await bringIn(alice, bob, wager.id);

  // Past the outcome, so votes are accepted, but not past the voting window.
  await chainJump(700);
  const now = await chainNow();
  await browserJump(alice, now);
  await browserJump(bob, now);
  return { ...wager, now };
}

/// Makes sure someone has enough to bet with, without insisting they take more.
///
/// The drip only pays once a day, so calling `topUp` again in a later scenario
/// sends a transaction that reverts and a balance that never moves. What each
/// scenario actually needs is a funded player, not a fresh top-up.
async function ensureFunds(page: Page, who: `0x${string}`, minimum = 100) {
  if (usd(await balance(who)) >= minimum) return;
  await topUp(page, who);
}

type Player = Awaited<ReturnType<typeof player>>;

let alice!: Player;
let bob!: Player;
let signedIn = false;

/// The same two people throughout. A wallet belongs to exactly one account —
/// the app refuses to move it, correctly — so a scenario cannot sign in as
/// somebody new and expect to hold the same wallet.
async function players(browser: Browser) {
  if (!signedIn) {
    alice = await player(browser, "Alice", ALICE);
    bob = await player(browser, "Bob", BOB);
    signedIn = true;
  }
  await ensureFunds(alice.page, ALICE);
  await ensureFunds(bob.page, BOB);
  return { alice, bob };
}

test.describe.configure({ mode: "serial" });

test.describe("a bet between two people", () => {
  let wagerUrl: string;
  let wagerId: number;

  test.beforeAll(async ({ browser }) => {
    await players(browser);
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

  // Signing in is where an invited friend arrives with nothing, so the top-up
  // has already run by now. What matters is that it paid the founding bonus
  // rather than the daily trickle.
  test("play money arrives, with the founding bonus on top", async () => {
    expect(usd(await balance(ALICE))).toBeGreaterThan(1_000);
    expect(usd(await balance(BOB))).toBeGreaterThan(1_000);

    // Two accounts have taken a founding slot, and the board says so.
    await alice.page.goto("/wallet", { waitUntil: "networkidle" });
    await expect(alice.page.getByText(/founding spots claimed/i)).toBeVisible();
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

/// Nobody can be stopped from claiming they won, so the question is what
/// happens when both do. Nothing settles, the window shuts, and the stakes go
/// back — with every bond returned, because both of them did turn up.
test.describe("a bet both players claim to have won", () => {
  test.beforeAll(async ({ browser }) => {
    await players(browser);
  });

  test("neither side reaches the threshold, so nothing pays out", async () => {
    const bet = await aBetReadyToSettle(alice.page, bob.page, "$10 that I run five miles");

    for (const page of [alice.page, bob.page]) {
      await page.locator("button", { hasText: /^I won/ }).click();
      await page.locator("button", { hasText: /Yes, I won/ }).click();
      await expect(page.getByText(/waiting on the others/i)).toBeVisible({ timeout: 120_000 });
    }

    // Two people, two contradictory claims, and a threshold of both: deadlock.
    const [status] = [await read<Record<string, unknown>>("getWager", [bet.id])];
    expect(Number((status as { status: number }).status), "still locked").toBe(2);
    expect(await read<bigint>("credits", [ALICE])).toBe(0n);
  });

  test("the window closes and everyone gets their money back", async () => {
    const bet = Number(await read<bigint>("wagerCount"));

    // Past the voting window, which the creator set to six hours.
    await chainJump(6 * 3_600 + 60);
    await browserJump(alice.page, await chainNow());

    await alice.page.locator("button", { hasText: /Close it out/ }).click();

    await expect
      .poll(async () => usd(await read<bigint>("credits", [ALICE])), { timeout: 120_000 })
      .toBeCloseTo(11, 2);
    // Both voted, so neither forfeits: $10 stake and the $1 bond, each.
    expect(usd(await read<bigint>("credits", [BOB]))).toBeCloseTo(11, 2);

    const wager = (await read<{ status: number }>("getWager", [bet])) as { status: number };
    expect(Number(wager.status), "refunded").toBe(4);
  });
});

/// The bond is the only thing making anyone answer, and it had never once been
/// forfeited. One player votes, the other never does, and the silent one's bond
/// goes to the one who turned up.
test.describe("a bet one player never answers", () => {
  test.beforeAll(async ({ browser }) => {
    await players(browser);
  });

  test("the silent player's bond goes to the one who turned up", async () => {
    const before = { alice: await read<bigint>("credits", [ALICE]), bob: await read<bigint>("credits", [BOB]) };
    const bet = await aBetReadyToSettle(alice.page, bob.page, "$10 that I break ninety");

    await alice.page.locator("button", { hasText: /^I won/ }).click();
    await alice.page.locator("button", { hasText: /Yes, I won/ }).click();
    await expect(alice.page.getByText(/waiting on the others/i)).toBeVisible({ timeout: 120_000 });

    // Bob says nothing at all, and the window runs out.
    await chainJump(6 * 3_600 + 60);
    await browserJump(alice.page, await chainNow());
    await alice.page.locator("button", { hasText: /Close it out/ }).click();

    // Stake back for both. Alice also collects her own bond and Bob's, because
    // she answered and he did not.
    await expect
      .poll(async () => usd((await read<bigint>("credits", [ALICE])) - before.alice), { timeout: 120_000 })
      .toBeCloseTo(12, 2);
    expect(usd((await read<bigint>("credits", [BOB])) - before.bob)).toBeCloseTo(10, 2);

    void bet;
  });
});

/// With more than two people the threshold stops meaning "both of you" and
/// starts deciding something: a majority settles it, and whoever could not be
/// bothered to answer pays for the privilege.
test.describe("a bet among three people", () => {
  let carol: Player;

  test.beforeAll(async ({ browser }) => {
    await players(browser);
    carol = await player(browser, "Carol", CAROL);
    await ensureFunds(carol.page, CAROL);
  });

  test("a majority settles it, and the silent player's bond pays for it", async () => {
    // Deltas, not totals: credits are global and these players are carrying
    // balances from earlier scenarios they never withdrew.
    const before = {
      alice: await read<bigint>("credits", [ALICE]),
      bob: await read<bigint>("credits", [BOB]),
      carol: await read<bigint>("credits", [CAROL]),
    };

    const bet = await createWager(alice.page, "$10 that I make it to the gym", { seats: 3 });
    await fund(alice.page, bet.id, 1);

    // The same link brings in as many people as there are seats.
    const link = await alice.page.locator(".share-link input").first().inputValue();
    for (const [who, seat] of [
      [bob, 2],
      [carol, 3],
    ] as const) {
      await who.page.goto(new URL(link).pathname, { waitUntil: "networkidle" });
      await who.page.click('button:has-text("Take the bet")');
      await who.page.waitForURL(/\/w\//, { timeout: 60_000 });
      // Bob opposes; Carol backs Alice, which is what makes a majority possible.
      const side = who === bob ? "last" : "first";
      const button = who.page.locator("button", { hasText: /^Back:/ });
      await expect(button.first()).toBeVisible({ timeout: 30_000 });
      await (side === "first" ? button.first() : button.last()).click();
      await expect
        .poll(async () => (await read<string[]>("getParticipants", [bet.id])).length, {
          timeout: 120_000,
        })
        .toBe(seat);
    }

    await chainJump(700);
    const now = await chainNow();
    for (const who of [alice, bob, carol]) await browserJump(who.page, now);

    // Two of three is the threshold, so the second agreement settles it — no
    // waiting on Bob, who never answers at all.
    for (const who of [alice, carol]) {
      await who.page.locator("button", { hasText: /^I won/ }).click();
      await who.page.locator("button", { hasText: /Yes, I won/ }).click();
    }

    await expect
      .poll(async () => usd((await read<bigint>("credits", [ALICE])) - before.alice), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);

    // $30 pot, 1% fee, split between the two winners: $14.85 each. Both bonds
    // come back, and Bob's forfeited $1 is divided between the two who spoke.
    expect(usd((await read<bigint>("credits", [ALICE])) - before.alice)).toBeCloseTo(16.35, 2);
    expect(usd((await read<bigint>("credits", [CAROL])) - before.carol)).toBeCloseTo(16.35, 2);
    // Bob backed the losing side and never spoke: he gets nothing, and his
    // bond is gone.
    expect(usd((await read<bigint>("credits", [BOB])) - before.bob)).toBe(0);
  });
});

/// Groups are the point of the product — private wagers between friends — and
/// the escrow enforces them rather than taking our word for it: `createWager`
/// asks the registry whether the person opening a group wager is a member, and
/// reads the group's limits from it. So a group that lives only in Postgres
/// cannot hold a wager at all.
test.describe("a group", () => {
  test.beforeAll(async ({ browser }) => {
    await players(browser);
  });

  test("goes on-chain, carries its roster, and holds a wager", async () => {
    await alice.page.goto("/groups", { waitUntil: "networkidle" });
    await alice.page.click('button:has-text("New")');
    await alice.page.fill("#name", "Sunday Golf");
    await alice.page.click('button:has-text("Create group")');

    await alice.page.locator("a", { hasText: "Sunday Golf" }).first().click();
    await alice.page.getByRole("button", { name: "members", exact: true }).click();

    // Bob joins off-chain through the link, exactly as a friend would.
    const link = await alice.page.locator(".share-link input").first().inputValue();
    await bob.page.goto(new URL(link).pathname, { waitUntil: "networkidle" });
    await bob.page.click('button:has-text("Join the group")');
    await bob.page.waitForURL(/\/groups\//, { timeout: 60_000 });

    // The owner mirrors it: create the group, then put everyone on the roster.
    await alice.page.reload({ waitUntil: "networkidle" });
    await alice.page.getByRole("button", { name: "members", exact: true }).click();
    await alice.page.click('button:has-text("Put it on-chain")');
    await expect(alice.page.getByText(/this group is on-chain/i)).toBeVisible({ timeout: 120_000 });

    await alice.page.click('button:has-text("Add everyone to the roster")');
    await expect(alice.page.getByText(/on the roster/i)).toBeVisible({ timeout: 120_000 });

    // Now a wager inside it. The registry check runs on-chain at creation, so
    // this failing means the roster never landed.
    await alice.page.goto("/create", { waitUntil: "networkidle" });
    await alice.page.fill("textarea", "$10 that I break ninety on Sunday");
    await alice.page.click('button:has-text("Continue")');
    await alice.page.selectOption("#group", { label: "Sunday Golf" });
    await alice.page.fill("#deadline", localInput((await chainNow()) + 600_000));
    await alice.page.click('button:has-text("Send challenge")');
    await alice.page.waitForURL(/\/w\//, { timeout: 120_000 });

    const id = Number(await read<bigint>("wagerCount"));
    const wager = (await read<{ groupId: bigint }>("getWager", [id])) as { groupId: bigint };
    expect(Number(wager.groupId), "the wager carries a real group id").toBeGreaterThan(0);
  });
});
