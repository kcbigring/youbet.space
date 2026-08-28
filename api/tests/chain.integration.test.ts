import { ethers } from "ethers";
import { artifact, hashTerms } from "../src/lib/chain";
import { centsToWei } from "../src/lib/money";

/// Exercises the seam between the API and the deployed contracts: artifact
/// loading, parameter encoding, event decoding and state reads. Runs against a
/// local node when one is up (`npx hardhat node` in contracts/), and is skipped
/// otherwise so CI without a node stays green.

const RPC = process.env.TEST_RPC || "http://127.0.0.1:8545";
// Hardhat's first three deterministic accounts.
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

// cacheTimeout: -1 disables ethers' 250ms RPC cache, which otherwise reuses a
// stale nonce across back-to-back sends on a fast local node.
const provider = new ethers.JsonRpcProvider(RPC, 31337, { cacheTimeout: -1 });

/// Availability is checked inside the test, not at collection time — a
/// describe-time flag would always read its pre-beforeAll value and skip.
///
/// Uses a plain fetch with a hard timeout rather than the provider: ethers
/// retries a dead endpoint with backoff, which hangs the run instead of skipping.
async function nodeIsUp() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Release the provider's polling handles so Jest can exit cleanly.
afterAll(() => provider.destroy());

async function deploy(name: string, signer: ethers.Wallet, args: unknown[] = []) {
  const { abi, bytecode } = artifact(name);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

describe("API to contract integration", () => {
  it("loads every contract artifact the API references", () => {
    for (const name of ["Wager", "WagerFactory", "GroupRegistry", "ResolverRegistry", "Treasury"]) {
      expect(artifact(name).abi.length).toBeGreaterThan(0);
    }
  });

  it("encodes the exact createWager parameters the API sends", () => {
    const iface = new ethers.Interface(artifact("WagerFactory").abi);
    const encoded = iface.encodeFunctionData("createWager", [
      {
        groupId: 0,
        termsHash: ethers.ZeroHash,
        stake: centsToWei(2500),
        bond: centsToWei(100),
        ownerSplitBps: 0,
        attestationThresholdBps: 5000,
        fundingDeadline: 1,
        eventDeadline: 2,
        resolutionDeadline: 3,
        maxParticipants: 2,
        resolutionMethod: 0,
      },
    ]);
    expect(encoded.startsWith("0x")).toBe(true);
  });

  it("produces a stable hash for identical terms", () => {
    const terms = {
      proposition: "Texas beats Ohio State",
      sideLabels: ["Texas wins", "Ohio State wins"],
      stakeCents: 2500,
      bondCents: 100,
      eventDeadline: new Date("2026-09-01T00:00:00Z"),
      resolutionDeadline: new Date("2026-09-04T00:00:00Z"),
      thresholdBps: 5000,
    };
    expect(hashTerms(terms)).toBe(hashTerms({ ...terms }));
    expect(hashTerms(terms)).not.toBe(hashTerms({ ...terms, stakeCents: 5000 }));
  });

  it(
    "runs a wager end to end the way the API drives it",
    async () => {
      if (!(await nodeIsUp())) {
        console.warn(`No node at ${RPC} — run "npx hardhat node" in contracts/ to exercise this.`);
        return;
      }
      // Reset so the test is rerunnable against a long-lived local node.
      await provider.send("hardhat_reset", []);
      const [deployer, alice, bob] = KEYS.map((key) => new ethers.Wallet(key, provider));

      const treasury = await deploy("Treasury", deployer, [deployer.address]);
      const groups = await deploy("GroupRegistry", deployer);
      const resolvers = await deploy("ResolverRegistry", deployer, [deployer.address]);
      const factory = await deploy("WagerFactory", deployer, [
        deployer.address,
        await treasury.getAddress(),
        await groups.getAddress(),
        await resolvers.getAddress(),
        centsToWei(10_000),
        centsToWei(50_000),
      ]);

      // Base the deadlines on chain time, not wall-clock: hardhat_reset rewinds the
      // node's clock and the two drift apart.
      const now = (await provider.getBlock("latest"))!.timestamp;
      const stakeCents = 2500;
      const bondCents = 100;

      // Create, exactly as api/src/routes/wagers.ts does.
      const tx = await (factory.connect(alice) as any).createWager({
        groupId: 0,
        termsHash: hashTerms({
          proposition: "Texas beats Ohio State",
          sideLabels: ["Texas wins", "Ohio State wins"],
          stakeCents,
          bondCents,
          eventDeadline: new Date((now + 60) * 1000),
          resolutionDeadline: new Date((now + 3660) * 1000),
          thresholdBps: 5000,
        }),
        stake: centsToWei(stakeCents),
        bond: centsToWei(bondCents),
        ownerSplitBps: 0,
        attestationThresholdBps: 5000,
        fundingDeadline: now + 50,
        eventDeadline: now + 60,
        resolutionDeadline: now + 3660,
        maxParticipants: 2,
        resolutionMethod: 0,
      });
      const receipt = await tx.wait();

      // Event decoding, as the API does to learn the wager address.
      const created = receipt.logs
        .map((log: any) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: any) => parsed?.name === "WagerCreated");
      const address = created!.args.wager as string;
      expect(ethers.isAddress(address)).toBe(true);

      const wagerAbi = artifact("Wager").abi;
      const value = centsToWei(stakeCents) + centsToWei(bondCents);
      await (await new ethers.Contract(address, wagerAbi, alice).join(0, { value })).wait();
      await (await new ethers.Contract(address, wagerAbi, bob).join(1, { value })).wait();

      // summary() is what readWagerState() reads.
      const locked = await new ethers.Contract(address, wagerAbi, provider).summary();
      expect(Number(locked[0])).toBe(1); // Locked
      expect(Number(locked[2])).toBe(2); // participants
      expect(Number(locked[4])).toBe(2); // a majority of two is two

      // Move past the event deadline and settle by attestation.
      await provider.send("evm_increaseTime", [300]);
      await provider.send("evm_mine", []);

      await (await new ethers.Contract(address, wagerAbi, alice).attest(0)).wait();
      await (await new ethers.Contract(address, wagerAbi, bob).attest(0)).wait();

      const settled = await new ethers.Contract(address, wagerAbi, provider).summary();
      expect(Number(settled[0])).toBe(2); // Settled
      expect(Number(settled[1])).toBe(0); // side 0 won

      // Alice takes the pot minus the 1% fee, plus her bond back.
      const pot = centsToWei(stakeCents) * 2n;
      const fee = (pot * 100n) / 10_000n;
      const credits = await new ethers.Contract(address, wagerAbi, provider).credits(alice.address);
      expect(credits).toBe(pot - fee + centsToWei(bondCents));

      const before = await provider.getBalance(alice.address);
      await (await new ethers.Contract(address, wagerAbi, alice).withdraw()).wait();
      expect(await provider.getBalance(alice.address)).toBeGreaterThan(before);
    },
    120_000
  );
});
