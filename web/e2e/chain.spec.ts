import { test, expect } from "@playwright/test";

/// Contract reads have to reach the chain the app is deployed against.
///
/// wagmi resolves a read with no explicit chain to the config's *current* one,
/// which before any wallet connects is simply the first entry in `chains`. That
/// list used to start with Sepolia, so a mainnet deployment read balances and
/// founding slots from a testnet where the contracts do not exist — every read
/// returned nothing and the UI rendered blank rather than wrong, which is why
/// it survived so long. Nothing in typechecking can see this.

const RPC_HOSTS: Record<number, string> = {
  8453: "mainnet.base.org",
  84532: "sepolia.base.org",
};

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 84532);

test("reads contracts from the configured chain and no other", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (req) => {
    const host = new URL(req.url()).host;
    if (Object.values(RPC_HOSTS).includes(host)) hosts.add(host);
  });

  // The landing page reads the founding-slot counters with no wallet attached,
  // which makes it the cheapest place to observe where reads go.
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  expect([...hosts], "no contract read reached the wrong network").toEqual(
    hosts.size ? [RPC_HOSTS[chainId]] : []
  );
});

test("shows the founding slots, which only render once a read succeeds", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  // `FoundingSlots` renders null until `claimed` comes back, so its presence is
  // proof the read resolved against a chain that actually has the token.
  await expect(page.locator(".slots")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(".slots")).toContainText(/founding spots/i);
});
