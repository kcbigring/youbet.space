require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
// Same precedence as the API: local secrets first, shared defaults after.
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // WagerBook holds every wager's state, so several functions carry more
      // locals than the legacy pipeline can keep on the stack. The IR pipeline
      // handles that and optimizes better; it costs compile time.
      viaIR: true,
      // Base runs the Cancun opcodes; keep the target explicit so local builds match.
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "contracts",
    tests: "test",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // The node the end-to-end harness starts. viem calls this chain `foundry`
    // and defaults it to the same id and port, so the browser needs no config
    // of its own to reach it.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // Primary target — Base.
    base_sepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    base: {
      url: process.env.BASE_RPC || "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
  },
  etherscan: {
    // One key, every chain: Etherscan's V2 API is multichain, so the per-network
    // map this used to carry was two copies of the same value.
    apiKey: process.env.BASESCAN_API_KEY || "",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};
