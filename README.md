# NanoOrCloud — Stop guessing when to use on-device AI

> **#BuildHybridAI 2026 — Best Web/Chrome entry.** NanoOrCloud runs your
> prompts on Gemini Nano and the cloud side by side through Firebase AI
> Logic, then tells you what to route where and how much you will save.

## What it is

Teams adding AI features do not know which tasks a small on-device model
can handle and which need a cloud model. They either send everything to
the cloud (cost, latency, privacy) or guess. NanoOrCloud replaces guesswork
with data: a developer adds real task prompts, runs each one on-device
(Gemini Nano in Chrome) and in the cloud (Gemini), compares quality,
latency and estimated cost side by side, and gets a per-task routing
recommendation (on-device / escalate / cloud) with projected monthly
savings and an exportable config.

## Status (Day 5 — Sat Nov 21)

- [x] F1 Environment check — Chrome version, on-device availability, one
  on-device call and one cloud call returning text in the browser.
- [x] F3 Side-by-side runner (Day 2) — 5 presets run on-device + cloud
  sequentially, progressive results table (output, latency, tokens, est.
  cost, errors), warm-up call, 25-task cap, Cancel. Verified: npm test
  14/14, headless-Chrome check 22/22.
- [x] F2 Task editor + presets (Day 3) — add/edit/delete, 5 starter presets, localStorage persistence
- [x] F4 Scoring (Day 4) — deterministic checks (non-empty, valid JSON with expected keys, length bounds) run as each result arrives; a cloud judge (`ONLY_IN_CLOUD`, structured JSON output) scores each task's two outputs 1–5 in random A/B order (blind — the prompt never says which is on-device/cloud, and treats outputs as data, never instructions). Judge failures are recorded on the scores, never crash the run.
- [x] F5 Routing recommendation (Day 5) — pure routing module
  (`src/lib/routing.ts`): quality ratio (mean judge on-device / cloud,
  capped at 1.0), check pass rate, route on_device / escalate / cloud
  per spec §6, confidence (high ≥3 runs, medium 1–2, low on judge
  failure), short reason per task. Thresholds are sliders (defaults
  0.90 / 0.70) that recompute recommendations live. Report screen shows
  one card row per run task. Verified: 21 routing tests, incl.
  hand-calculated boundary cases.
- [x] F6 Savings calculator (Day 5) — per task S = N × p × c plus
  monthly totals (cloud cost before / after routing, savings), clearly
  labeled as an estimate; shows "—" when prices or volumes are missing
  instead of a fake $0. Verified against hand calculations in tests.
- [x] Rename (Day 5): Routewise → **NanoOrCloud** (user decision) — one
  pass over the brand constant, page title, package name, README, submit
  pack, video script, header/footer. Directory and Firebase web app
  nickname stay `routewise` / `routewise-web` (internal).
- [ ] F7 Report and export (Day 6)
- [ ] F8 Sample report mode (Day 6)

Day 5 verification: npm test 73/73 PASS, npm run build PASS, headless-Chrome UI check 50/50 PASS, 0 unexpected errors.

See `SUBMIT_PACK.md` for the Devpost text and `VIDEO_SCRIPT.md` for the
demo video plan. Full 9-day plan: `Routewise_Product_Spec_and_9-Day_Build_Plan.md`
in the project root (one level up).

## Screenshots

TODO — add after the first hosted deploy (Day 7).

## Requirements

- **Chrome on Desktop 139+** (on-device inference needs the Prompt API).
- Enable the flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
  restart Chrome, and let Gemini Nano download (check status on the Setup
  screen). Without it, cloud-only runs still work.
- Node.js 20+ and npm.

## Setup

1. Copy `.env.example` to `.env` and fill in the Firebase web app config
   (Firebase console > Project settings > Your apps > Web app). The app
   ships with the `routewise-web` app in project `offrecord-4161f`.
2. In the Firebase console, make sure **AI Services > AI Logic** is set up
   with the **Gemini Developer API** provider (free tier). App Check is
   enforced for AI Logic.
3. For local development, run the app, copy the **App Check debug token**
   shown on the Setup screen, and register it in the console under
   **Security > App Check > Apps > Manage debug tokens** (routewise-web app).
4. Never commit `.env` or App Check debug tokens (both are gitignored).

## Run

```bash
npm install
npm run dev      # local dev server (http://localhost:5173)
npm run build    # production build into dist/ (tsc + vite)
npm test         # unit tests
node verification/verify.mjs   # headless-Chrome UI checks + screenshots
```

## Deploy

Firebase Hosting (config in `firebase.json`, `public: dist`):

```bash
npm run build
firebase deploy --only hosting
```

## How Firebase AI Logic is used

All AI calls go through the Firebase AI Logic Hybrid Inference SDK
(`firebase/ai`) — no other AI API is called:

- `getAI` with `GoogleAIBackend` (Gemini Developer API).
- The comparison runner creates one model with
  `InferenceMode.ONLY_ON_DEVICE` and one with `InferenceMode.ONLY_IN_CLOUD`
  per task, so it is unambiguous where each answer came from. Model
  instances are created inside the click handler that starts a run, and
  `initializeDeviceModel()` runs on the user gesture before on-device calls.
- The judge is a cloud model (`ONLY_IN_CLOUD`) scoring answers with
  structured JSON output.
- **App Check** protects the Gemini API (debug tokens for local dev).
- **Remote Config** supplies the routing threshold, default mode, and
  system prompt (in-code defaults, so the app works before console values
  are set).

API names were verified against the official docs
(https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference)
and against the SDK itself: when `InferenceMode` is set,
`getGenerativeModel` ignores top-level `model` / `systemInstruction` /
`generationConfig` — they must go inside `onDeviceParams` /
`inCloudParams` (see `src/lib/firebase.ts`).

## Limitations

- On-device inference only works in Chrome on Desktop 139+ with the
  Prompt API flag and the model downloaded; everywhere else the app runs
  cloud-only and points to the sample report.
- On-device generation is single-turn text only (no chat, no tools, no
  image/audio/video input).
- Judge scores and savings are estimates — the UI labels them as such.
- Token counts are estimated as characters / 4 when the response does not
  expose usage metadata; prices are entered by the user, never hard-coded.

## License

MIT — see `LICENSE`.
