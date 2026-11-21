// Clean-profile test for NanoOrCloud (Day 7).
// Loads the production build in a FRESH Chrome profile (empty
// user-data-dir, no localStorage, no flags, no dev env) and checks the
// app works cold: presets seed, Setup statuses render, the sample report
// works with no run and no on-device model, and nothing overflows.
// Run: node verification/clean-profile.mjs  (from routewise/)
//
// Note: this VM's headless Chrome has no Gemini Nano and cannot do TLS
// to Google, so cloud calls fail here — environmental, not app bugs.
// This test never clicks a live AI call.
import { chromium } from "playwright-core";
import http from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PORT = 4183;

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

const profileDir = await mkdtemp(join(tmpdir(), "nanoorcloud-clean-"));
console.log(`fresh profile: ${profileDir}`);

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: "/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 800 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = context.pages()[0] ?? (await context.newPage());
const failures = [];
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
  if (req.url().includes("127.0.0.1")) {
    failures.push(`request failed: ${req.url()} ${req.failure()?.errorText}`);
  } else {
    console.log(`(ignored cross-origin request failure: ${req.url()})`);
  }
});

const checks = [];
const check = (name, ok, extra = "") => {
  checks.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Cold start: the app seeds the 5 presets on first load (loadTasks()
// writes routewise-tasks-v1), so localStorage must hold exactly that
// one key — no stale settings or results from a previous profile.
const lsKeys = await page.evaluate(() => Object.keys(localStorage));
check(
  "fresh profile: only the seeded tasks key exists on first load",
  lsKeys.length === 1 && lsKeys[0] === "routewise-tasks-v1",
  `keys=${lsKeys.join(",") || "(none)"}`,
);

// Setup screen (default): statuses render, config present.
check("title is NanoOrCloud", (await page.title()).includes("NanoOrCloud"), await page.title());
check(
  "Setup shows Chrome version",
  (await page.locator(".status-list").textContent()).includes("Chrome"),
);
check(
  "Setup shows Firebase project offrecord-4161f",
  (await page.locator(".status-list").textContent()).includes("offrecord-4161f"),
);
check(
  "on-device status is unavailable/unknown (no Nano in headless)",
  (await page.locator(".status-list").textContent()).match(/unavailable|unknown/i) != null,
);

// Tasks: the 5 presets must seed from nothing.
await page.locator("nav button", { hasText: "Tasks" }).click();
await page.waitForTimeout(500);
check(
  "5 starter presets seeded in a fresh profile",
  (await page.locator("#task-list li").count()) === 5,
  `count=${await page.locator("#task-list li").count()}`,
);

// Report with no run: empty state + sample mode must work.
await page.locator("nav button", { hasText: "Report" }).click();
await page.waitForTimeout(500);
check("empty state shown with no run", await page.locator("#no-report-data").isVisible());
await page.locator("#view-sample-btn").click();
await page.waitForTimeout(500);
check(
  "sample report renders (banner + 5 recommendations)",
  (await page.locator("#sample-banner").count()) === 1 &&
    (await page.locator("#recommendations-table tbody tr").count()) === 5,
);
check(
  "sample savings show dollar amounts",
  /\$/.test(await page.locator("#savings-summary").textContent()),
);

// Reload: seeded tasks persist (localStorage now written by the app).
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "Tasks" }).click();
await page.waitForTimeout(500);
check(
  "seeded tasks persist after reload (5 tasks)",
  (await page.locator("#task-list li").count()) === 5,
);

// No horizontal overflow at desktop width (Report sample mode is the widest).
await page.locator("nav button", { hasText: "Report" }).click();
await page.waitForTimeout(500);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no horizontal overflow (1280px)", overflow <= 0, `overflow=${overflow}px`);

// Mobile: the active nav pill must show its label (text visible, not a
// blank dark pill) on every tab, and no tab may overflow the page.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
for (const label of ["Setup", "Tasks", "Run", "Report"]) {
  await page.locator("nav button", { hasText: label }).click();
  await page.waitForTimeout(400);
  const active = page.locator("nav button.nav-active");
  const activeText = (await active.textContent()) ?? "";
  const color = await active.evaluate((el) => getComputedStyle(el).color);
  const bg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
  check(
    `active nav pill "${label}" shows its label at 390px`,
    activeText.includes(label) && color !== bg,
    `text="${activeText.trim()}" color=${color} bg=${bg}`,
  );
  const ov = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`no horizontal overflow (390px, ${label} tab)`, ov <= 0, `overflow=${ov}px`);
}

await context.close();
server.close();

console.log("\n--- unexpected errors ---");
if (failures.length === 0) console.log("(none)");
else failures.forEach((f) => console.log(" - " + f));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || failures.length ? 1 : 0);
