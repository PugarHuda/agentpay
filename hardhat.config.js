require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    liteforge: {
      url: "https://liteforge.rpc.caldera.xyz/http",
      chainId: 4441,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // Contract verification on the LiteForge Blockscout explorer
  etherscan: {
    apiKey: { liteforge: "blockscout" },
    customChains: [
      {
        network: "liteforge",
        chainId: 4441,
        urls: {
          apiURL: "https://liteforge.explorer.caldera.xyz/api",
          browserURL: "https://liteforge.explorer.caldera.xyz",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};
