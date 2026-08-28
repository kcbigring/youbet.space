require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.19",
  paths: {
    sources: "contracts",
    tests: "test"
  }
  ,
  defaultNetwork: "base_testnet",
  networks: {
    base_testnet: {
      url: process.env.BASE_RPC || "https://rpc.base-testnet.example",
      // accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    },
    robinhood_testnet: {
      url: process.env.ROBINHOOD_RPC || "https://rpc.robinhood-chain.testnet",
      // accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  }
};
