/** Assembles the captured slide PNGs into a landscape 16:9 PDF per project. */
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

const OUT = { grailwatch: "GrailWatch-pitch-deck.pdf", agentpay: "AgentPay-pitch-deck.pdf" };
const W = 1280, H = 720;

(async () => {
  for (const [project, name] of Object.entries(OUT)) {
    const dir = path.join(__dirname, "out", "slides", project);
    const pngs = fs.readdirSync(dir).filter((f) => /^slide-\d+\.png$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
    const pdf = await PDFDocument.create();
    for (const f of pngs) {
      const img = await pdf.embedPng(fs.readFileSync(path.join(dir, f)));
      const page = pdf.addPage([W, H]);
      page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    }
    const dest = path.join(__dirname, "out", name);
    fs.writeFileSync(dest, await pdf.save());
    console.log(`${project}: ${pngs.length} slides → ${name} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
