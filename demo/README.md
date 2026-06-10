# Demo video pipeline

Auto-generates the demo video from **real** screen-capture of the live app on
LiteForge + a voiceover + captions — no paid APIs, all local.

`<Project>-demo.mp4` in this folder is the rendered result (~61s, 720p, voiceover).

## How it's made

1. **Capture** — Playwright records real B-roll of the live dashboard, one clip
   per scene. The GrailWatch "live" scene fires a *real on-chain attestation*
   mid-record so the dashboard updates on camera.
   ```
   node record-grailwatch.js     # → out/gw/*.webm
   node record-agentpay.js       # → out/ap/*.webm
   ```
2. **Voiceover** — Windows SAPI (offline TTS) renders narration from
   `narration.json`:
   ```
   powershell -File tts.ps1 -Project grailwatch
   powershell -File tts.ps1 -Project agentpay
   ```
3. **Timeline** — copies assets into `public/` and computes per-scene durations:
   ```
   node build-scenes.js          # → remotion/scenes.<project>.json
   ```
4. **Render** — Remotion composes chrome + clip + caption + voiceover → mp4:
   ```
   npx remotion render remotion/index.jsx GrailWatch GrailWatch-demo.mp4
   npx remotion render remotion/index.jsx AgentPay  AgentPay-demo.mp4
   ```

## Setup
```
npm install
node node_modules/esbuild/install.js   # if esbuild's postinstall was skipped
```

To change the script, edit `narration.json` and re-run steps 2–4.
Generated artifacts (`out/`, `public/`, `node_modules/`, scene JSON) are gitignored;
the committed `.mp4` is the deliverable.
