const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

// Risk controls from the execution plan, expressed on-chain in native units.
// $100 max per person per wager and $500 max pot, converted at DEPLOY_ETH_USD.
const ETH_USD = Number(process.env.DEPLOY_ETH_USD || 3000);
const MAX_STAKE_USD = Number(process.env.MAX_STAKE_USD || 100);
const MAX_POT_USD = Number(process.env.MAX_POT_USD || 500);

const toWei = (usd) => ethers.parseEther((usd / ETH_USD).toFixed(18));

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.PROTOCOL_OWNER || deployer.address;

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const treasury = await (await ethers.getContractFactory("Treasury")).deploy(owner);
  await treasury.waitForDeployment();
  console.log(`Treasury:         ${await treasury.getAddress()}`);

  const groups = await (await ethers.getContractFactory("GroupRegistry")).deploy();
  await groups.waitForDeployment();
  console.log(`GroupRegistry:    ${await groups.getAddress()}`);

  const resolvers = await (await ethers.getContractFactory("ResolverRegistry")).deploy(owner);
  await resolvers.waitForDeployment();
  console.log(`ResolverRegistry: ${await resolvers.getAddress()}`);

  const maxStakeWei = toWei(MAX_STAKE_USD);
  const maxPotWei = toWei(MAX_POT_USD);

  const book = await (
    await ethers.getContractFactory("WagerBook")
  ).deploy(
    owner,
    process.env.TREASURY_ADDRESS || (await treasury.getAddress()),
    await groups.getAddress(),
    await resolvers.getAddress(),
    maxStakeWei,
    maxPotWei
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
      ethUsd: ETH_USD,
      maxStakeUsd: MAX_STAKE_USD,
      maxPotUsd: MAX_POT_USD,
      maxStakeWei: maxStakeWei.toString(),
      maxPotWei: maxPotWei.toString(),
      feeBps: 100,
    },
    contracts: {
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
