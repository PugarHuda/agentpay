/**
 * Records real screen-capture B-roll of the LIVE GrailWatch dashboard on
 * LiteForge, one .webm clip per scene, into out/gw/. Mid-recording it fires a
 * REAL on-chain attestation so the dashboard visibly updates live.
 *
 * Output clips (fed to the Remotion composition):
 *   1-landing.webm  2-reserves.webm  3-live.webm  4-history.webm
 */
const { chromium } = require("playwright");
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "grailwatch", ".env") });

const BASE = "https://grailwatch-mauve.vercel.app";
const OUT = path.join(__dirname, "out", "gw");
const V3 = "0xf099F039f8206C4C2BF91120A913a1F138fBAfcB";
const SIZE = { width: 1280, height: 720 };
const RPC = "https://liteforge.rpc.caldera.xyz/http";
const SUPPLY_API = "https://liteforge.explorer.caldera.xyz/api?module=stats&action=ethsupply";
const LTC_API = "https://litecoinspace.org/api/address";
const ABI = ["function attest(uint256,uint256,string) returns (uint256)"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function realData() {
  const addr = process.env.LITECOIN_BRIDGE_ADDRESS;
  const [s, d] = await Promise.all([
    (await fetch(SUPPLY_API)).json(),
    (await fetch(`${LTC_API}/${addr}`)).json(),
  ]);
  return {
    supplyWei: BigInt(s.result),
    sats: BigInt(d.chain_stats.funded_txo_sum) - BigInt(d.chain_stats.spent_txo_sum),
    ref: `litecoinspace:${addr}`,
  };
}

// fire a real attestation in the background (cron attestor wallet)
async function fireAttestation() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC, 4441, { staticNetwork: true });
    const wallet = new ethers.Wallet(process.env.ATTESTOR_PRIVATE_KEY, provider);
    const c = new ethers.Contract(V3, ABI, wallet);
    const { supplyWei, sats, ref } = await realData();
    const tx = await c.attest(sats, supplyWei, ref);
    console.log(`   on-chain attest sent: ${tx.hash}`);
    await tx.wait();
    console.log(`   attest confirmed ✓`);
  } catch (e) {
    console.log(`   (attest skipped: ${e.shortMessage || e.message})`);
  }
}

async function scene(browser, name, fn) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: OUT, size: SIZE },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await fn(page);
  const video = page.video();
  await ctx.close(); // finalizes the .webm
  const tmp = await video.path();
  const dest = path.join(OUT, `${name}.webm`);
  fs.renameSync(tmp, dest);
  console.log(`✓ ${name}.webm`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1 — landing
  await scene(browser, "1-landing", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(2500);
    await page.mouse.wheel(0, 320);
    await sleep(2500);
    await page.mouse.wheel(0, 320);
    await sleep(2500);
  });

  // 2 — reserves (FULLY BACKED, median across 4/4 fresh)
  await scene(browser, "2-reserves", async (page) => {
    await page.goto(`${BASE}/#/reserves`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hero-ratio", { timeout: 20000 }).catch(() => {});
    await sleep(5000); // dwell on the badge + median
    await page.mouse.wheel(0, 260);
    await sleep(3500);
  });

  // 3 — live update: re-open reserves, fire a real attestation, watch it refresh
  await scene(browser, "3-live", async (page) => {
    await page.goto(`${BASE}/#/reserves`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hero-ratio", { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await fireAttestation(); // ~2-6s; WS/poll then refreshes the "last attested"
    await sleep(9000);
  });

  // 4 — history (chart + append-only log)
  await scene(browser, "4-history", async (page) => {
    await page.goto(`${BASE}/#/history`, { waitUntil: "networkidle" });
    await sleep(3500);
    await page.mouse.wheel(0, 320);
    await sleep(3500);
    await page.mouse.wheel(0, 360);
    await sleep(3000);
  });

  await browser.close();
  console.log("\nDONE — clips in", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
