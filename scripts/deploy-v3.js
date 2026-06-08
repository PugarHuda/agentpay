const hre = require("hardhat");
async function main() {
  const e = await hre.ethers.deployContract("AgentEscrowV3", [90, 0]);
  await e.waitForDeployment();
  const a = await e.getAddress();
  console.log("AgentEscrowV3:", a);
  const b = await hre.ethers.provider.getBlock("latest");
  console.log("block:", b.number);
}
main().catch(e=>{console.error(e);process.exit(1)});
