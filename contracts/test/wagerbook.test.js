const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BPS = 10_000n;
// Stakes are dollars in a six-decimal token, not a fraction of ETH.
const usd = (dollars) => BigInt(Math.round(dollars * 1e6));
const STAKE = usd(25); // "$25 each"
const BOND = usd(1); // "$1 resolution bond"
const DAY = 24 * 60 * 60;

const Resolution = { Attestation: 0, Oracle: 1 };
const Status = { None: 0, Open: 1, Locked: 2, Settled: 3, Refunded: 4, Cancelled: 5 };

async function deployStack() {
  const [deployer, alice, bob, carol, dave, treasuryOwner, oracle] = await ethers.getSigners();

  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(treasuryOwner.address);
  const groups = await (await ethers.getContractFactory("GroupRegistry")).deploy();
  const resolvers = await (await ethers.getContractFactory("ResolverRegistry")).deploy(deployer.address);
  await resolvers.setResolver(oracle.address, true, "test-sports-feed");

  const token = await (await ethers.getContractFactory("TestUSD")).deploy(deployer.address);

  const book = await (await ethers.getContractFactory("WagerBook")).deploy(
    deployer.address,
    await token.getAddress(),
    await treasury.getAddress(),
    await groups.getAddress(),
    await resolvers.getAddress(),
    usd(100), // max stake per person
    usd(500) // max pot
  );

  // Everyone starts with test money and a standing allowance, which is what the
  // app arranges for a new account.
  const bookAddress = await book.getAddress();
  for (const who of [alice, bob, carol, dave]) {
    await token.mint(who.address, usd(10_000));
    await token.connect(who).approve(bookAddress, ethers.MaxUint256);
  }

  return { deployer, alice, bob, carol, dave, treasuryOwner, oracle, treasury, groups, resolvers, book, token };
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

async function createWager(book, creator, overrides = {}) {
  const params = await defaultParams(overrides);
  const receipt = await (await book.connect(creator).createWager(params)).wait();
  const event = receipt.logs
    .map((log) => {
      try {
        return book.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "WagerCreated");
  return { id: event.args.wagerId, params };
}



describe("WagerBook lifecycle", function () {
  it("settles by unanimous attestation, pays the winner and takes a 1% fee", async function () {
    const { alice, bob, book, treasury, token } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);
    expect((await book.getWager(id)).status).to.equal(Status.Locked);

    await time.increaseTo(params.eventDeadline);
    await book.connect(alice).attest(id, 0);
    expect((await book.getWager(id)).status).to.equal(Status.Locked); // one of two is not a majority
    await book.connect(bob).attest(id, 0);
    expect((await book.getWager(id)).status).to.equal(Status.Settled);
    expect((await book.getWager(id)).winningSide).to.equal(0);

    const pot = STAKE * 2n;
    const fee = (pot * 100n) / BPS;

    expect(await book.credits(alice.address)).to.equal(pot - fee + BOND);
    expect(await book.credits(bob.address)).to.equal(BOND);
    expect(await book.credits(await treasury.getAddress())).to.equal(fee);

    const before = await token.balanceOf(alice.address);
    await book.connect(alice).withdraw();
    expect(await token.balanceOf(alice.address)).to.equal(before + pot - fee + BOND);
    expect(await book.credits(alice.address)).to.equal(0);
    await expect(book.connect(alice).withdraw()).to.be.revertedWith("nothing to withdraw");
  });

  it("splits the fee with the creator when ownerSplitBps is set", async function () {
    const { alice, bob, book, treasury } = await deployStack();
    const { id, params } = await createWager(book, alice, { ownerSplitBps: 5000 });

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);
    await time.increaseTo(params.eventDeadline);
    await book.connect(alice).attest(id, 1);
    await book.connect(bob).attest(id, 1);

    const fee = (STAKE * 2n * 100n) / BPS;
    const ownerShare = fee / 2n;
    expect(await book.credits(alice.address)).to.equal(ownerShare + BOND);
    expect(await book.credits(await treasury.getAddress())).to.equal(fee - ownerShare);
  });

  it("settles immediately when every loser concedes, returning all bonds", async function () {
    const { alice, bob, book } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);

    // Concede is available as soon as the wager locks.
    await book.connect(bob).concede(id);

    expect((await book.getWager(id)).status).to.equal(Status.Settled);
    expect((await book.getWager(id)).winningSide).to.equal(0);
    expect(await book.conceded(id, bob.address)).to.equal(true);

    const fee = (STAKE * 2n * 100n) / BPS;
    // Nobody disputed anything, so the winner is not charged for staying quiet.
    expect(await book.credits(alice.address)).to.equal(STAKE * 2n - fee + BOND);
    expect(await book.credits(bob.address)).to.equal(BOND);
  });

  it("gives a non-attester's bond to the attesters, never to the house", async function () {
    const { alice, bob, carol, dave, book, treasury } = await deployStack();
    const { id, params } = await createWager(book, alice, {
      maxParticipants: 4,
      stake: usd(10),
    });

    for (const [who, s] of [[alice, 0], [bob, 0], [carol, 1], [dave, 1]]) {
      await book.connect(who).join(id, s);
    }

    await time.increaseTo(params.eventDeadline);
    // Three of four attest that side 0 won; Dave stays silent.
    await book.connect(alice).attest(id, 0);
    await book.connect(bob).attest(id, 0);
    await book.connect(carol).attest(id, 0);

    expect((await book.getWager(id)).status).to.equal(Status.Settled);

    const pot = params.stake * 4n;
    const fee = (pot * 100n) / BPS;
    const perWinner = (pot - fee) / 2n;
    const forfeitShare = BOND / 3n;
    const dust = BOND - forfeitShare * 3n;

    expect(await book.credits(alice.address)).to.equal(perWinner + BOND + forfeitShare + dust);
    expect(await book.credits(bob.address)).to.equal(perWinner + BOND + forfeitShare);
    expect(await book.credits(carol.address)).to.equal(BOND + forfeitShare);
    expect(await book.credits(dave.address)).to.equal(0);
    expect(await book.credits(await treasury.getAddress())).to.equal(fee);
  });

  it("refunds stakes when attestation deadlocks past the deadline", async function () {
    const { alice, bob, book, treasury } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);

    await time.increaseTo(params.eventDeadline);
    await book.connect(alice).attest(id, 0);
    await book.connect(bob).attest(id, 1); // disagreement, threshold never reached

    await expect(book.expire(id)).to.be.revertedWith("resolution window open");
    await time.increaseTo(params.resolutionDeadline + 1);
    await book.expire(id);

    expect((await book.getWager(id)).status).to.equal(Status.Refunded);
    expect(await book.credits(alice.address)).to.equal(STAKE + BOND);
    expect(await book.credits(bob.address)).to.equal(STAKE + BOND);
    expect(await book.credits(await treasury.getAddress())).to.equal(0);
  });

  it("burns the bond of participants who ignore the resolution window", async function () {
    const { alice, bob, book } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);

    await time.increaseTo(params.eventDeadline);
    await book.connect(alice).attest(id, 0); // Bob never shows up
    await time.increaseTo(params.resolutionDeadline + 1);
    await book.expire(id);

    expect(await book.credits(alice.address)).to.equal(STAKE + BOND * 2n);
    expect(await book.credits(bob.address)).to.equal(STAKE);
  });

  it("lets an approved oracle resolve and returns every bond", async function () {
    const { alice, bob, carol, oracle, book } = await deployStack();
    const { id, params } = await createWager(book, alice, { resolutionMethod: Resolution.Oracle });

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);
    await time.increaseTo(params.eventDeadline);

    await expect(book.connect(carol).resolveByOracle(id, 1)).to.be.revertedWith("not a resolver");
    await book.connect(oracle).resolveByOracle(id, 1);

    expect((await book.getWager(id)).status).to.equal(Status.Settled);
    const fee = (STAKE * 2n * 100n) / BPS;
    expect(await book.credits(bob.address)).to.equal(STAKE * 2n - fee + BOND);
    expect(await book.credits(alice.address)).to.equal(BOND);
  });

  it("refuses oracle resolution on an attestation wager", async function () {
    const { alice, bob, oracle, book } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await book.connect(bob).join(id, 1);
    await time.increaseTo(params.eventDeadline);

    await expect(book.connect(oracle).resolveByOracle(id, 0)).to.be.revertedWith("not an oracle wager");
  });

  it("returns every deposit when a wager never gets a second side", async function () {
    const { alice, book } = await deployStack();
    const { id, params } = await createWager(book, alice);

    await book.connect(alice).join(id, 0);
    await time.increaseTo(params.fundingDeadline + 1);

    await expect(book.connect(alice).join(id, 1)).to.be.revertedWith("funding closed");
    await book.cancel(id);

    expect((await book.getWager(id)).status).to.equal(Status.Cancelled);
    expect(await book.credits(alice.address)).to.equal(STAKE + BOND);
  });

  describe("guards", function () {
    it("rejects the wrong deposit, a bad side, and double joins", async function () {
      const { alice, bob, book } = await deployStack();
      const { id, params } = await createWager(book, alice);

      await expect(book.connect(alice).join(id, 2)).to.be.revertedWith("invalid side");

      await book.connect(alice).join(id, 0);
      await expect(book.connect(alice).join(id, 1)).to.be.revertedWith("already joined");

      await book.connect(bob).join(id, 1);
      await expect(book.connect(bob).concede(id)).to.not.be.reverted;
    });

    it("only lets participants resolve, and only once", async function () {
      const { alice, bob, carol, book } = await deployStack();
      const { id, params } = await createWager(book, alice);

      await book.connect(alice).join(id, 0);
      await book.connect(bob).join(id, 1);
      await time.increaseTo(params.eventDeadline);

      await expect(book.connect(carol).attest(id, 0)).to.be.revertedWith("not participant");
      await book.connect(alice).attest(id, 0);
      await expect(book.connect(alice).attest(id, 1)).to.be.revertedWith("already resolved");
    });

    it("refuses attestation before the event is over and after the window shuts", async function () {
      const { alice, bob, book } = await deployStack();
      const { id, params } = await createWager(book, alice);

      await book.connect(alice).join(id, 0);
      await book.connect(bob).join(id, 1);

      await expect(book.connect(alice).attest(id, 0)).to.be.revertedWith("event not over");
      await time.increaseTo(params.resolutionDeadline + 1);
      await expect(book.connect(alice).attest(id, 0)).to.be.revertedWith("resolution window closed");
    });

    it("cannot lock with only one side represented", async function () {
      const { alice, bob, book } = await deployStack();
      const { id, params } = await createWager(book, alice, { maxParticipants: 4 });

      await book.connect(alice).join(id, 0);
      await book.connect(bob).join(id, 0);
      await expect(book.connect(alice).lock(id)).to.be.revertedWith("both sides required");
    });

    it("refuses to join without an allowance, and holds the escrow itself", async function () {
      const { alice, bob, carol, book, token } = await deployStack();
      const { id } = await createWager(book, alice);

      // Carol revokes her allowance; the token, not the book, rejects her.
      await token.connect(carol).approve(await book.getAddress(), 0);
      await expect(book.connect(carol).join(id, 0)).to.be.revertedWith("insufficient allowance");

      await book.connect(alice).join(id, 0);
      await book.connect(bob).join(id, 1);

      // Stakes and bonds sit in the contract until settlement, not with anyone.
      expect(await token.balanceOf(await book.getAddress())).to.equal((STAKE + BOND) * 2n);
    });

    it("cannot join with more test money than the account holds", async function () {
      const { alice, deployer, book, token } = await deployStack();
      const { id } = await createWager(book, alice, { stake: usd(100) });

      // Drain Alice, keeping the allowance in place.
      await token.connect(alice).transfer(deployer.address, await token.balanceOf(alice.address));
      await expect(book.connect(alice).join(id, 0)).to.be.revertedWith("insufficient balance");
    });

    it("keeps wagers isolated from one another", async function () {
      const { alice, bob, carol, dave, book } = await deployStack();
      const a = await createWager(book, alice);
      const b = await createWager(book, carol);

      await book.connect(alice).join(a.id, 0);
      await book.connect(bob).join(a.id, 1);
      await book.connect(carol).join(b.id, 0);
      await book.connect(dave).join(b.id, 1);

      // Resolving one must not touch the other.
      await time.increaseTo(a.params.eventDeadline);
      await book.connect(alice).attest(a.id, 0);
      await book.connect(bob).attest(a.id, 0);

      expect((await book.getWager(a.id)).status).to.equal(Status.Settled);
      expect((await book.getWager(b.id)).status).to.equal(Status.Locked);
      expect(await book.credits(carol.address)).to.equal(0);
      expect(await book.credits(dave.address)).to.equal(0);
      expect(await book.participantCount(a.id)).to.equal(2);
      expect(await book.participantCount(b.id)).to.equal(2);
    });

    it("collects winnings from several wagers in one withdrawal", async function () {
      const { alice, bob, book, token } = await deployStack();
      const a = await createWager(book, alice);
      const b = await createWager(book, alice);

      for (const w of [a, b]) {
        await book.connect(alice).join(w.id, 0);
        await book.connect(bob).join(w.id, 1);
      }

      await time.increaseTo(a.params.eventDeadline);
      for (const w of [a, b]) {
        await book.connect(alice).attest(w.id, 0);
        await book.connect(bob).attest(w.id, 0);
      }

      const fee = (STAKE * 2n * 100n) / BPS;
      const perWager = STAKE * 2n - fee + BOND;
      // Credits are global, so one passkey prompt claims both.
      expect(await book.credits(alice.address)).to.equal(perWager * 2n);
      const before = await token.balanceOf(alice.address);
      await book.connect(alice).withdraw();
      expect(await token.balanceOf(alice.address)).to.equal(before + perWager * 2n);
    });
  });
});

describe("WagerBook limits and indexes", function () {
  it("enforces per-person stake and total pot limits", async function () {
    const { alice, book } = await deployStack();

    await expect(createWager(book, alice, { stake: usd(200) })).to.be.revertedWith("stake above limit");
    // At the per-person ceiling, six participants still overshoot the pot cap.
    await expect(createWager(book, alice, { stake: usd(100), maxParticipants: 6 })).to.be.revertedWith(
      "pot above limit"
    );
  });

  it("caps how long an attestation window may stay open", async function () {
    const { alice, book } = await deployStack();
    const now = await time.latest();

    await expect(
      createWager(book, alice, { eventDeadline: now + 2 * DAY, resolutionDeadline: now + 30 * DAY })
    ).to.be.revertedWith("resolution window too long");
  });

  it("indexes wagers by creator, group and participant", async function () {
    const { alice, bob, book, groups } = await deployStack();

    await groups.connect(alice).createGroup(ethers.keccak256(ethers.toUtf8Bytes("Saturday Crew")), 0, 0);
    await groups.connect(alice).addMember(1, bob.address);

    const { id, params } = await createWager(book, alice, { groupId: 1 });
    await book.connect(bob).join(id, 1);

    expect(await book.wagerCount()).to.equal(1);
    expect(await book.getWagersByCreator(alice.address)).to.deep.equal([id]);
    expect(await book.getWagersByGroup(1)).to.deep.equal([id]);
    expect(await book.getWagersByParticipant(bob.address)).to.deep.equal([id]);
  });

  it("keeps non-members out of a group's wagers", async function () {
    const { alice, bob, book, groups } = await deployStack();
    await groups.connect(alice).createGroup(ethers.ZeroHash, 0, 0);

    await expect(createWager(book, bob, { groupId: 1 })).to.be.revertedWith("not a group member");
  });

  it("applies a group's stake limit on top of the protocol limit", async function () {
    const { alice, book, groups } = await deployStack();
    await groups.connect(alice).createGroup(ethers.ZeroHash, usd(10), 0);

    await expect(createWager(book, alice, { groupId: 1 })).to.be.revertedWith("stake above group limit");
  });

  it("only lets the owner change protocol limits", async function () {
    const { alice, deployer, book } = await deployStack();
    await expect(book.connect(alice).setLimits(1, 2, 50)).to.be.revertedWith("not owner");
    await book.connect(deployer).setLimits(usd(1000), usd(5000), 50);
    expect(await book.feeBps()).to.equal(50);
    await expect(book.connect(deployer).setLimits(1, 2, 2000)).to.be.revertedWith("fee above 10%");
  });
});
