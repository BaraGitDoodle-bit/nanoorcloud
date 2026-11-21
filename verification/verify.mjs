// Headless-Chrome verification for the NanoOrCloud built app (Day 3: F2).
// Serves dist/ over HTTP, loads it, and checks rendering + UI wiring.
// Run: node verification/verify.mjs  (from routewise/)
//
// Note: this VM's headless Chrome has no Gemini Nano (LanguageModel is
// undefined) and cannot do TLS to Google (egress MITM breaks BoringSSL),
// so on-device rows show N/A and cloud calls fail with a network error
// here. Both are environmental, not app bugs: the check verifies the run
// progresses row by row, errors surface in the table instead of crashing,
// and Cancel stops the run. The live calls are proven in a real browser
// (parent's browser task).
import { chromium } from "playwright-core";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const OUT = new URL("../verification/", import.meta.url).pathname;
const PORT = 4182;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const data = await readFile(join(DIST, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));
console.log(`serving dist/ on http://127.0.0.1:${PORT}`);

const browser = await chromium.launch({
  executablePath: "/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const failures = [];
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  // Day 6: the export copy buttons use navigator.clipboard.
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
// Network noise: this VM's headless Chrome cannot do TLS to Google, so the
// Firebase SDK's on-load requests (reCAPTCHA, Installations, App Check,
// Remote Config) fail with net::ERR_* / "Failed to fetch". Those are
// environmental, not app bugs: the app itself makes no network call on
// load. Filter exactly those messages; everything else still fails.
const isNetworkNoise = (text) =>
  /Failed to load resource: net::ERR_/.test(text) ||
  /^TypeError: Failed to fetch/.test(text);
page.on("console", (msg) => {
  if (msg.type() === "error") {
    if (isNetworkNoise(msg.text())) {
      console.log(`(ignored network-noise console error: ${msg.text().split("\n")[0]})`);
    } else {
      failures.push(`console error: ${msg.text()}`);
    }
  }
});
page.on("pageerror", (err) => failures.push(`page error: ${err.message}`));
page.on("requestfailed", (req) => {
  // Same-origin failures are app bugs; cross-origin (Google) failures are
  // the VM's TLS limitation — log them, don't fail on them.
  if (req.url().includes("127.0.0.1")) {
    failures.push(`request failed: ${req.url()} ${req.failure()?.errorText}`);
  } else {
    console.log(`(ignored cross-origin request failure: ${req.url()})`);
  }
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const checks = [];
const check = (name, ok, extra = "") => {
  checks.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

// ---- Day 1: Setup / F1 (unchanged) ----
check("title", (await page.title()).includes("NanoOrCloud"), await page.title());
check("header visible", await page.locator("h1").first().isVisible());
check(
  "header shows the new name NanoOrCloud",
  (await page.locator("h1").first().textContent()).includes("NanoOrCloud"),
  await page.locator("h1").first().textContent(),
);
check(
  "chrome version shown",
  (await page.locator(".status-list").textContent()).includes("Chrome"),
  await page.locator(".status-list").textContent().then((t) => t.slice(0, 120)),
);
check(
  "on-device status mentions unavailability",
  (await page.locator(".status-list").textContent()).match(/unavailable|unknown/i) != null,
);
check(
  "firebase configured status shown",
  (await page.locator(".status-list").textContent()).includes("offrecord-4161f"),
);
check(
  "cloud test button present and enabled",
  await page.locator("#test-cloud-btn").isEnabled(),
);
check(
  "on-device test button disabled without Nano (expected)",
  await page.locator("#test-device-btn").isDisabled(),
);

// Cloud test: in this VM it fails on the network (TLS) — the check is that
// the failure surfaces in the UI instead of crashing the app.
await page.locator("#test-cloud-btn").click();
await page.waitForTimeout(8000);
const cloudResult = await page.locator("#cloud-test-result").textContent();
check(
  "cloud test surfaces a result (error expected in this VM)",
  cloudResult.length > 10,
  cloudResult.slice(0, 120),
);
check(
  "cloud test result is a failure message here (not a crash)",
  /failed|error/i.test(cloudResult),
  cloudResult.slice(0, 120),
);

// ---- Day 2: Run screen / F3 ----
await page.locator("nav button", { hasText: "3 · Run" }).click();
await page.waitForTimeout(800);
check(
  "Run screen heading shown",
  (await page.locator("main").textContent()).includes("Run — side by side"),
);
const taskItems = await page.locator("#run-task-list li").count();
check("5 preset tasks listed", taskItems === 5, `count=${taskItems}`);
check(
  "cloud-only note shown without Nano (expected)",
  (await page.locator("#cloud-only-note").textContent()).match(/cloud-only/i) != null,
);
check(
  "run-all button present and enabled",
  await page.locator("#run-all-btn").isEnabled(),
);
check(
  "price inputs present (cost needs user prices)",
  (await page.locator("#run-settings input").count()) === 3,
);

// Start a run: on-device rows are instant N/A here, cloud calls fail on
// the VM's TLS after a few seconds each (with one retry). Wait until at
// least 2 result rows exist — that proves results appear progressively —
// then Cancel and confirm the run stops.
await page.locator("#run-all-btn").click();
let rows = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  rows = await page.locator("#results-table tbody tr").count();
  if (rows >= 2) break;
}
check("results appear progressively (≥2 rows)", rows >= 2, `rows=${rows}`);
const tableText = await page.locator("#results-table").textContent();
check(
  "on-device rows marked N/A without Nano",
  /N\/A/.test(tableText),
  tableText.slice(0, 160),
);
check(
  "cancel button visible while running",
  await page.locator("#cancel-run-btn").isVisible(),
);
await page.locator("#cancel-run-btn").click();
await page.waitForTimeout(2500);
const summaryText = await page.locator("#run-summary").textContent().catch(() => "");
check(
  "cancel stops the run (summary says Cancelled)",
  /Cancelled/.test(summaryText),
  summaryText.slice(0, 120),
);
check(
  "run-all button re-enabled after cancel",
  await page.locator("#run-all-btn").isEnabled(),
);
const rowsAfterCancel = await page.locator("#results-table tbody tr").count();
await page.waitForTimeout(5000);
const rowsLater = await page.locator("#results-table tbody tr").count();
check(
  "no new rows after cancel",
  rowsLater === rowsAfterCancel,
  `rows=${rowsAfterCancel} -> ${rowsLater}`,
);

// ---- Day 4: Scoring / F4 ----
// In this VM every call fails (no Nano; cloud fails on TLS), so the
// scores must show deterministic-check failures and a clear
// "Not judged" reason — never a crash, never a bare spinner.
const finalTableText = await page.locator("#results-table").textContent();
check(
  "Score column present",
  (await page.locator("#results-table thead").textContent()).includes("Score"),
);
check(
  "deterministic checks shown for errored rows",
  /Checks failed/.test(finalTableText) && /Call failed/.test(finalTableText),
  finalTableText.slice(0, 200),
);
check(
  "judge skip shown clearly (Not judged)",
  /Not judged/.test(finalTableText),
  finalTableText.slice(0, 200),
);
const finalSummary = await page
  .locator("#run-summary")
  .textContent()
  .catch(() => "");
check(
  "summary reports scoring counts",
  /judge score/.test(finalSummary) &&
    /deterministic checks/.test(finalSummary),
  finalSummary.slice(0, 200),
);

// ---- Day 5: Report / F5 + F6 ----
// In this VM every call failed (no Nano; cloud fails on TLS) and the
// judge was skipped, so every recommendation must be Cloud with low
// confidence and a clear "Judge failed" reason — never a crash, never
// an invented route. Prices are unset here, so savings must ask for
// prices instead of showing $0 as if it were real.
check(
  "Report nav button present and enabled",
  await page.locator("nav button", { hasText: "4 · Report" }).isEnabled(),
);
await page.locator("nav button", { hasText: "4 · Report" }).click();
await page.waitForTimeout(800);
check(
  "Report heading shown",
  (await page.locator("main").textContent()).includes(
    "Report — routing",
  ),
);
check(
  "threshold sliders present",
  (await page.locator("#threshold-quality").count()) === 1 &&
    (await page.locator("#threshold-escalate").count()) === 1,
);
const recRows = await page
  .locator("#recommendations-table tbody tr")
  .count();
check("recommendations shown for run tasks", recRows >= 1, `rows=${recRows}`);
const recText = await page
  .locator("#recommendations-table")
  .textContent();
check(
  "failed-judge tasks route Cloud with low confidence",
  /Cloud/.test(recText) && /low/.test(recText),
  recText.slice(0, 200),
);
check(
  "recommendation reason names the failed judge",
  /Judge failed/.test(recText),
  recText.slice(0, 200),
);
check(
  "savings ask for prices instead of showing $0",
  await page.locator("#savings-no-prices").isVisible(),
);
check(
  "estimate disclaimer shown",
  (await page.locator("#savings-estimate-note").textContent()).match(
    /estimates/i,
  ) != null,
);
// Moving a threshold slider recomputes live: set quality to 95% and
// the label must follow. (The route stays Cloud here — no judge data —
// so the label is the observable effect.) NOTE: set the value through
// the native HTMLInputElement setter — a plain `el.value = ...` updates
// React's value tracker, so React would see no change and skip onChange.
await page.locator("#threshold-quality").evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, "0.95");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(300);
check(
  "quality slider updates live (label follows to 95%)",
  (await page.locator("#report-thresholds").textContent()).includes("95%"),
);

// ---- Day 6: Export / F7 + sample mode / F8 (on the real report) ----
// The sample toggle must be visible even with real results, and entering
// sample mode must swap in the bundled demo run (mixed routes, priced
// savings) without touching the real snapshot.
check(
  "view-sample button present on the Report screen",
  await page.locator("#view-sample-btn").isVisible(),
);
await page.locator("#view-sample-btn").click();
await page.waitForTimeout(500);
check(
  "sample banner visible and labeled SAMPLE",
  (await page.locator("#sample-banner").textContent()).match(/SAMPLE REPORT/i) != null,
  (await page.locator("#sample-banner").textContent()).slice(0, 120),
);
const sampleRecRows = await page
  .locator("#recommendations-table tbody tr")
  .count();
check("sample report shows 5 recommendations", sampleRecRows === 5, `rows=${sampleRecRows}`);
const sampleRecText = await page
  .locator("#recommendations-table")
  .textContent();
check(
  "sample shows mixed routes (On-device + Escalate)",
  /On-device/.test(sampleRecText) && /Escalate/.test(sampleRecText),
  sampleRecText.slice(0, 200),
);
const sampleSavings = await page.locator("#savings-summary").textContent();
check(
  "sample savings show dollar amounts (prices are set in the sample)",
  /Cloud cost before routing/.test(sampleSavings) && /\$/.test(sampleSavings),
  sampleSavings.slice(0, 160),
);
check(
  "export buttons present (4)",
  (await page.locator("#export-buttons button").count()) === 4,
  `count=${await page.locator("#export-buttons button").count()}`,
);

// Download JSON: filename + content (must be labeled sample, 5 recs).
const jsonDownloadPromise = page.waitForEvent("download");
await page.locator("#export-json-download").click();
const jsonDownload = await jsonDownloadPromise;
check(
  "JSON download filename (sample)",
  jsonDownload.suggestedFilename() === "nanoorcloud-report-sample.json",
  jsonDownload.suggestedFilename(),
);
const jsonText = await readFile(await jsonDownload.path(), "utf-8");
const jsonReport = JSON.parse(jsonText);
check(
  "downloaded JSON is a labeled sample report (5 recommendations)",
  jsonReport.app === "NanoOrCloud" &&
    jsonReport.sample === true &&
    jsonReport.recommendations.length === 5,
  `app=${jsonReport.app} sample=${jsonReport.sample} recs=${jsonReport.recommendations.length}`,
);

// Copy JSON: status text + clipboard content.
await page.locator("#export-json-copy").click();
await page.waitForTimeout(400);
const copyStatus = await page.locator("#export-status").textContent();
const clipboardJson = await page.evaluate(() => navigator.clipboard.readText());
check(
  "copy JSON reports success and clipboard holds the report",
  /copied to clipboard/i.test(copyStatus) &&
    JSON.parse(clipboardJson).sample === true,
  copyStatus.slice(0, 80),
);

// Copy TS: status + clipboard holds the routing config.
await page.locator("#export-ts-copy").click();
await page.waitForTimeout(400);
const copyTsStatus = await page.locator("#export-status").textContent();
const clipboardTs = await page.evaluate(() => navigator.clipboard.readText());
check(
  "copy TS reports success and clipboard holds the config",
  /copied to clipboard/i.test(copyTsStatus) &&
    /export const routingConfig/.test(clipboardTs) &&
    /PREFER_ON_DEVICE/.test(clipboardTs),
  copyTsStatus.slice(0, 80),
);

// Download TS: filename + content.
const tsDownloadPromise = page.waitForEvent("download");
await page.locator("#export-ts-download").click();
const tsDownload = await tsDownloadPromise;
check(
  "TS download filename (sample)",
  tsDownload.suggestedFilename() === "nanoorcloud-routing-config-sample.ts",
  tsDownload.suggestedFilename(),
);
const tsText = await readFile(await tsDownload.path(), "utf-8");
check(
  "downloaded TS config has all three modes",
  /export const routingConfig/.test(tsText) &&
    /PREFER_ON_DEVICE/.test(tsText) &&
    /ESCALATE/.test(tsText) &&
    /ONLY_IN_CLOUD/.test(tsText),
  tsText.slice(0, 160),
);
check(
  "TS preview shows the config inline",
  (await page.locator("#export-ts-preview").textContent()).match(
    /PREFER_ON_DEVICE/,
  ) != null,
);

// Back to my report: the real (failed-judge) report returns, banner gone.
await page.locator("#exit-sample-btn").click();
await page.waitForTimeout(400);
check(
  "exit sample returns to the real report (banner gone, Judge failed back)",
  (await page.locator("#sample-banner").count()) === 0 &&
    /Judge failed/.test(await page.locator("#recommendations-table").textContent()),
);

// Back to Run: the results table must be restored from the snapshot
// (the screen unmounts on tab switches).
await page.locator("nav button", { hasText: "3 · Run" }).click();
await page.waitForTimeout(500);
const restoredRows = await page
  .locator("#results-table tbody tr")
  .count();
check(
  "Run results restored after visiting Report",
  restoredRows >= 2,
  `rows=${restoredRows}`,
);

// ---- Day 3: Tasks editor / F2 ----
await page.locator("nav button", { hasText: "2 · Tasks" }).click();
await page.waitForTimeout(500);
check(
  "Tasks editor heading shown",
  (await page.locator("main").textContent()).includes("Tasks — editor"),
);
check(
  "5 preset tasks listed in the editor",
  (await page.locator("#task-list li").count()) === 5,
  `count=${await page.locator("#task-list li").count()}`,
);

// Empty form must not add a task — validation errors show instead.
await page.locator("#task-save-btn").click();
await page.waitForTimeout(300);
check(
  "empty add shows validation errors, adds nothing",
  (await page.locator("#task-form-errors").isVisible()) &&
    (await page.locator("#task-list li").count()) === 5,
  (await page.locator("#task-form-errors").textContent()).slice(0, 120),
);

// Add a task from the editor.
await page.locator("#task-name").fill("UI check task");
await page.locator("#task-type").selectOption("qa");
await page
  .locator("#task-prompt")
  .fill("What is 2 + 2? Answer with a number only.");
await page.locator("#task-monthly").fill("500");
await page.locator("#task-save-btn").click();
await page.waitForTimeout(300);
check(
  "added task appears in the editor (6 tasks)",
  (await page.locator("#task-list li").count()) === 6 &&
    (await page.locator("#task-list").textContent()).includes(
      "UI check task",
    ),
  `count=${await page.locator("#task-list li").count()}`,
);

// The Run screen must use the edited list, not hard-coded presets.
await page.locator("nav button", { hasText: "3 · Run" }).click();
await page.waitForTimeout(500);
check(
  "Run screen lists the edited task list (6 tasks)",
  (await page.locator("#run-task-list li").count()) === 6 &&
    (await page.locator("#run-task-list").textContent()).includes(
      "UI check task",
    ),
  `count=${await page.locator("#run-task-list li").count()}`,
);

// Persistence: reload — the added task must still be there.
await page.locator("nav button", { hasText: "2 · Tasks" }).click();
await page.waitForTimeout(300);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "2 · Tasks" }).click();
await page.waitForTimeout(500);
check(
  "added task persists across reload (6 tasks)",
  (await page.locator("#task-list li").count()) === 6,
  `count=${await page.locator("#task-list li").count()}`,
);

// Edit the added task.
const newRow = page.locator("#task-list li", { hasText: "UI check task" });
await newRow.locator('button[data-action="edit"]').click();
await page.waitForTimeout(300);
check(
  "edit form shows the task name",
  (await page.locator("#task-form-heading").textContent()).includes(
    "UI check task",
  ),
);
await page.locator("#task-name").fill("UI check task (edited)");
await page.locator("#task-save-btn").click();
await page.waitForTimeout(300);
check(
  "edited name appears, still 6 tasks",
  (await page.locator("#task-list li").count()) === 6 &&
    (await page.locator("#task-list").textContent()).includes(
      "UI check task (edited)",
    ),
);

// Delete it (two-step confirm) — back to the 5 presets.
const editedRow = page.locator("#task-list li", {
  hasText: "UI check task (edited)",
});
await editedRow.locator('button[data-action="delete"]').click();
await page.waitForTimeout(300);
check(
  "delete asks for confirmation first",
  await editedRow
    .locator('button[data-action="confirm-delete"]')
    .isVisible(),
);
await editedRow.locator('button[data-action="confirm-delete"]').click();
await page.waitForTimeout(300);
check(
  "deleted task is gone (5 tasks)",
  (await page.locator("#task-list li").count()) === 5 &&
    !(await page.locator("#task-list").textContent()).includes(
      "UI check task",
    ),
  `count=${await page.locator("#task-list li").count()}`,
);
await page.locator("nav button", { hasText: "3 · Run" }).click();
await page.waitForTimeout(500);
check(
  "Run screen back to 5 tasks after delete",
  (await page.locator("#run-task-list li").count()) === 5,
  `count=${await page.locator("#run-task-list li").count()}`,
);

// ---- Day 6: sample mode with NO run at all (fresh reload) ----
// The snapshot is in-memory, so after a reload the Report has no real
// results — the sample must still render, and exiting it must return
// to the empty state.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "4 · Report" }).click();
await page.waitForTimeout(500);
check(
  "empty state shown after reload (no results yet)",
  await page.locator("#no-report-data").isVisible(),
);
check(
  "view-sample button visible with no results",
  await page.locator("#view-sample-btn").isVisible(),
);
await page.locator("#view-sample-btn").click();
await page.waitForTimeout(500);
check(
  "sample renders without any run (banner + 5 recommendations)",
  (await page.locator("#sample-banner").count()) === 1 &&
    (await page.locator("#recommendations-table tbody tr").count()) === 5,
);
const sampleOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check(
  "no horizontal overflow (1280px, Report sample mode)",
  sampleOverflow <= 0,
  `overflow=${sampleOverflow}px`,
);
await page.locator("#exit-sample-btn").click();
await page.waitForTimeout(400);
check(
  "exit sample returns to the empty state",
  await page.locator("#no-report-data").isVisible(),
);

// No horizontal overflow at desktop width.
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow (1280px)", overflow <= 0, `overflow=${overflow}px`);

await page.screenshot({ path: OUT + "desktop-1280.png", fullPage: true });

// Mobile width — check the Tasks editor form (the widest new element)
// as well as the page in general.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.locator("nav button", { hasText: "2 · Tasks" }).click();
await page.waitForTimeout(500);
const mOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow (390px, Tasks tab)", mOverflow <= 0, `overflow=${mOverflow}px`);

// Run tab at mobile width (Score column widens the table — the CSS
// makes the table scroll horizontally instead of overflowing the page).
await page.locator("nav button", { hasText: "3 · Run" }).click();
await page.waitForTimeout(500);
const rOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow (390px, Run tab)", rOverflow <= 0, `overflow=${rOverflow}px`);

// Report tab at mobile width (recommendation + savings tables scroll
// internally like the results table).
await page.locator("nav button", { hasText: "4 · Report" }).click();
await page.waitForTimeout(500);
const repOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow (390px, Report tab)", repOverflow <= 0, `overflow=${repOverflow}px`);
await page.screenshot({ path: OUT + "mobile-390.png", fullPage: true });

await browser.close();
server.close();

console.log("\n--- unexpected errors ---");
if (failures.length === 0) console.log("(none)");
else failures.forEach((f) => console.log(" - " + f));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || failures.length ? 1 : 0);
