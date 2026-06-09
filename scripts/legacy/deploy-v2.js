const hre = require("hardhat");

// Short dispute window so demos can show the optimistic claim within a session.
// A production deployment would use hours/days.
const DISPUTE_WINDOW = Number(process.env.DISPUTE_WINDOW || 90); // seconds
const COOLDOWN = Number(process.env.COOLDOWN || 0); // seconds

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AgentEscrowV2 with:", deployer.address);
  console.log(`disputeWindow=${DISPUTE_WINDOW}s cooldown=${COOLDOWN}s`);
  console.log(
    "Balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "zkLTC"
  );

  const escrow = await hre.ethers.deployContract("AgentEscrowV2", [DISPUTE_WINDOW, COOLDOWN]);
  await escrow.waitForDeployment();
  const addr = await escrow.getAddress();
  console.log("AgentEscrowV2 deployed to:", addr);
  console.log(`Explorer: https://liteforge.explorer.caldera.xyz/address/${addr}`);
  console.log(`\nSet ESCROW_V2_ADDRESS=${addr} in .env and VITE_ESCROW_ADDRESS for the frontend.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
