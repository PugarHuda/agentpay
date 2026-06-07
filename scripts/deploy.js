const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AgentEscrow with:", deployer.address);
  console.log(
    "Balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "zkLTC"
  );

  const escrow = await hre.ethers.deployContract("AgentEscrow");
  await escrow.waitForDeployment();

  console.log("AgentEscrow deployed to:", await escrow.getAddress());
  console.log(
    `Explorer: https://liteforge.explorer.caldera.xyz/address/${await escrow.getAddress()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
