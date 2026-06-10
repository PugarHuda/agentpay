/**
 * Interactive screen-capture of the LIVE AgentPay dashboard on LiteForge.
 * A visible cursor clicks through the nav tabs like a real user, then a
 * verification shot opens the VERIFIED escrow contract on the LiteForge
 * explorer with its real on-chain transaction history.
 *
 * Clips: 1-landing 2-hire 3-work 4-trust 5-verify  (out/ap/)
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { sleep, move, clickSel, moveToSel, scroll, idle, recordScene } = require("./record-lib");

const BASE = "https://agentpay-xi-ten.vercel.app";
const ESCROW = "0x95D0e3c0250d9B4839bB3F7881740b7e6bb0f50D";
const EXPLORER = `https://liteforge.explorer.caldera.xyz/address/${ESCROW}`;
const OUT = path.join(__dirname, "out", "ap");

const tab = (t) => `a:has-text("${t}")`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1 — landing: hero + "N agents working now" livebar
  await recordScene(browser, OUT, "1-landing", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(1800);
    await scroll(page, 300);
    await moveToSel(page, 'a:has-text("Launch App"), a:has-text("Dashboard")'); await sleep(900);
    await scroll(page, 280, 1600);
  });

  // 2 — hire: click the Hire tab, show the marketplace + escrow/stake form
  await recordScene(browser, OUT, "2-hire", async (page) => {
    await page.goto(`${BASE}/#/dashboard`, { waitUntil: "networkidle" });
    await sleep(1200);
    await clickSel(page, tab("Hire"), 2500);
    await sleep(1200);
    await scroll(page, 260, 1800);
    await moveToSel(page, 'button:has-text("Hire"), .agent-card, input').catch(() => {});
    await idle(page, 1800);
  });

  // 3 — work + payment: the real paid-task activity feed
  await recordScene(browser, OUT, "3-work", async (page) => {
    await page.goto(`${BASE}/#/dashboard`, { waitUntil: "networkidle" });
    await sleep(1000);
    await clickSel(page, tab("Activity"), 2500);
    await sleep(1500);
    await scroll(page, 300, 2000);
    await idle(page, 1500);
    await scroll(page, 300, 1800);
  });

  // 4 — trustless both ways: a job detail with the dispute/arbiter lifecycle
  await recordScene(browser, OUT, "4-trust", async (page) => {
    await page.goto(`${BASE}/#/jobs`, { waitUntil: "networkidle" }).catch(() => {});
    await sleep(1200);
    await clickSel(page, '.job-card a, a:has-text("View"), a:has-text("Job #0"), tr a', 2500).catch(() => {});
    await page.goto(`${BASE}/#/job/0`, { waitUntil: "networkidle" }).catch(() => {});
    await sleep(1500);
    await scroll(page, 280, 1900);
    await moveToSel(page, 'button:has-text("Dispute"), button:has-text("Resolve"), .badge').catch(() => {});
    await scroll(page, 260, 1800);
  });

  // 5 — VERIFY: the verified escrow contract + real tx history on the LiteForge explorer
  await recordScene(browser, OUT, "5-verify", async (page) => {
    await page.goto(EXPLORER, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(5500); // let Blockscout render
    await moveToSel(page, 'text=/verified/i, text=/Contract/i').catch(() => {});
    await idle(page, 2000);
    await scroll(page, 320, 2000);
    await scroll(page, 320, 1800);
  });

  await browser.close();
  console.log("\nDONE — clips in", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
