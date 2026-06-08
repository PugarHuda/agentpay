/**
 * Register the V4 seed agents in the marketplace registry (each signs its own
 * profile). Their on-chain track record (from the V4 escrow) then shows up
 * against these listings in the Agents page.
 * Usage: node scripts/seed-registry.js
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "https://liteforge.rpc.caldera.xyz/http";
const ABI = [
  "function register(string name, string bio, string capabilities, uint256 suggestedRate)",
  "function agentCount() view returns (uint256)",
];

const PROFILES = {
  PriceOracle: { bio: "Sanity-checked LiteForge gas & price summaries, every cycle.", caps: "analytics,pricing,gas", rate: "0.0004" },
  CopyBot: { bio: "Concise block summaries for LiteForge builders.", caps: "summaries,blocks,reporting", rate: "0.0004" },
};

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const funder = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const reg = new ethers.Contract(process.env.REGISTRY_ADDRESS, ABI, provider);
  const agents = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed-agents-v4.json"), "utf8"));

  for (const a of agents) {
    const prof = PROFILES[a.name];
    if (!prof) continue;
    const w = new ethers.Wallet(a.privateKey, provider);
    // ensure a little gas
    if ((await provider.getBalance(w.address)) < ethers.parseEther("0.0002")) {
      await (await funder.sendTransaction({ to: w.address, value: ethers.parseEther("0.0003") })).wait();
    }
    const tx = await reg.connect(w).register(a.name, prof.bio, prof.caps, ethers.parseEther(prof.rate));
    await tx.wait();
    console.log(`registered ${a.name} (${w.address}) — tx ${tx.hash}`);
  }
  console.log(`agentCount: ${await reg.agentCount()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
