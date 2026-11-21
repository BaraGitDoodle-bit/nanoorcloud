// Tests for the bundled sample report (F8) — run with: npm test
// The sample file must be a valid, self-consistent run: every task has
// one on-device and one cloud result + score, the routing comes out as
// designed (2 on-device, 1 escalate, 2 cloud), and the savings match a
// hand calculation for at least one task.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildReportExport,
  buildRoutingConfigTs,
  loadSampleReport,
} from "../src/lib/export.ts";
import {
  buildRecommendations,
  computeSavings,
} from "../src/lib/routing.ts";

const raw = readFileSync(
  new URL("../src/data/sample-report.json", import.meta.url),
  "utf-8",
);
const parsed: unknown = JSON.parse(raw);

test("sample report: parses as JSON and passes validation", () => {
  const sample = loadSampleReport(parsed);
  assert.notEqual(sample, null);
  assert.equal(sample?.label, "SAMPLE");
  assert.equal(sample?.tasks.length, 5);
  assert.equal(sample?.results.length, 10);
  assert.equal(sample?.scores.length, 10);
});

test("sample report: every task has one on-device and one cloud result + score", () => {
  const sample = loadSampleReport(parsed);
  assert.notEqual(sample, null);
  for (const t of sample!.tasks) {
    const results = sample!.results.filter((r) => r.taskId === t.id);
    const scores = sample!.scores.filter((s) => s.taskId === t.id);
    assert.equal(results.length, 2, t.id);
    assert.equal(
      results.filter((r) => r.source === "on_device").length,
      1,
      t.id,
    );
    assert.equal(
      results.filter((r) => r.source === "cloud").length,
      1,
      t.id,
    );
    assert.equal(scores.length, 2, t.id);
    for (const r of results) {
      assert.ok(r.output.length > 0, t.id);
      assert.ok(r.latencyMs > 0, t.id);
    }
  }
});

test("sample report: routes come out as designed", () => {
  const sample = loadSampleReport(parsed);
  assert.notEqual(sample, null);
  const recs = buildRecommendations(
    sample!.tasks,
    sample!.results,
    sample!.scores,
    sample!.settings,
  );
  const byId = new Map(recs.map((r) => [r.taskId, r.route]));
  // Summarize 5/5 + checks pass -> on_device; classify 4/5 -> escalate;
  // extract-json 3/5 -> cloud; rewrite 5/5 -> on_device; crypto 2/4 -> cloud.
  assert.equal(byId.get("preset-summarize"), "on_device");
  assert.equal(byId.get("preset-classify"), "escalate");
  assert.equal(byId.get("preset-extract-json"), "cloud");
  assert.equal(byId.get("preset-rewrite"), "on_device");
  assert.equal(byId.get("preset-crypto-fields"), "cloud");
  // One run per task -> medium confidence everywhere (judge present).
  for (const r of recs) assert.equal(r.confidence, "medium", r.taskId);
});

test("sample report: savings are positive and match a hand calculation", () => {
  const sample = loadSampleReport(parsed);
  assert.notEqual(sample, null);
  const recs = buildRecommendations(
    sample!.tasks,
    sample!.results,
    sample!.scores,
    sample!.settings,
  );
  const savings = computeSavings(sample!.tasks, recs, sample!.settings);
  assert.equal(savings.pricesSet, true);
  assert.ok(savings.totalBeforeUsd > savings.totalAfterUsd);
  assert.ok(savings.totalSavingsUsd > 0);
  // Hand calculation for preset-summarize (cloud result: 148 in, 58 out
  // tokens at $0.10 / $0.40 per 1M): (148*0.10 + 58*0.40) / 1e6 =
  // 38 / 1e6 = $0.000038 per request; x 10,000 requests = $0.38/mo
  // before routing, $0 after (on_device share 1), so $0.38 saved.
  const row = savings.perTask.find((r) => r.taskId === "preset-summarize");
  assert.ok(row);
  assert.ok(Math.abs(row!.costBeforeUsd - 0.38) < 1e-9, `${row!.costBeforeUsd}`);
  assert.ok(Math.abs(row!.costAfterUsd) < 1e-9);
  assert.ok(Math.abs(row!.savingsUsd - 0.38) < 1e-9);
});

test("sample report: exports as a labeled sample with all three modes", () => {
  const sample = loadSampleReport(parsed);
  assert.notEqual(sample, null);
  const recs = buildRecommendations(
    sample!.tasks,
    sample!.results,
    sample!.scores,
    sample!.settings,
  );
  const savings = computeSavings(sample!.tasks, recs, sample!.settings);
  const report = buildReportExport({
    tasks: sample!.tasks,
    results: sample!.results,
    scores: sample!.scores,
    recommendations: recs,
    savings,
    settings: sample!.settings,
    sample: true,
  });
  assert.equal(report.sample, true);
  assert.equal(report.recommendations.length, 5);
  const ts = buildRoutingConfigTs(report);
  assert.match(ts, /"preset-summarize": "PREFER_ON_DEVICE"/);
  assert.match(ts, /"preset-classify": "ESCALATE"/);
  assert.match(ts, /"preset-extract-json": "ONLY_IN_CLOUD"/);
  assert.match(ts, /Generated from a SAMPLE report/);
});
