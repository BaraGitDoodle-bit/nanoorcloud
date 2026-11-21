// Unit tests for src/lib/export.ts (F7) — run with: npm test
// The export builders are pure: build a report from a small fixture
// (routes computed by the real routing.ts, not hand-made), then check
// the JSON shape, the round-trip, and the TypeScript snippet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReportExport,
  buildRoutingConfigTs,
  loadSampleReport,
  routingModeFor,
  serializeReportJson,
  type ReportExport,
} from "../src/lib/export.ts";
import {
  buildRecommendations,
  computeSavings,
} from "../src/lib/routing.ts";
import type {
  RunResult,
  Score,
  Settings,
  Task,
} from "../src/lib/types.ts";

const SETTINGS: Settings = {
  cloudModel: "gemini-2.5-flash-lite",
  priceInPer1M: 0.1,
  priceOutPer1M: 0.4,
  qualityThreshold: 0.9,
  escalateThreshold: 0.7,
};

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    name: "Test task",
    type: "qa",
    prompt: "Answer this question.",
    monthlyRequests: 10000,
    ...over,
  };
}

function result(over: Partial<RunResult>): RunResult {
  return {
    taskId: "t1",
    source: "cloud",
    output: "answer",
    latencyMs: 1000,
    inputTokens: 100,
    outputTokens: 20,
    ...over,
  };
}

function score(over: Partial<Score>): Score {
  return {
    taskId: "t1",
    source: "cloud",
    checksPassed: true,
    judgeScore: 5,
    ...over,
  };
}

/** Two-task fixture: t1 routes on_device (5/5, checks pass), t2 routes
 *  cloud (on-device judge 2 vs cloud 5). */
function fixture() {
  const tasks = [
    task({ id: "t1", name: "Good on-device" }),
    task({ id: "t2", name: "Needs cloud", monthlyRequests: 5000 }),
  ];
  const results = [
    result({ taskId: "t1", source: "on_device", latencyMs: 800 }),
    result({ taskId: "t1", source: "cloud", latencyMs: 1500 }),
    result({ taskId: "t2", source: "on_device", latencyMs: 900 }),
    result({ taskId: "t2", source: "cloud", latencyMs: 1600 }),
  ];
  const scores = [
    score({ taskId: "t1", source: "on_device" }),
    score({ taskId: "t1", source: "cloud" }),
    score({ taskId: "t2", source: "on_device", judgeScore: 2 }),
    score({ taskId: "t2", source: "cloud" }),
  ];
  const recommendations = buildRecommendations(
    tasks,
    results,
    scores,
    SETTINGS,
  );
  const savings = computeSavings(tasks, recommendations, SETTINGS);
  return { tasks, results, scores, recommendations, savings };
}

test("buildReportExport: shape, sample flag, generatedAt override", () => {
  const { tasks, results, scores, recommendations, savings } = fixture();
  const report = buildReportExport({
    tasks,
    results,
    scores,
    recommendations,
    savings,
    settings: SETTINGS,
    sample: false,
    generatedAt: "2026-11-21T00:00:00.000Z",
  });
  assert.equal(report.app, "NanoOrCloud");
  assert.equal(report.version, 1);
  assert.equal(report.sample, false);
  assert.equal(report.generatedAt, "2026-11-21T00:00:00.000Z");
  assert.equal(report.settings.cloudModel, "gemini-2.5-flash-lite");
  assert.equal(report.settings.qualityThreshold, 0.9);
  assert.equal(report.tasks.length, 2);
  assert.equal(report.tasks[0].monthlyRequests, 10000);
  assert.equal(report.recommendations.length, 2);
  assert.equal(report.recommendations[0].route, "on_device");
  assert.equal(report.recommendations[1].route, "cloud");
  assert.equal(report.savings.pricesSet, true);
  // Results carry their scores merged in.
  const onDeviceT1 = report.results.find(
    (r) => r.taskId === "t1" && r.source === "on_device",
  );
  assert.equal(onDeviceT1?.checksPassed, true);
  assert.equal(onDeviceT1?.judgeScore, 5);
  assert.equal(onDeviceT1?.inputTokens, 100);
});

test("buildReportExport: sample flag passes through, volume defaults to 0", () => {
  const { results, scores, recommendations, savings } = fixture();
  const noVolume = task({ id: "t1", monthlyRequests: undefined });
  const report = buildReportExport({
    tasks: [noVolume],
    results,
    scores,
    recommendations: recommendations.filter((r) => r.taskId === "t1"),
    savings,
    settings: SETTINGS,
    sample: true,
  });
  assert.equal(report.sample, true);
  assert.equal(report.tasks[0].monthlyRequests, 0);
});

test("serializeReportJson round-trips the report", () => {
  const { tasks, results, scores, recommendations, savings } = fixture();
  const report = buildReportExport({
    tasks,
    results,
    scores,
    recommendations,
    savings,
    settings: SETTINGS,
    sample: false,
    generatedAt: "2026-11-21T00:00:00.000Z",
  });
  const text = serializeReportJson(report);
  assert.match(text, /"app": "NanoOrCloud"/);
  assert.deepEqual(JSON.parse(text), report);
});

test("routingModeFor maps all three routes", () => {
  assert.equal(routingModeFor("on_device"), "PREFER_ON_DEVICE");
  assert.equal(routingModeFor("cloud"), "ONLY_IN_CLOUD");
  assert.equal(routingModeFor("escalate"), "ESCALATE");
});

test("buildRoutingConfigTs: modes, task ids, ESCALATE honesty", () => {
  const { tasks, results, scores, recommendations, savings } = fixture();
  const report: ReportExport = buildReportExport({
    tasks,
    results,
    scores,
    recommendations,
    savings,
    settings: SETTINGS,
    sample: false,
    generatedAt: "2026-11-21T00:00:00.000Z",
  });
  const ts = buildRoutingConfigTs(report);
  assert.match(ts, /export const routingConfig = \{/);
  assert.match(ts, /"t1": "PREFER_ON_DEVICE"/);
  assert.match(ts, /"t2": "ONLY_IN_CLOUD"/);
  assert.match(ts, /ESCALATE.*not an InferenceMode/);
  assert.doesNotMatch(ts, /SAMPLE report/);
});

test("buildRoutingConfigTs: sample reports are labeled, escalate maps", () => {
  const { tasks, results, scores, savings } = fixture();
  const escalateRecs = [
    {
      taskId: "t1",
      route: "escalate" as const,
      qualityRatio: 0.8,
      checkPassRate: 1,
      latencyOnDeviceMs: 800,
      latencyCloudMs: 1500,
      avgCloudCostUsd: 0.00002,
      confidence: "medium" as const,
      note: "Try on-device first.",
    },
  ];
  const report = buildReportExport({
    tasks,
    results,
    scores,
    recommendations: escalateRecs,
    savings,
    settings: SETTINGS,
    sample: true,
    generatedAt: "2026-11-21T00:00:00.000Z",
  });
  const ts = buildRoutingConfigTs(report);
  assert.match(ts, /"t1": "ESCALATE"/);
  assert.match(ts, /Generated from a SAMPLE report/);
});

test("buildRoutingConfigTs: newlines in task names cannot break the snippet", () => {
  const { results, scores, savings } = fixture();
  const nasty = task({ id: "t1", name: "Bad\nname // injection" });
  const recs = [
    {
      taskId: "t1",
      route: "on_device" as const,
      qualityRatio: 1,
      checkPassRate: 1,
      latencyOnDeviceMs: 800,
      latencyCloudMs: 1500,
      avgCloudCostUsd: 0.00002,
      confidence: "medium" as const,
      note: "Line one\nline two.",
    },
  ];
  const report = buildReportExport({
    tasks: [nasty],
    results,
    scores,
    recommendations: recs,
    savings,
    settings: SETTINGS,
    sample: false,
    generatedAt: "2026-11-21T00:00:00.000Z",
  });
  const ts = buildRoutingConfigTs(report);
  // The t1 entry is exactly one line — no raw newline smuggled in.
  assert.equal(ts.split("\n").filter((l) => l.includes('"t1"')).length, 1);
});

test("loadSampleReport: rejects malformed input, accepts a valid shape", () => {
  assert.equal(loadSampleReport(null), null);
  assert.equal(loadSampleReport({}), null);
  assert.equal(loadSampleReport({ tasks: [], results: [] }), null);
  assert.equal(
    loadSampleReport({
      tasks: [],
      results: [],
      scores: [],
      settings: { qualityThreshold: 0.9 },
    }),
    null,
  );
  assert.equal(
    loadSampleReport({
      tasks: [{ id: "x" }],
      results: [],
      scores: [],
      settings: {
        qualityThreshold: 0.9,
        escalateThreshold: 0.7,
        priceInPer1M: 0.1,
        priceOutPer1M: 0.4,
      },
    }),
    null,
  );
  const valid = {
    label: "SAMPLE",
    note: "n",
    generatedAt: "2026-11-21T00:00:00.000Z",
    settings: {
      qualityThreshold: 0.9,
      escalateThreshold: 0.7,
      priceInPer1M: 0.1,
      priceOutPer1M: 0.4,
    },
    tasks: [
      {
        id: "t1",
        name: "T",
        type: "qa",
        prompt: "p",
        monthlyRequests: 10,
      },
    ],
    results: [],
    scores: [],
  };
  assert.deepEqual(loadSampleReport(valid), valid);
});
