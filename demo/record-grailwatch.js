/**
 * Interactive screen-capture of the LIVE GrailWatch dashboard on LiteForge.
 * A visible cursor clicks through the app like a real user, INCLUDING a
 * verification shot that opens the real Litecoin address on a public explorer.
 * Mid-demo it fires a REAL on-chain attestation so the dashboard updates live.
 *
 * Clips: 1-landing 2-reserves 3-verify 4-live 5-history  (out/gw/)
 */
const { chromium } = require("playwright");
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
const { sleep, move, clickSel, moveToSel, scroll, idle, recordScene } = require("./record-lib");
require("dotenv").config({ path: path.join(__dirname, "..", "grailwatch", ".env") });

const BASE = "https://grailwatch-mauve.vercel.app";
const LTC_ADDR = process.env.LITECOIN_BRIDGE_ADDRESS || "MQd1fJwqBJvwLuyhr17PhEFx1swiqDbPQS";
const LTC_EXPLORER = `https://litecoinspace.org/address/${LTC_ADDR}`;
const OUT = path.join(__dirname, "out", "gw");
const V3 = "0xf099F039f8206C4C2BF91120A913a1F138fBAfcB";
const RPC = "https://liteforge.rpc.caldera.xyz/http";
const SUPPLY_API = "https://liteforge.explorer.caldera.xyz/api?module=stats&action=ethsupply";
const LTC_API = "https://litecoinspace.org/api/address";
const ABI = ["function attest(uint256,uint256,string) returns (uint256)"];

async function fireAttestation() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC, 4441, { staticNetwork: true });
    const wallet = new ethers.Wallet(process.env.ATTESTOR_PRIVATE_KEY, provider);
    const [s, d] = await Promise.all([
      (await fetch(SUPPLY_API)).json(),
      (await fetch(`${LTC_API}/${LTC_ADDR}`)).json(),
    ]);
    const sats = BigInt(d.chain_stats.funded_txo_sum) - BigInt(d.chain_stats.spent_txo_sum);
    const tx = await new ethers.Contract(V3, ABI, wallet).attest(sats, BigInt(s.result), `litecoinspace:${LTC_ADDR}`);
    console.log(`   on-chain attest: ${tx.hash}`);
    await tx.wait();
  } catch (e) { console.log(`   (attest skipped: ${e.shortMessage || e.message})`); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1 — landing: read the hero, hover the CTA
  await recordScene(browser, OUT, "1-landing", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(1800);
    await scroll(page, 280);
    await moveToSel(page, "text=View live reserves"); await sleep(900);
    await scroll(page, 260, 1600);
  });

  // 2 — reserves: click the Reserves tab, dwell on the median badge
  await recordScene(browser, OUT, "2-reserves", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(1200);
    await clickSel(page, 'a.tab:has-text("Reserves"), a:has-text("View live reserves")', 2500);
    await page.waitForSelector(".hero-ratio", { timeout: 15000 }).catch(() => {});
    await moveToSel(page, ".hero-badge"); await sleep(1500);
    await moveToSel(page, ".hero-ratio"); await idle(page, 2000);
    await scroll(page, 240, 1800);
  });

  // 3 — VERIFY: click the "verify" link, then show the real LTC balance on a public explorer
  await recordScene(browser, OUT, "3-verify", async (page) => {
    await page.goto(`${BASE}/#/reserves`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hero-ratio", { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    await moveToSel(page, 'a:has-text("verify")'); await sleep(600);
    await page.mouse.down(); await sleep(90); await page.mouse.up(); // click ripple on the verify link
    await sleep(500);
    await page.goto(LTC_EXPLORER, { waitUntil: "domcontentloaded" }).catch(() => {});
    // wait for litecoinspace to actually populate the real balance (slow SPA)
    await page
      .waitForFunction(() => /[\d,]{7,}/.test(document.body.innerText) && /LTC/i.test(document.body.innerText), { timeout: 22000 })
      .catch(() => {});
    await sleep(2500);
    await moveToSel(page, "text=/[\\d,]{7,}\\s*LTC/i").catch(() => {});
    await idle(page, 3500); // dwell on the real reserve number
  });

  // 4 — LIVE: fire a real attestation, watch "last attested" refresh
  await recordScene(browser, OUT, "4-live", async (page) => {
    await page.goto(`${BASE}/#/reserves`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hero-ratio", { timeout: 15000 }).catch(() => {});
    await idle(page, 1500);
    await fireAttestation();
    await moveToSel(page, ".hero-meta"); await sleep(8000); // WS/poll refresh lands
  });

  // 5 — history: click the History tab, scroll chart + append-only log
  await recordScene(browser, OUT, "5-history", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(1000);
    await clickSel(page, 'a.tab:has-text("History")', 2500);
    await sleep(1500);
    await scroll(page, 300, 2000);
    await moveToSel(page, ".table-card, table").catch(() => {});
    await scroll(page, 320, 2000);
  });

  await browser.close();
  console.log("\nDONE — clips in", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
