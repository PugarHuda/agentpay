const hre = require("hardhat");
async function main() {
  const e = await hre.ethers.deployContract("AgentEscrowV4", [90, 0]);
  await e.waitForDeployment();
  const a = await e.getAddress();
  console.log("AgentEscrowV4:", a);
  console.log("block:", (await hre.ethers.provider.getBlock("latest")).number);
}
main().catch((e) => { console.error(e); process.exit(1); });
