const hre = require("hardhat");
async function main() {
  const r = await hre.ethers.deployContract("AgentRegistry");
  await r.waitForDeployment();
  console.log("AgentRegistry:", await r.getAddress());
  console.log("block:", (await hre.ethers.provider.getBlock("latest")).number);
}
main().catch((e) => { console.error(e); process.exit(1); });
