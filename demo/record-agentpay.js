/**
 * Records real screen-capture B-roll of the LIVE AgentPay dashboard on
 * LiteForge, one .webm clip per scene, into out/ap/. Shows real on-chain state
 * (jobs, paid tasks, the agent marketplace, the dispute/arbiter UI).
 *
 * Output: 1-landing.webm 2-hire.webm 3-work.webm 4-trust.webm
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "https://agentpay-xi-ten.vercel.app";
const OUT = path.join(__dirname, "out", "ap");
const SIZE = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scene(browser, name, fn) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: OUT, size: SIZE },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await fn(page);
  const video = page.video();
  await ctx.close();
  fs.renameSync(await video.path(), path.join(OUT, `${name}.webm`));
  console.log(`✓ ${name}.webm`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1 — landing (hero + "N agents working now" livebar)
  await scene(browser, "1-landing", async (page) => {
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    await sleep(2500);
    await page.mouse.wheel(0, 340);
    await sleep(2500);
    await page.mouse.wheel(0, 340);
    await sleep(2500);
  });

  // 2 — hire an agent (marketplace + escrow/stake form)
  await scene(browser, "2-hire", async (page) => {
    await page.goto(`${BASE}/#/hire`, { waitUntil: "networkidle" });
    await sleep(4000);
    await page.mouse.wheel(0, 300);
    await sleep(4000);
  });

  // 3 — work + payment (real paid-task activity feed)
  await scene(browser, "3-work", async (page) => {
    await page.goto(`${BASE}/#/activity`, { waitUntil: "networkidle" });
    await sleep(4500);
    await page.mouse.wheel(0, 320);
    await sleep(4500);
  });

  // 4 — trustless both ways (job detail: task lifecycle + dispute/arbiter)
  await scene(browser, "4-trust", async (page) => {
    await page.goto(`${BASE}/#/job/0`, { waitUntil: "networkidle" });
    await sleep(4000);
    await page.mouse.wheel(0, 340);
    await sleep(4000);
  });

  await browser.close();
  console.log("\nDONE — clips in", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
