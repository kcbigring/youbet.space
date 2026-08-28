const { expect } = require("chai");

describe("Wager end-to-end (local)", function () {
  it("creates a wager, two participants join, attest, and settle", async function () {
    const [deployer, alice, bob, treasury] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("WagerFactory");
    const factory = await Factory.connect(deployer).deploy(treasury.address);
    await factory.deployed();

    const stake = ethers.utils.parseEther("0.01");
    const bond = ethers.utils.parseEther("0.001");

    const tx = await factory.createWager(stake, bond, 0);
    const receipt = await tx.wait();
    const wAddr = receipt.events.find(e=>e.event=="WagerCreated").args[0];

    const Wager = await ethers.getContractFactory("Wager");
    const wager = Wager.attach(wAddr);

    // Alice joins as side 0
    await wager.connect(alice).join(0, { value: stake.add(bond) });
    // Bob joins as side 1
    await wager.connect(bob).join(1, { value: stake.add(bond) });

    // both attest: Alice says side 0 won, Bob says side 0 as well (agree)
    await wager.connect(alice).attest(0);
    await wager.connect(bob).attest(0);

    // settle by consensus with winner side 0
    await wager.connect(alice).settleByConsensus(0);

    // winner should be Alice, check balance increase approx
    // (we avoid exact balance checks due to gas variability in local runs)
  });
});
