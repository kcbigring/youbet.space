const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

// Risk controls from the execution plan. Stakes are denominated in a six-decimal
// dollar token, so these are exact — no exchange rate, no drift.
const MAX_STAKE_USD = Number(process.env.MAX_STAKE_USD || 100);
const MAX_POT_USD = Number(process.env.MAX_POT_USD || 500);

const usd = (dollars) => BigInt(Math.round(dollars * 1e6));

// On mainnet, point at real USDC instead of deploying test dollars.
const STAKE_TOKEN = process.env.STAKE_TOKEN_ADDRESS;

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.PROTOCOL_OWNER || deployer.address;

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  let tokenAddress = STAKE_TOKEN;
  if (tokenAddress) {
    console.log(`Stake token:      ${tokenAddress} (existing)`);
  } else {
    const testUsd = await (await ethers.getContractFactory("PlayDollar")).deploy(owner);
    await testUsd.waitForDeployment();
    tokenAddress = await testUsd.getAddress();
    console.log(`PlayDollar:          ${tokenAddress}`);
  }

  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(owner);
  await treasury.waitForDeployment();
  console.log(`Treasury:         ${await treasury.getAddress()}`);

  const groups = await (await ethers.getContractFactory("GroupRegistry")).deploy();
  await groups.waitForDeployment();
  console.log(`GroupRegistry:    ${await groups.getAddress()}`);

  const resolvers = await (await ethers.getContractFactory("ResolverRegistry")).deploy(owner);
  await resolvers.waitForDeployment();
  console.log(`ResolverRegistry: ${await resolvers.getAddress()}`);

  const maxStake = usd(MAX_STAKE_USD);
  const maxPot = usd(MAX_POT_USD);

  const book = await (
    await ethers.getContractFactory("WagerBook")
  ).deploy(
    owner,
    tokenAddress,
    process.env.TREASURY_ADDRESS || (await treasury.getAddress()),
    await groups.getAddress(),
    await resolvers.getAddress(),
    maxStake,
    maxPot
  );
  await book.waitForDeployment();
  console.log(`WagerBook:        ${await book.getAddress()}`);

  if (process.env.ORACLE_RESOLVER) {
    await (await resolvers.setResolver(process.env.ORACLE_RESOLVER, true, "primary-resolver")).wait();
    console.log(`Approved resolver: ${process.env.ORACLE_RESOLVER}`);
  }

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    owner,
    limits: {
      maxStakeUsd: MAX_STAKE_USD,
      maxPotUsd: MAX_POT_USD,
      maxStakeUnits: maxStake.toString(),
      maxPotUnits: maxPot.toString(),
      feeBps: 100,
    },
    contracts: {
      StakeToken: tokenAddress,
      Treasury: await treasury.getAddress(),
      GroupRegistry: await groups.getAddress(),
      ResolverRegistry: await resolvers.getAddress(),
      WagerBook: await book.getAddress(),
    },
  };

  const dir = path.resolve(__dirname, "../../deployments");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  console.log(`\nSaved ${out}`);
  console.log(`\nSet in the API env:\n  WAGER_BOOK_ADDRESS=${record.contracts.WagerBook}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
