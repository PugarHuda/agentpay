/**
 * Send a little zkLTC from the deployer to the agent wallet so it can pay gas.
 * Usage: node scripts/fund-agent.js [amountZkLtc=0.005]
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";

async function main() {
  const amount = ethers.parseEther(process.argv[2] || "0.005");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const agentAddress = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;

  console.log(`Sending ${ethers.formatEther(amount)} zkLTC gas money to agent ${agentAddress}...`);
  const tx = await deployer.sendTransaction({ to: agentAddress, value: amount });
  await tx.wait();
  console.log(`Done — tx ${tx.hash}`);
  console.log(`Agent balance: ${ethers.formatEther(await provider.getBalance(agentAddress))} zkLTC`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
