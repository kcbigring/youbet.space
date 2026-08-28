const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BPS = 10_000n;
const STAKE = ethers.parseEther("0.025"); // "$25 each"
const BOND = ethers.parseEther("0.001"); // "$1 resolution bond"
const DAY = 24 * 60 * 60;

const Resolution = { Attestation: 0, Oracle: 1 };
const Status = { Open: 0, Locked: 1, Settled: 2, Refunded: 3, Cancelled: 4 };

async function deployStack() {
  const [deployer, alice, bob, carol, dave, treasuryOwner, oracle] = await ethers.getSigners();

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(treasuryOwner.address);

  const GroupRegistry = await ethers.getContractFactory("GroupRegistry");
  const groups = await GroupRegistry.deploy();

  const ResolverRegistry = await ethers.getContractFactory("ResolverRegistry");
  const resolvers = await ResolverRegistry.deploy(deployer.address);
  await resolvers.setResolver(oracle.address, true, "test-sports-feed");

  const WagerFactory = await ethers.getContractFactory("WagerFactory");
  const factory = await WagerFactory.deploy(
    deployer.address,
    await treasury.getAddress(),
    await groups.getAddress(),
    await resolvers.getAddress(),
    ethers.parseEther("0.1"), // max stake per person
    ethers.parseEther("0.5") // max pot
  );

  return { deployer, alice, bob, carol, dave, treasuryOwner, oracle, treasury, groups, resolvers, factory };
}

async function defaultParams(overrides = {}) {
  const now = await time.latest();
  return {
    groupId: 0,
    termsHash: ethers.keccak256(ethers.toUtf8Bytes("Texas beats Ohio State")),
    stake: STAKE,
    bond: BOND,
    ownerSplitBps: 0,
    attestationThresholdBps: 5000, // simple majority
    fundingDeadline: now + DAY,
    eventDeadline: now + 2 * DAY,
    resolutionDeadline: now + 5 * DAY, // 72h attestation window
    maxParticipants: 2,
    resolutionMethod: Resolution.Attestation,
    ...overrides,
  };
}

async function createWager(factory, creator, overrides = {}) {
  const params = await defaultParams(overrides);
  const tx = await factory.connect(creator).createWager(params);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "WagerCreated");
  const wager = await ethers.getContractAt("Wager", event.args.wager);
  return { wager, params };
}

const entry = (params) => params.stake + params.bond;

describe("Wager lifecycle", function () {
  it("settles by unanimous attestation, pays the winner and takes a 1% fee", async function () {
    const { alice, bob, factory, treasury } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });
    expect(await wager.status()).to.equal(Status.Locked);

    await time.increaseTo(params.eventDeadline);
    await wager.connect(alice).attest(0);
    expect(await wager.status()).to.equal(Status.Locked); // one of two is not a majority
    await wager.connect(bob).attest(0);
    expect(await wager.status()).to.equal(Status.Settled);
    expect(await wager.winningSide()).to.equal(0);

    const pot = STAKE * 2n;
    const fee = (pot * 100n) / BPS;

    // Winner takes the pot minus fee, and both attesters get their bond back.
    expect(await wager.credits(alice.address)).to.equal(pot - fee + BOND);
    expect(await wager.credits(bob.address)).to.equal(BOND);
    expect(await wager.credits(await treasury.getAddress())).to.equal(fee);

    await expect(wager.connect(alice).withdraw()).to.changeEtherBalance(alice, pot - fee + BOND);
    expect(await wager.credits(alice.address)).to.equal(0);
    await expect(wager.connect(alice).withdraw()).to.be.revertedWith("nothing to withdraw");
  });

  it("splits the fee with the creator when ownerSplitBps is set", async function () {
    const { alice, bob, factory, treasury } = await deployStack();
    const { wager, params } = await createWager(factory, alice, { ownerSplitBps: 5000 });

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });
    await time.increaseTo(params.eventDeadline);
    await wager.connect(alice).attest(1);
    await wager.connect(bob).attest(1);

    const fee = (STAKE * 2n * 100n) / BPS;
    const ownerShare = fee / 2n;
    // Alice lost the wager but created it, so she is owed only the creator's fee share.
    expect(await wager.credits(alice.address)).to.equal(ownerShare + BOND);
    expect(await wager.credits(await treasury.getAddress())).to.equal(fee - ownerShare);
  });

  it("settles immediately when every loser concedes", async function () {
    const { alice, bob, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });

    // Concede is available as soon as the wager locks — no need to wait for the event.
    await wager.connect(bob).concede();

    expect(await wager.status()).to.equal(Status.Settled);
    expect(await wager.winningSide()).to.equal(0);
    expect(await wager.conceded(bob.address)).to.equal(true);

    const fee = (STAKE * 2n * 100n) / BPS;
    expect(await wager.credits(alice.address)).to.equal(STAKE * 2n - fee + BOND);
    // Bob conceded, which is participation in resolution, so his bond comes back.
    expect(await wager.credits(bob.address)).to.equal(BOND);
  });

  it("gives a non-attester's bond to the attesters, never to the house", async function () {
    const { alice, bob, carol, dave, factory, treasury } = await deployStack();
    const { wager, params } = await createWager(factory, alice, {
      maxParticipants: 4,
      stake: ethers.parseEther("0.01"),
    });

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(0, { value: entry(params) });
    await wager.connect(carol).join(1, { value: entry(params) });
    await wager.connect(dave).join(1, { value: entry(params) });

    await time.increaseTo(params.eventDeadline);
    // Three of four attest that side 0 won; Dave stays silent and forfeits his bond.
    await wager.connect(alice).attest(0);
    await wager.connect(bob).attest(0);
    await wager.connect(carol).attest(0);

    expect(await wager.status()).to.equal(Status.Settled);

    const stake = params.stake;
    const pot = stake * 4n;
    const fee = (pot * 100n) / BPS;
    const perWinner = (pot - fee) / 2n;
    const forfeitShare = BOND / 3n;
    const dust = BOND - forfeitShare * 3n;

    expect(await wager.credits(alice.address)).to.equal(perWinner + BOND + forfeitShare + dust);
    expect(await wager.credits(bob.address)).to.equal(perWinner + BOND + forfeitShare);
    expect(await wager.credits(carol.address)).to.equal(BOND + forfeitShare);
    expect(await wager.credits(dave.address)).to.equal(0);
    // The treasury receives the protocol fee only — no share of any bond.
    expect(await wager.credits(await treasury.getAddress())).to.equal(fee);
  });

  it("refunds stakes when attestation deadlocks past the deadline", async function () {
    const { alice, bob, factory, treasury } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });

    await time.increaseTo(params.eventDeadline);
    await wager.connect(alice).attest(0);
    await wager.connect(bob).attest(1); // disagreement, threshold never reached

    await expect(wager.expire()).to.be.revertedWith("resolution window open");
    await time.increaseTo(params.resolutionDeadline + 1);
    await wager.expire();

    expect(await wager.status()).to.equal(Status.Refunded);
    // Everyone gets their stake and bond back; the house takes nothing from a dispute.
    expect(await wager.credits(alice.address)).to.equal(STAKE + BOND);
    expect(await wager.credits(bob.address)).to.equal(STAKE + BOND);
    expect(await wager.credits(await treasury.getAddress())).to.equal(0);
  });

  it("burns the bond of participants who ignore the resolution window", async function () {
    const { alice, bob, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });

    await time.increaseTo(params.eventDeadline);
    await wager.connect(alice).attest(0); // Bob never shows up
    await time.increaseTo(params.resolutionDeadline + 1);
    await wager.expire();

    expect(await wager.credits(alice.address)).to.equal(STAKE + BOND * 2n);
    expect(await wager.credits(bob.address)).to.equal(STAKE);
  });

  it("lets an approved oracle resolve and returns every bond", async function () {
    const { alice, bob, oracle, carol, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice, { resolutionMethod: Resolution.Oracle });

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });
    await time.increaseTo(params.eventDeadline);

    await expect(wager.connect(carol).resolveByOracle(1)).to.be.revertedWith("not a resolver");
    await wager.connect(oracle).resolveByOracle(1);

    expect(await wager.status()).to.equal(Status.Settled);
    const fee = (STAKE * 2n * 100n) / BPS;
    expect(await wager.credits(bob.address)).to.equal(STAKE * 2n - fee + BOND);
    // No attestation duty on an oracle wager, so Alice's bond is returned too.
    expect(await wager.credits(alice.address)).to.equal(BOND);
  });

  it("refuses oracle resolution on an attestation wager", async function () {
    const { alice, bob, oracle, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });
    await time.increaseTo(params.eventDeadline);

    await expect(wager.connect(oracle).resolveByOracle(0)).to.be.revertedWith("not an oracle wager");
  });

  it("returns every deposit when a wager never gets a second side", async function () {
    const { alice, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await time.increaseTo(params.fundingDeadline + 1);

    await expect(wager.connect(alice).join(1, { value: entry(params) })).to.be.revertedWith("funding closed");
    await wager.cancel();

    expect(await wager.status()).to.equal(Status.Cancelled);
    expect(await wager.credits(alice.address)).to.equal(STAKE + BOND);
  });

  describe("guards", function () {
    it("rejects the wrong deposit, a bad side, and double joins", async function () {
      const { alice, bob, factory } = await deployStack();
      const { wager, params } = await createWager(factory, alice);

      await expect(wager.connect(alice).join(0, { value: STAKE })).to.be.revertedWith("incorrect value");
      await expect(wager.connect(alice).join(2, { value: entry(params) })).to.be.revertedWith("invalid side");

      await wager.connect(alice).join(0, { value: entry(params) });
      await expect(wager.connect(alice).join(1, { value: entry(params) })).to.be.revertedWith("already joined");

      await wager.connect(bob).join(1, { value: entry(params) });
      await expect(wager.connect(bob).concede()).to.not.be.reverted;
    });

    it("only lets participants resolve, and only once", async function () {
      const { alice, bob, carol, factory } = await deployStack();
      const { wager, params } = await createWager(factory, alice);

      await wager.connect(alice).join(0, { value: entry(params) });
      await wager.connect(bob).join(1, { value: entry(params) });
      await time.increaseTo(params.eventDeadline);

      await expect(wager.connect(carol).attest(0)).to.be.revertedWith("not participant");
      await wager.connect(alice).attest(0);
      await expect(wager.connect(alice).attest(1)).to.be.revertedWith("already resolved");
    });

    it("refuses attestation before the event is over and after the window shuts", async function () {
      const { alice, bob, factory } = await deployStack();
      const { wager, params } = await createWager(factory, alice);

      await wager.connect(alice).join(0, { value: entry(params) });
      await wager.connect(bob).join(1, { value: entry(params) });

      await expect(wager.connect(alice).attest(0)).to.be.revertedWith("event not over");
      await time.increaseTo(params.resolutionDeadline + 1);
      await expect(wager.connect(alice).attest(0)).to.be.revertedWith("resolution window closed");
    });

    it("cannot lock with only one side represented", async function () {
      const { alice, bob, factory } = await deployStack();
      const { wager, params } = await createWager(factory, alice, { maxParticipants: 4 });

      await wager.connect(alice).join(0, { value: entry(params) });
      await wager.connect(bob).join(0, { value: entry(params) });
      await expect(wager.connect(alice).lock()).to.be.revertedWith("both sides required");
    });
  });
});

describe("WagerFactory", function () {
  it("enforces per-person stake and total pot limits", async function () {
    const { alice, factory } = await deployStack();

    await expect(createWager(factory, alice, { stake: ethers.parseEther("0.2") })).to.be.revertedWith(
      "stake above limit"
    );
    await expect(
      createWager(factory, alice, { stake: ethers.parseEther("0.1"), maxParticipants: 6 })
    ).to.be.revertedWith("pot above limit");
  });

  it("caps how long an attestation window may stay open", async function () {
    const { alice, factory } = await deployStack();
    const now = await time.latest();

    await expect(
      createWager(factory, alice, { eventDeadline: now + 2 * DAY, resolutionDeadline: now + 30 * DAY })
    ).to.be.revertedWith("resolution window too long");
  });

  it("indexes wagers by creator and group", async function () {
    const { alice, bob, factory, groups } = await deployStack();

    await groups.connect(alice).createGroup(ethers.keccak256(ethers.toUtf8Bytes("Saturday Crew")), 0, 0);
    await groups.connect(alice).addMember(1, bob.address);

    const { wager } = await createWager(factory, alice, { groupId: 1 });

    expect(await factory.wagerCount()).to.equal(1);
    expect(await factory.getWagersByCreator(alice.address)).to.deep.equal([await wager.getAddress()]);
    expect(await factory.getWagersByGroup(1)).to.deep.equal([await wager.getAddress()]);
  });

  it("keeps non-members out of a group's wagers", async function () {
    const { alice, bob, factory, groups } = await deployStack();
    await groups.connect(alice).createGroup(ethers.ZeroHash, 0, 0);

    await expect(createWager(factory, bob, { groupId: 1 })).to.be.revertedWith("not a group member");
  });

  it("applies a group's stake limit on top of the protocol limit", async function () {
    const { alice, factory, groups } = await deployStack();
    await groups.connect(alice).createGroup(ethers.ZeroHash, ethers.parseEther("0.01"), 0);

    await expect(createWager(factory, alice, { groupId: 1 })).to.be.revertedWith("stake above group limit");
  });
});

describe("GroupRegistry", function () {
  it("manages membership and ownership", async function () {
    const { alice, bob, carol, groups } = await deployStack();

    await groups.connect(alice).createGroup(ethers.ZeroHash, 0, 0);
    expect(await groups.isMember(1, alice.address)).to.equal(true);

    await groups.connect(alice).addMembers(1, [bob.address, carol.address]);
    expect((await groups.groups(1)).memberCount).to.equal(3);

    await expect(groups.connect(bob).removeMember(1, carol.address)).to.be.revertedWith("not group owner");
    await groups.connect(alice).removeMember(1, carol.address);
    expect(await groups.isMember(1, carol.address)).to.equal(false);
    expect((await groups.groups(1)).memberCount).to.equal(2);

    await expect(groups.connect(alice).removeMember(1, alice.address)).to.be.revertedWith("cannot remove owner");

    await groups.connect(alice).transferGroupOwnership(1, bob.address);
    expect((await groups.groups(1)).owner).to.equal(bob.address);
  });
});

describe("Treasury", function () {
  it("collects fees from a settled wager and pays them out to the owner", async function () {
    const { alice, bob, treasuryOwner, treasury, factory } = await deployStack();
    const { wager, params } = await createWager(factory, alice);

    await wager.connect(alice).join(0, { value: entry(params) });
    await wager.connect(bob).join(1, { value: entry(params) });
    await time.increaseTo(params.eventDeadline);
    await wager.connect(alice).attest(0);
    await wager.connect(bob).attest(0);

    const fee = (STAKE * 2n * 100n) / BPS;
    await treasury.collect(await wager.getAddress());
    expect(await treasury.balance()).to.equal(fee);

    await expect(treasury.connect(treasuryOwner).withdraw(treasuryOwner.address, fee)).to.changeEtherBalance(
      treasuryOwner,
      fee
    );
    await expect(treasury.connect(alice).withdraw(alice.address, 1n)).to.be.revertedWith("not owner");
  });
});
