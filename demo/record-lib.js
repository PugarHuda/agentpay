/** Shared helpers: a VISIBLE animated cursor + click ripple injected into the
 * page (Playwright's recorder doesn't capture the OS cursor), plus smooth
 * move/click/scroll primitives so the demo looks like a real person driving it. */
const path = require("path");
const fs = require("fs");

const SIZE = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// runs at document start on every navigation; paints a fake cursor that follows
// real mouse events + a ripple on mousedown.
function cursorInit() {
  if (window.__cur) return;
  window.__cur = true;
  const css = document.createElement("style");
  css.textContent =
    "#__c{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;" +
    "background:rgba(91,141,239,.30);border:3px solid #0b0b0b;box-shadow:2px 2px 0 #0b0b0b;" +
    "z-index:2147483647;pointer-events:none;left:-200px;top:-200px;transition:left .06s linear,top .06s linear}";
  const add = () => {
    if (!document.body) return;
    document.head.appendChild(css);
    const c = document.createElement("div");
    c.id = "__c";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText =
        "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:14px;height:14px;" +
        "margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #0b0b0b;z-index:2147483647;" +
        "pointer-events:none;transition:all .45s ease-out";
      document.body.appendChild(r);
      requestAnimationFrame(() => {
        r.style.width = "56px"; r.style.height = "56px"; r.style.margin = "-28px 0 0 -28px"; r.style.opacity = "0";
      });
      setTimeout(() => r.remove(), 470);
    }, true);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
}

let cursor = { x: SIZE.width / 2, y: SIZE.height / 2 };

async function move(page, x, y, steps = 26) {
  await page.mouse.move(x, y, { steps });
  cursor = { x, y };
}

async function moveToSel(page, sel) {
  try {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    const box = await el.boundingBox();
    if (box) { await move(page, box.x + box.width / 2, box.y + Math.min(box.height / 2, 24)); return true; }
  } catch {}
  return false;
}

async function clickSel(page, sel, settle = 1200) {
  const ok = await moveToSel(page, sel);
  await sleep(280);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(settle);
  return ok;
}

async function scroll(page, dy, ms = 1400) {
  await page.mouse.wheel(0, dy);
  await sleep(ms);
}

// jiggle the cursor a little so static dwells don't feel frozen
async function idle(page, ms = 1500) {
  const { x, y } = cursor;
  await move(page, x + 60, y + 30, 18); await sleep(ms / 2);
  await move(page, x - 20, y - 10, 18); await sleep(ms / 2);
}

/** record one scene to its own .webm, with the cursor overlay installed */
async function recordScene(browser, outDir, name, fn) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: outDir, size: SIZE },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(cursorInit);
  const page = await ctx.newPage();
  cursor = { x: SIZE.width / 2, y: SIZE.height / 2 };
  try { await fn(page); } catch (e) { console.log(`   (scene ${name} warning: ${e.message})`); }
  const video = page.video();
  await ctx.close();
  fs.renameSync(await video.path(), path.join(outDir, `${name}.webm`));
  console.log(`✓ ${name}.webm`);
}

module.exports = { SIZE, sleep, move, moveToSel, clickSel, scroll, idle, recordScene };
