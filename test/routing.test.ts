// Unit tests for src/lib/routing.ts (F5 + F6) — run with: npm test
// Every expected number below is hand-calculated in the test comments
// (spec §12 Day 5: "report numbers match a hand calculation").
import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendRoute,
  buildRecommendations,
  computeSavings,
  CHECK_PASS_THRESHOLD,
  HIGH_CONFIDENCE_MIN_RUNS,
  type TaskSavings,
} from "../src/lib/routing.ts";
import type {
  Recommendation,
  RunResult,
  Score,
  Settings,
  Task,
} from "../src/lib/types.ts";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    name: "Test task",
    type: "qa",
    prompt: "Answer this question.",
    ...over,
  };
}

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    taskId: "t1",
    source: "cloud",
    output: "Some answer.",
    latencyMs: 100,
    ...over,
  };
}

function score(over: Partial<Score> = {}): Score {
  return {
    taskId: "t1",
    source: "cloud",
    checksPassed: true,
    ...over,
  };
}

/** Prices set (spec §4: never hard-coded — these are test inputs). */
function settings(over: Partial<Settings> = {}): Settings {
  return {
    priceInPer1M: 0.1,
    priceOutPer1M: 0.4,
    qualityThreshold: 0.9,
    escalateThreshold: 0.7,
    ...over,
  };
}

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
}

interface RunOpts {
  latencyOn?: number;
  latencyCloud?: number;
  checksOn?: boolean;
  checksCloud?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  errorOn?: string;
  errorCloud?: string;
}

/** One run of a task: one on-device result+score, one cloud result+score. */
function oneRun(
  judgeOn: number | undefined,
  judgeCloud: number | undefined,
  opts: RunOpts = {},
): { results: RunResult[]; scores: Score[] } {
  return {
    results: [
      result({
        source: "on_device",
        output: "on-device answer",
        latencyMs: opts.latencyOn ?? 120,
        error: opts.errorOn,
      }),
      result({
        source: "cloud",
        output: "cloud answer",
        latencyMs: opts.latencyCloud ?? 800,
        inputTokens: opts.inputTokens ?? 100,
        outputTokens: opts.outputTokens ?? 50,
        error: opts.errorCloud,
      }),
    ],
    scores: [
      score({
        source: "on_device",
        checksPassed: opts.checksOn ?? true,
        judgeScore: judgeOn,
      }),
      score({
        source: "cloud",
        checksPassed: opts.checksCloud ?? true,
        judgeScore: judgeCloud,
      }),
    ],
  };
}

// ---- F5: route decisions (spec §6) ----

test("on_device when quality ratio is 1.0 and all checks pass", () => {
  const { results, scores } = oneRun(5, 5);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.taskId, "t1");
  assert.equal(rec.route, "on_device");
  assert.equal(rec.qualityRatio, 1);
  assert.equal(rec.checkPassRate, 1);
  assert.equal(rec.confidence, "medium"); // 1 run
  assert.equal(rec.latencyOnDeviceMs, 120);
  assert.equal(rec.latencyCloudMs, 800);
  // Cloud cost, hand-calculated: (100 in x $0.10 + 50 out x $0.40) / 1M
  // = (10 + 20) / 1,000,000 = $0.00003 per request.
  approx(rec.avgCloudCostUsd, 0.00003);
  assert.match(rec.note, /route on-device/i);
});

test("escalate when quality ratio is 0.8 (between 0.70 and 0.90)", () => {
  const { results, scores } = oneRun(4, 5);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "escalate");
  approx(rec.qualityRatio, 0.8);
  assert.equal(rec.checkPassRate, 1);
  assert.match(rec.note, /fall back to cloud/i);
});

test("cloud when quality ratio is 0.6 (below the 0.70 escalate bar)", () => {
  const { results, scores } = oneRun(3, 5);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "cloud");
  approx(rec.qualityRatio, 0.6);
  assert.match(rec.note, /only 60% of cloud/i);
  assert.match(rec.note, /keep on cloud/i);
});

test("quality ratio is capped at 1.0 when on-device outscores cloud", () => {
  const { results, scores } = oneRun(5, 4);
  const rec = recommendRoute(task(), results, scores, settings());
  // Raw ratio 5/4 = 1.25, capped to 1.0 — still on_device.
  assert.equal(rec.qualityRatio, 1);
  assert.equal(rec.route, "on_device");
});

test("check gate blocks on_device: ratio 0.95 but only 3 of 4 checks pass", () => {
  // Hand-calculated: on-device judge mean (5+5+4+5)/4 = 4.75, cloud mean
  // 5/5 = 5, ratio 4.75/5 = 0.95 (>= 0.90). On-device checks: 3 pass of 4
  // -> checkPassRate 0.75 < 0.90, so NOT on_device; 0.95 >= 0.70 -> escalate.
  const runs = [
    oneRun(5, 5, { checksOn: true }),
    oneRun(5, 5, { checksOn: true }),
    oneRun(4, 5, { checksOn: false }),
    oneRun(5, 5, { checksOn: true }),
  ];
  const results = runs.flatMap((r) => r.results);
  const scores = runs.flatMap((r) => r.scores);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "escalate");
  approx(rec.qualityRatio, 0.95);
  approx(rec.checkPassRate, 0.75);
  assert.equal(rec.confidence, "high"); // 4 runs >= 3
  assert.match(rec.note, /only passes 75% of checks/i);
});

test("boundary: ratio exactly 0.90 with checks passing routes on_device", () => {
  // (5+4)/2 = 4.5 on-device mean, cloud mean 5 -> 4.5/5 = 0.90 exactly.
  const runs = [oneRun(5, 5), oneRun(4, 5)];
  const rec = recommendRoute(
    task(),
    runs.flatMap((r) => r.results),
    runs.flatMap((r) => r.scores),
    settings(),
  );
  approx(rec.qualityRatio, 0.9);
  assert.equal(rec.route, "on_device");
  assert.equal(rec.confidence, "medium"); // 2 runs
});

test("boundary: ratio exactly 0.70 routes escalate, 0.69 routes cloud", () => {
  // (4+3)/2 = 3.5 mean, cloud 5 -> 0.70 exactly.
  const runs = [oneRun(4, 5), oneRun(3, 5)];
  const atBar = recommendRoute(
    task(),
    runs.flatMap((r) => r.results),
    runs.flatMap((r) => r.scores),
    settings(),
  );
  approx(atBar.qualityRatio, 0.7);
  assert.equal(atBar.route, "escalate");
  // (4+3+3)/3 = 10/3 mean, cloud 5 -> 0.666... < 0.70.
  const runs2 = [oneRun(4, 5), oneRun(3, 5), oneRun(3, 5)];
  const belowBar = recommendRoute(
    task(),
    runs2.flatMap((r) => r.results),
    runs2.flatMap((r) => r.scores),
    settings(),
  );
  approx(belowBar.qualityRatio, 10 / 15);
  assert.equal(belowBar.route, "cloud");
});

test("custom thresholds move the route (sliders are adjustable)", () => {
  // Ratio 0.9333...: on-device judge [5, 5, 4] mean 14/3, cloud [5, 5, 5]
  // mean 5 -> ratio (14/3)/5 = 14/15 = 0.9333...
  const runs = [oneRun(5, 5), oneRun(5, 5), oneRun(4, 5)];
  const r = runs.flatMap((x) => x.results);
  const s = runs.flatMap((x) => x.scores);
  const strict = recommendRoute(
    task(),
    r,
    s,
    settings({ qualityThreshold: 0.95, escalateThreshold: 0.8 }),
  );
  approx(strict.qualityRatio, 14 / 15);
  // 0.9333 < 0.95 quality bar, >= 0.80 escalate bar -> escalate.
  assert.equal(strict.route, "escalate");
  const lenient = recommendRoute(
    task(),
    r,
    s,
    settings({ qualityThreshold: 0.9, escalateThreshold: 0.7 }),
  );
  assert.equal(lenient.route, "on_device");
});

test("judge failed (no judge scores) routes cloud with low confidence", () => {
  const { results, scores } = oneRun(undefined, undefined);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "cloud");
  assert.equal(rec.confidence, "low");
  assert.equal(rec.qualityRatio, 0); // documented "no judge data" value
  assert.match(rec.note, /Judge failed or was skipped/i);
  assert.match(rec.note, /safe default/i);
});

test("judge failed on one side only still routes cloud with low confidence", () => {
  const { results, scores } = oneRun(4, undefined);
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "cloud");
  assert.equal(rec.confidence, "low");
  assert.equal(rec.qualityRatio, 0);
});

test("no on-device runs routes cloud and says so", () => {
  const { results, scores } = oneRun(4, 5);
  const cloudOnly = {
    results: results.filter((r) => r.source === "cloud"),
    scores: scores.filter((s) => s.source === "cloud"),
  };
  const rec = recommendRoute(task(), cloudOnly.results, cloudOnly.scores, settings());
  assert.equal(rec.route, "cloud");
  assert.equal(rec.checkPassRate, 0);
  assert.equal(rec.latencyOnDeviceMs, 0);
  assert.match(rec.note, /No on-device runs/i);
});

test("failed on-device call is excluded from latency and fails its checks", () => {
  const good = oneRun(5, 5, { latencyOn: 120 });
  const bad = oneRun(undefined, 5, {
    errorOn: "On-device model unavailable",
    latencyOn: 5000,
  });
  // Keep only the failed on-device result + a good cloud result: the
  // judge was skipped for the failed pair, so the task has no judge data.
  const results = [bad.results[0], good.results[1]];
  const scores = [bad.scores[0], good.scores[1]];
  const rec = recommendRoute(task(), results, scores, settings());
  assert.equal(rec.route, "cloud");
  assert.equal(rec.confidence, "low");
  // The 5000 ms failed attempt must not pollute the latency mean.
  assert.equal(rec.latencyOnDeviceMs, 0);
  assert.equal(rec.latencyCloudMs, 800);
});

test("latency is the mean over successful calls", () => {
  const runs = [
    oneRun(5, 5, { latencyOn: 100, latencyCloud: 700 }),
    oneRun(5, 5, { latencyOn: 200, latencyCloud: 900 }),
  ];
  const rec = recommendRoute(
    task(),
    runs.flatMap((r) => r.results),
    runs.flatMap((r) => r.scores),
    settings(),
  );
  assert.equal(rec.latencyOnDeviceMs, 150);
  assert.equal(rec.latencyCloudMs, 800);
});

test("confidence: 3 runs is high, 1–2 runs is medium", () => {
  assert.equal(HIGH_CONFIDENCE_MIN_RUNS, 3);
  const one = oneRun(5, 5);
  assert.equal(
    recommendRoute(task(), one.results, one.scores, settings()).confidence,
    "medium",
  );
  const two = [oneRun(5, 5), oneRun(5, 5)];
  assert.equal(
    recommendRoute(
      task(),
      two.flatMap((r) => r.results),
      two.flatMap((r) => r.scores),
      settings(),
    ).confidence,
    "medium",
  );
  const three = [oneRun(5, 5), oneRun(5, 5), oneRun(5, 5)];
  assert.equal(
    recommendRoute(
      task(),
      three.flatMap((r) => r.results),
      three.flatMap((r) => r.scores),
      settings(),
    ).confidence,
    "high",
  );
});

test("avg cloud cost is 0 when prices are unset or tokens are missing", () => {
  const { results, scores } = oneRun(5, 5);
  const noPrices = recommendRoute(
    task(),
    results,
    scores,
    settings({ priceInPer1M: 0, priceOutPer1M: 0 }),
  );
  assert.equal(noPrices.avgCloudCostUsd, 0);
  const stripped = oneRun(5, 5);
  for (const r of stripped.results) {
    if (r.source === "cloud") {
      delete r.inputTokens;
      delete r.outputTokens;
    }
  }
  const rec = recommendRoute(task(), stripped.results, stripped.scores, settings());
  assert.equal(rec.avgCloudCostUsd, 0);
});

test("buildRecommendations skips tasks with no results, keeps task order", () => {
  const tA = task({ id: "a", name: "A" });
  const tB = task({ id: "b", name: "B" });
  const tC = task({ id: "c", name: "C" });
  const runA = oneRun(5, 5);
  const runC = oneRun(3, 5);
  // Re-tag the runs' results/scores to their tasks.
  for (const r of runA.results) r.taskId = "a";
  for (const s of runA.scores) s.taskId = "a";
  for (const r of runC.results) r.taskId = "c";
  for (const s of runC.scores) s.taskId = "c";
  const recs = buildRecommendations(
    [tA, tB, tC],
    [...runA.results, ...runC.results],
    [...runA.scores, ...runC.scores],
    settings(),
  );
  assert.deepEqual(
    recs.map((r) => r.taskId),
    ["a", "c"],
  );
  assert.equal(recs[0].route, "on_device");
  assert.equal(recs[1].route, "cloud");
});

// ---- F6: savings (spec §6) — hand-calculated ----

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    taskId: "t1",
    route: "on_device",
    qualityRatio: 1,
    checkPassRate: 1,
    latencyOnDeviceMs: 120,
    latencyCloudMs: 800,
    avgCloudCostUsd: 0.002,
    confidence: "high",
    note: "",
    ...over,
  };
}

test("savings: on_device saves everything, escalate saves its share, cloud saves nothing", () => {
  const tasks = [
    task({ id: "a", name: "A", monthlyRequests: 10_000 }),
    task({ id: "b", name: "B", monthlyRequests: 5_000 }),
    task({ id: "c", name: "C", monthlyRequests: 2_000 }),
  ];
  const recs = [
    // A: on_device, p = 1. Before: 10,000 x $0.002 = $20. After: $0. Saved: $20.
    rec({ taskId: "a", route: "on_device", avgCloudCostUsd: 0.002 }),
    // B: escalate, p = checkPassRate 0.8. Before: 5,000 x $0.001 = $5.
    // After: $5 x (1 - 0.8) = $1. Saved: 5,000 x 0.8 x $0.001 = $4.
    rec({ taskId: "b", route: "escalate", checkPassRate: 0.8, avgCloudCostUsd: 0.001 }),
    // C: cloud, p = 0. Before: 2,000 x $0.005 = $10. After: $10. Saved: $0.
    rec({ taskId: "c", route: "cloud", avgCloudCostUsd: 0.005 }),
  ];
  const s = computeSavings(tasks, recs, settings());
  assert.equal(s.pricesSet, true);
  const byId = new Map(s.perTask.map((p) => [p.taskId, p]));
  const a = byId.get("a") as TaskSavings;
  approx(a.costBeforeUsd, 20);
  approx(a.costAfterUsd, 0);
  approx(a.savingsUsd, 20);
  assert.equal(a.shareOnDevice, 1);
  const b = byId.get("b") as TaskSavings;
  approx(b.costBeforeUsd, 5);
  approx(b.costAfterUsd, 1);
  approx(b.savingsUsd, 4);
  approx(b.shareOnDevice, 0.8);
  const c = byId.get("c") as TaskSavings;
  approx(c.costBeforeUsd, 10);
  approx(c.costAfterUsd, 10);
  approx(c.savingsUsd, 0);
  assert.equal(c.shareOnDevice, 0);
  // Totals are the sums: before 20+5+10 = 35, after 0+1+10 = 11, saved 24.
  approx(s.totalBeforeUsd, 35);
  approx(s.totalAfterUsd, 11);
  approx(s.totalSavingsUsd, 24);
  // costBefore - costAfter === savings, by construction.
  approx(s.totalBeforeUsd - s.totalAfterUsd, s.totalSavingsUsd);
});

test("savings: a task without a monthly volume contributes 0", () => {
  const tasks = [task({ id: "a", name: "A" })]; // no monthlyRequests
  const s = computeSavings(
    tasks,
    [rec({ taskId: "a", route: "on_device", avgCloudCostUsd: 0.002 })],
    settings(),
  );
  assert.equal(s.perTask[0].monthlyRequests, 0);
  approx(s.totalBeforeUsd, 0);
  approx(s.totalSavingsUsd, 0);
});

test("savings: prices unset means pricesSet is false and costs are 0", () => {
  const tasks = [task({ id: "a", name: "A", monthlyRequests: 1000 })];
  const s = computeSavings(
    tasks,
    [rec({ taskId: "a", route: "on_device", avgCloudCostUsd: 0 })],
    settings({ priceInPer1M: 0, priceOutPer1M: 0 }),
  );
  assert.equal(s.pricesSet, false);
  approx(s.totalSavingsUsd, 0);
});

test("savings pipeline: from real results to dollars (hand-calculated)", () => {
  // Cloud tokens 10,000 in / 2,500 out, prices $0.10 / $0.40 per 1M:
  // cost per request = (10,000 x 0.10 + 2,500 x 0.40) / 1,000,000
  //                  = (1,000 + 1,000) / 1,000,000 = $0.002.
  // Task volume 10,000/mo, route on_device (judge 5 vs 5, checks pass):
  // savings = 10,000 x 1 x $0.002 = $20.00/mo.
  const { results, scores } = oneRun(5, 5, {
    inputTokens: 10_000,
    outputTokens: 2_500,
  });
  const t = task({ monthlyRequests: 10_000 });
  const recs = buildRecommendations([t], results, scores, settings());
  assert.equal(recs.length, 1);
  assert.equal(recs[0].route, "on_device");
  approx(recs[0].avgCloudCostUsd, 0.002);
  const s = computeSavings([t], recs, settings());
  approx(s.totalBeforeUsd, 20);
  approx(s.totalAfterUsd, 0);
  approx(s.totalSavingsUsd, 20);
});

test("CHECK_PASS_THRESHOLD is the spec 0.90", () => {
  assert.equal(CHECK_PASS_THRESHOLD, 0.9);
});
