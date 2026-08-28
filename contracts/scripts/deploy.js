async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with account:', deployer.address);

  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  const Factory = await ethers.getContractFactory('WagerFactory');
  const factory = await Factory.deploy(treasury);
  await factory.deployed();
  console.log('WagerFactory deployed to:', factory.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
