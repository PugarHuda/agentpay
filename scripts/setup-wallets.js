/**
 * Pre-deploy check: shows the deployer balance and, if AGENT_PRIVATE_KEY is
 * empty in .env, generates a fresh agent wallet and writes it there.
 * Usage: node scripts/setup-wallets.js
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://liteforge.rpc.caldera.xyz/http";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance : ${ethers.formatEther(balance)} zkLTC`);

  if (!process.env.AGENT_PRIVATE_KEY) {
    const agent = ethers.Wallet.createRandom();
    const envPath = path.join(__dirname, "..", ".env");
    const env = fs.readFileSync(envPath, "utf8");
    // tolerate CRLF/trailing whitespace; append the line if it's missing entirely
    const updated = env.replace(/^AGENT_PRIVATE_KEY=[ \t]*$/m, `AGENT_PRIVATE_KEY=${agent.privateKey}`);
    fs.writeFileSync(
      envPath,
      updated.includes(agent.privateKey)
        ? updated
        : `${env}\nAGENT_PRIVATE_KEY=${agent.privateKey}\n`
    );
    console.log(`Agent   : ${agent.address} (new wallet written to .env)`);
  } else {
    const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
    const agentBalance = await provider.getBalance(agent.address);
    console.log(`Agent   : ${agent.address} (${ethers.formatEther(agentBalance)} zkLTC)`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
