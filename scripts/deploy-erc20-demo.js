/**
 * Deploy AgentEscrowERC20 against the Dappit-deployed APAY token, then run a
 * full token-wage demo: approve -> createJob -> agent earns APAY per task.
 *
 * Prereq: set APAY_TOKEN_ADDRESS in .env to the address Dappit gave you, and
 * make sure PRIVATE_KEY's wallet holds some APAY (Dappit mints to deployer).
 *
 * Usage: node scripts/deploy-erc20-demo.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
];
const ESCROW_ARTIFACT = require("../artifacts/contracts/AgentEscrowERC20.sol/AgentEscrowERC20.json");

async function main() {
  const token = process.env.APAY_TOKEN_ADDRESS;
  if (!token) throw new Error("Set APAY_TOKEN_ADDRESS in .env (the address Dappit gave you)");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const client = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const agentAddress = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;

  const apay = new ethers.Contract(token, ERC20_ABI, client);
  const sym = await apay.symbol().catch(() => "APAY");
  const bal = await apay.balanceOf(client.address);
  console.log(`Client APAY balance: ${ethers.formatEther(bal)} ${sym}`);
  if (bal === 0n) throw new Error("Client wallet holds 0 APAY — mint some via Dappit first");

  // 1. deploy the ERC-20 escrow
  const factory = new ethers.ContractFactory(ESCROW_ARTIFACT.abi, ESCROW_ARTIFACT.bytecode, client);
  const escrow = await factory.deploy(token);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`AgentEscrowERC20 deployed: ${escrowAddr}`);
  console.log(`Explorer: https://liteforge.explorer.caldera.xyz/address/${escrowAddr}`);

  // 2. approve + create a token-funded job
  const rate = ethers.parseEther("10");
  const deposit = ethers.parseEther("50");
  await (await apay.approve(escrowAddr, deposit)).wait();
  const tx = await escrow.createJob(agentAddress, rate, deposit, "ChainAnalyst paid in APAY (Dappit-deployed reward token)");
  const receipt = await tx.wait();
  console.log(`Job #0 created, escrowed 50 ${sym} — tx ${receipt.hash}`);

  console.log(`\n✅ ERC-20 escrow live. Point the agent at it:`);
  console.log(`   ESCROW_ADDRESS=${escrowAddr} (ERC-20 mode) — agent earns ${sym} per task.`);
  console.log(`\nAdd to .env:\n   ESCROW_ERC20_ADDRESS=${escrowAddr}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
