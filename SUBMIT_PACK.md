# #BuildHybridAI 2026 — SUBMIT PACK (prepare, do NOT submit to Devpost)

**Project:** NanoOrCloud — Stop guessing when to use on-device AI (Web/Chrome)
**Deadline:** Tue 1 Dec 2026 05:00 WIB (Mon 30 Nov 14:00 PT)
**Target category:** Best Web/Chrome App ($3,000); also eligible for Grand / Runner-Ups.

> **NAME CHECK (21 Nov 2026): "Routewise" is heavily used, including
> HarvardMadSys/RouteWise — "Latency–Cost Optimization for Multi-Provider
> LLM Routing" (Python library, EuroSys 2027 paper), the same problem
> space. Also: App Store "Routewise: AI Trip Planner", Google Play
> RouteWise (driver management), theroutewise.com, routewise.dev,
> routewise.app, HopSkipDrive RouteWise AI™, and the Devpost RouteWise
> traffic project. Alternate "SplitLab" is also taken (live A/B testing
> platform, splitlab.io). Alternate "NanoOrCloud" is CLEAN — no exact
> matches found. RECOMMENDATION: rename to NanoOrCloud before creating
> the repo / Devpost project. Renaming now is cheap (strings only).
> DECISION (21 Nov 2026, Day 5): renamed to NanoOrCloud — done in one
> pass (brand constant, title, package name, README, submit pack, video
> script). Directory and Firebase web app nickname stay "routewise" /
> "routewise-web" (internal).**

## 1. English description (for the Devpost form)

**Tagline:** Stop guessing when to use on-device AI. NanoOrCloud runs your prompts on Gemini Nano and the cloud side by side, then tells you what to route where and how much you will save.

**Description:**

NanoOrCloud is a web app that helps developers decide which AI tasks to run
on-device (Gemini Nano in Chrome) and which to send to the cloud. All
inference goes through Firebase AI Logic hybrid inference, with App Check
protecting the cloud path. Developers paste their real prompts, compare
quality, latency and estimated cost side by side, and get a routing
recommendation plus projected monthly savings. It replaces guesswork with
data, so small teams can cut AI costs without hurting quality.

**How Firebase AI Logic is used:** the app uses the Firebase AI Logic
Hybrid Inference SDK for Web (`firebase/ai`). It initialises the Gemini
Developer API backend with `getAI`, creates one model instance per task
with `InferenceMode.ONLY_ON_DEVICE` and one with
`InferenceMode.ONLY_IN_CLOUD`, and calls `generateContent()` on both so
it is unambiguous where each answer came from. A cloud judge model
(`ONLY_IN_CLOUD`) scores the answers with structured JSON output.
`initializeDeviceModel()` runs on the user's click before on-device
requests. App Check protects the Gemini API (debug tokens are used for
local development). Routing thresholds are adjustable sliders with
in-code defaults (0.90 / 0.70); no system prompt is set and Remote Config
is not used.

**Features:**
- Add real task prompts (summarize, classify, extract JSON, rewrite, Q&A) or load the five starter presets
- Side-by-side runner: every task runs on-device and in the cloud, with outputs, latency, estimated cost and errors in one table
- Deterministic checks (non-empty, valid JSON with expected keys, length bounds) plus a cloud judge score (1–5), shown in random A/B order
- Per-task routing recommendation (on-device / escalate / cloud) with confidence and a short reason; thresholds are adjustable sliders
- Savings calculator: monthly cloud cost before and after, and savings, clearly labeled as an estimate
- One-page report with JSON + TypeScript export, copy to clipboard
- Sample report mode (static sample data, labeled SAMPLE) for browsers without the on-device model

**Value proposition:** small teams can cut AI costs without hurting
quality — by measuring, per task, what the on-device model can already
handle. Quality scores are estimates; the app does not claim features
that are not built.

**Built with:** Firebase AI Logic, Firebase App Check, Firebase Hosting,
Gemini Nano, Gemini API, Chrome, TypeScript, React, Vite (list only what
is actually used).

## 2. Links (fill in as they become live)

- Public repo: https://github.com/BaraGitDoodle-bit/nanoorcloud
  (public, MIT license, README complete; Day 1–5 code pushed 21 Nov 2026,
  commit 2988bff224ea4c0858371392c2f529c48c73473b)
- Hosted app: TODO — Firebase Hosting deploy (Day 7)
- Demo video (YouTube, public): TODO — record Day 8 (Sat Nov 28)
- Platform: Web/Chrome

## 3. Submission checklist

- [ ] Public repo with MIT LICENSE (detectable in About)
- [ ] Firebase AI Logic imported AND called at runtime (getAI, getGenerativeModel, generateContent) — in `routewise/src/lib/firebase.ts` + runner
- [ ] App runs end to end with real AI calls (on-device and cloud) — Day 1: F1 in the browser (needs parent's browser task)
- [ ] Hosted URL live (Firebase Hosting, Day 7)
- [ ] Demo video ≤3 min, public on YouTube (Ngadi Ngadi Tech), English + subtitles (Day 8)
- [ ] English description pasted (see §1 above)
- [ ] Platform selected: Web/Chrome
- [ ] Devpost: Built with tags, Try it out links, gallery images (3:2, under 5 MB each)
- [ ] Submit on Devpost before Tue 1 Dec 2026 05:00 WIB (Day 9, Sun Nov 29; buffer Mon Nov 30)
