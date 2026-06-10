/**
 * Builds the combined-video timeline per project: each scene's visual is either
 * a pitch-deck slide image or a live-demo clip; narration is natural neural TTS.
 * Reads each mp3's real duration, copies assets into public/, and writes
 * remotion/scenes.<project>.json.
 */
const fs = require("fs");
const path = require("path");
const mm = require("music-metadata");

const FPS = 30;
const PAD_TAIL = 0.7; // seconds of breathing room after each line
const PUBLIC = path.join(__dirname, "public");
const narration = require("./narration.json");

function copyInto(src, relDest) {
  const dest = path.join(PUBLIC, relDest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return relDest.replace(/\\/g, "/");
}

async function build(project) {
  const { scenes } = narration[project];
  const voDir = path.join(__dirname, "out", "vo", project);
  const slideDir = path.join(__dirname, "out", "slides", project);
  const clipDir = path.join(__dirname, "out", project === "grailwatch" ? "gw" : "ap");

  const out = [];
  for (const s of scenes) {
    const mp3 = path.join(voDir, `${s.id}.mp3`);
    const audioSec = (await mm.parseFile(mp3)).format.duration;
    const audioRel = copyInto(mp3, path.join("audio", project, `${s.id}.mp3`));

    let visualType, visualSrc;
    if (s.visual.type === "slide") {
      visualType = "slide";
      const png = path.join(slideDir, `slide-${s.visual.n}.png`);
      visualSrc = copyInto(png, path.join("slides", project, `slide-${s.visual.n}.png`));
    } else {
      visualType = "clip";
      const webm = path.join(clipDir, `${s.visual.id}.webm`);
      visualSrc = copyInto(webm, path.join("clips", project, `${s.visual.id}.webm`));
    }

    out.push({
      id: s.id,
      visualType,
      visualSrc,
      caption: s.caption || null,
      audio: audioRel,
      audioSec: +audioSec.toFixed(2),
      durationInFrames: Math.round((audioSec + PAD_TAIL) * FPS),
    });
  }

  const total = out.reduce((a, s) => a + s.durationInFrames, 0);
  const data = { project, fps: FPS, width: 1280, height: 720, scenes: out, totalFrames: total };
  const dest = path.join(__dirname, "remotion", `scenes.${project}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(data, null, 2));
  console.log(`${project}: ${out.length} scenes, ${(total / FPS).toFixed(1)}s total`);
  out.forEach((s) => console.log(`   ${s.id} [${s.visualType}]: ${s.audioSec}s`));
}

(async () => {
  await build("grailwatch");
  await build("agentpay");
})().catch((e) => { console.error(e); process.exit(1); });
