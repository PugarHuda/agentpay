/** Screenshots every slide of a project's pitch deck to out/slides/<project>/slide-N.png. */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const DECKS = {
  grailwatch: path.join(__dirname, "..", "grailwatch", "slide", "index.html"),
  agentpay: path.join(__dirname, "..", "agentpay", "slide", "index.html"),
};
const SIZE = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  for (const [project, file] of Object.entries(DECKS)) {
    const dir = path.join(__dirname, "out", "slides", project);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.goto("file://" + file.replace(/\\/g, "/"));
    await sleep(1200);
    const count = await page.locator(".slide").count();
    for (let i = 1; i <= count; i++) {
      await sleep(700);
      await page.screenshot({ path: path.join(dir, `slide-${i}.png`) });
      await page.keyboard.press("ArrowRight");
    }
    await ctx.close();
    console.log(`${project}: captured ${count} slides → ${dir}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
