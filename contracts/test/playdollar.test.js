const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const usd = (d) => BigInt(Math.round(d * 1e6));

describe("PlayDollar founding bonus", function () {
  async function deploy() {
    const signers = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("PlayDollar")).deploy(signers[0].address);
    return { token, signers };
  }

  it("pays the first ten accounts ten times what the next ninety get", async function () {
    const { token, signers } = await deploy();

    // First claimant: daily drip plus the founder bonus.
    await token.connect(signers[1]).drip();
    expect(await token.balanceOf(signers[1].address)).to.equal(usd(500) + usd(10_000));

    // Fill the remaining founder slots, then check the eleventh.
    for (let i = 2; i <= 10; i++) await token.connect(signers[i]).drip();
    expect(await token.claimed()).to.equal(10);

    await token.connect(signers[11]).drip();
    expect(await token.balanceOf(signers[11].address)).to.equal(usd(500) + usd(1_000));
  });

  it("pays the bonus once, however many times an account drips", async function () {
    const { token, signers } = await deploy();
    await token.connect(signers[1]).drip();

    await time.increase(24 * 60 * 60 + 1);
    await token.connect(signers[1]).drip();

    // 500 + 10,000 bonus, then 500 more. The bonus does not repeat.
    expect(await token.balanceOf(signers[1].address)).to.equal(usd(10_000) + usd(1_000));
    expect(await token.claimed()).to.equal(1);
  });

  it("still rate-limits to one drip a day", async function () {
    const { token, signers } = await deploy();
    await token.connect(signers[1]).drip();
    await expect(token.connect(signers[1]).drip()).to.be.revertedWith("already dripped today");
  });

  it("says what an account would get before it commits", async function () {
    const { token, signers } = await deploy();

    let [amount, position, bonus] = await token.previewDrip(signers[1].address);
    expect(position).to.equal(1);
    expect(bonus).to.equal(usd(10_000));
    expect(amount).to.equal(usd(10_500));

    await token.connect(signers[1]).drip();

    // Next in line is number two; the one who claimed sees no bonus.
    [amount, position, bonus] = await token.previewDrip(signers[2].address);
    expect(position).to.equal(2);
    [amount, position, bonus] = await token.previewDrip(signers[1].address);
    expect(bonus).to.equal(0);
    expect(amount).to.equal(usd(500));
  });

  it("lets the owner retune the bonuses, and nobody else", async function () {
    const { token, signers } = await deploy();
    await expect(token.connect(signers[1]).setBonuses(1, 1)).to.be.revertedWith("not owner");
    await token.setBonuses(usd(5_000), usd(250));
    const [, , bonus] = await token.previewDrip(signers[3].address);
    expect(bonus).to.equal(usd(5_000));
  });
});
