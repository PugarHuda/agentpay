/** Natural neural voiceover via Microsoft Edge TTS (free, no API key).
 * Reads narration.json and writes one mp3 per scene into out/vo/<project>/. */
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const fs = require("fs");
const path = require("path");

const narration = require("./narration.json");

async function synth(tts, text, dest) {
  const r = tts.toStream(text);
  const stream = r.audioStream || r;
  const out = fs.createWriteStream(dest);
  await new Promise((res, rej) => {
    stream.pipe(out);
    stream.on("end", res);
    stream.on("error", rej);
    out.on("error", rej);
  });
}

(async () => {
  for (const project of Object.keys(narration)) {
    const { voice, scenes } = narration[project];
    const dir = path.join(__dirname, "out", "vo", project);
    fs.mkdirSync(dir, { recursive: true });
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    console.log(`${project} — voice ${voice}`);
    for (const s of scenes) {
      const dest = path.join(dir, `${s.id}.mp3`);
      await synth(tts, s.text, dest);
      console.log(`  ${s.id}.mp3 (${fs.statSync(dest).size} bytes)`);
    }
  }
  console.log("EDGE TTS DONE");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
