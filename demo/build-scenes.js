/**
 * Reads every voiceover .wav duration and the matching clip, and writes
 * out/scenes.<project>.json — the timeline the Remotion composition renders.
 * Duration is parsed straight from the WAV header (dataChunkBytes / byteRate).
 */
const fs = require("fs");
const path = require("path");

const FPS = 30;
const PAD_TAIL = 0.6; // seconds of breathing room after each line

function wavDurationSeconds(file) {
  const buf = fs.readFileSync(file);
  // walk RIFF chunks to find "fmt " (byteRate) and "data" (size)
  let byteRate = 0, dataSize = 0, off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") { dataSize = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!byteRate) throw new Error(`no fmt chunk in ${file}`);
  return dataSize / byteRate;
}

const PUBLIC = path.join(__dirname, "public");
function copyInto(src, relDest) {
  const dest = path.join(PUBLIC, relDest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return relDest.replace(/\\/g, "/"); // staticFile path
}

function build(project) {
  const voDir = path.join(__dirname, "out", "vo", project);
  const clipDir = path.join(__dirname, "out", project === "grailwatch" ? "gw" : "ap");
  const narration = require("./narration.json")[project];
  const scenes = narration.map((s) => {
    const wav = path.join(voDir, `${s.id}.wav`);
    const clip = path.join(clipDir, `${s.id}.webm`);
    const audioSec = wavDurationSeconds(wav);
    const durSec = audioSec + PAD_TAIL;
    const audioRel = copyInto(wav, path.join("audio", project, `${s.id}.wav`));
    const clipRel = fs.existsSync(clip) ? copyInto(clip, path.join("clips", project, `${s.id}.webm`)) : null;
    return {
      id: s.id,
      caption: s.text,
      audio: audioRel,
      clip: clipRel,
      audioSec: +audioSec.toFixed(2),
      durationInFrames: Math.round(durSec * FPS),
      hasClip: !!clipRel,
    };
  });
  const total = scenes.reduce((a, s) => a + s.durationInFrames, 0);
  const out = { project, fps: FPS, width: 1280, height: 720, scenes, totalFrames: total };
  const dest = path.join(__dirname, "remotion", `scenes.${project}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`${project}: ${scenes.length} scenes, ${(total / FPS).toFixed(1)}s total → ${dest}`);
  scenes.forEach((s) => console.log(`   ${s.id}: ${s.audioSec}s audio, clip=${s.hasClip}`));
}

build("grailwatch");
build("agentpay");
