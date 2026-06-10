# Demo video + pitch deck pipeline

Auto-generates **one combined video per project** — the pitch deck (narrated
slides) flowing straight into the live, interactive on-chain demo — plus a PDF
of the deck. Natural neural voiceover, no paid APIs.

Deliverables (rendered into each repo): `demo/<Project>-demo.mp4` (~85s, 720p,
voiceover) and `slide/<Project>-pitch-deck.pdf`.

## How it's made

1. **Live capture** — Playwright drives the live app with a *visible cursor*
   (clicks through nav tabs, a verification shot opening litecoinspace / the
   LiteForge explorer); GrailWatch fires a real on-chain attestation mid-record.
   ```
   node record-grailwatch.js     # → out/gw/*.webm
   node record-agentpay.js       # → out/ap/*.webm
   ```
2. **Deck slides** — screenshot every pitch-deck slide:
   ```
   node capture-deck.js          # → out/slides/<project>/slide-N.png
   ```
3. **Natural voiceover** — Microsoft Edge neural TTS (free, no key), one mp3 per
   scene from `narration.json` (GrailWatch = Aria, AgentPay = Guy):
   ```
   node tts-edge.js              # → out/vo/<project>/*.mp3
   ```
4. **Timeline** — read mp3 durations, copy assets to `public/`, write
   `remotion/scenes.<project>.json` (each scene = a deck slide OR a live clip):
   ```
   node build-scenes.js
   ```
5. **Render** — Remotion composes slides full-bleed + live clips in neobrutalism
   chrome with captions:
   ```
   npx remotion render remotion/index.jsx GrailWatch out/GrailWatch-demo.mp4
   npx remotion render remotion/index.jsx AgentPay  out/AgentPay-demo.mp4
   ```
6. **PDF deck** — assemble the slide PNGs into a 16:9 PDF:
   ```
   node pdf-deck.js              # → out/<Project>-pitch-deck.pdf
   ```

## Setup
```
npm install
node node_modules/esbuild/install.js   # if esbuild's postinstall was skipped
```
Edit `narration.json` to change the script, then re-run steps 3–5.
Generated artifacts (`out/`, `public/`, `node_modules/`, scene JSON) are gitignored;
the committed `.mp4` and `.pdf` are the deliverables.
