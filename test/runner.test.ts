// Unit tests for src/lib/runner.ts — run with: npm test
// Fake models stand in for firebase/ai's GenerativeModel (the runner only
// uses the ModelLike surface: generateContent + optional initializeDeviceModel).
import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  estimateCostUsd,
  extractTokens,
  runTask,
  runAll,
  MAX_TASKS_PER_RUN,
  WARMUP_PROMPT,
  type ModelLike,
} from "../src/lib/runner.ts";
import type { Settings, Task } from "../src/lib/types.ts";
import { PRESET_TASKS } from "../src/data/presets.ts";

const PRICES: Settings = {
  priceInPer1M: 0.1,
  priceOutPer1M: 0.4,
  qualityThreshold: 0.9,
  escalateThreshold: 0.7,
};
const NO_PRICES: Settings = { ...PRICES, priceInPer1M: 0, priceOutPer1M: 0 };

function task(id: string): Task {
  return { id, name: `Task ${id}`, type: "qa", prompt: `Prompt for ${id}?` };
}

interface FakeOptions {
  text?: string;
  usage?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
  failTimes?: number;
  failMessage?: string;
}

function fakeModel(opts: FakeOptions = {}): ModelLike & {
  calls: string[];
  initCalls: number;
} {
  const calls: string[] = [];
  let failuresLeft = opts.failTimes ?? 0;
  const model = {
    calls,
    initCalls: 0,
    async initializeDeviceModel() {
      model.initCalls++;
    },
    async generateContent(prompt: string) {
      calls.push(prompt);
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error(opts.failMessage ?? "boom");
      }
      return {
        response: {
          text: () => opts.text ?? `answer to: ${prompt}`,
          usageMetadata: opts.usage,
        },
      };
    },
  };
  return model;
}

test("estimateTokens is characters / 4, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("abcdefgh"), 2);
  assert.equal(estimateTokens("abcdefghi"), 3);
});

test("estimateCostUsd uses user prices, null when unset", () => {
  assert.equal(estimateCostUsd(1_000_000, 1_000_000, PRICES), 0.5);
  const half = estimateCostUsd(500_000, 250_000, PRICES);
  assert.ok(half != null && Math.abs(half - 0.15) < 1e-12, String(half));
  assert.equal(estimateCostUsd(100, 100, NO_PRICES), null);
  assert.equal(
    estimateCostUsd(100, 100, { ...PRICES, priceOutPer1M: 0 }),
    null,
  );
});

test("extractTokens prefers usage metadata, else estimates", () => {
  const withMeta = extractTokens(
    {
      text: () => "hello world",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 7,
        totalTokenCount: 19,
      },
    },
    "prompt",
    "hello world",
  );
  assert.deepEqual(withMeta, {
    inputTokens: 12,
    outputTokens: 7,
    estimated: false,
  });

  const estimated = extractTokens(
    { text: () => "hello world" },
    "12345678", // 8 chars -> 2 tokens
    "hello world", // 11 chars -> 3 tokens
  );
  assert.deepEqual(estimated, {
    inputTokens: 2,
    outputTokens: 3,
    estimated: true,
  });
});

test("runTask runs on-device then cloud, in order, progressively", async () => {
  const device = fakeModel({ text: "device answer" });
  const cloud = fakeModel({ text: "cloud answer" });
  const seen: string[] = [];
  await runTask(
    task("t1"),
    { onDevice: device, cloud },
    {},
    (r) => seen.push(`${r.source}:${r.output}`),
  );
  assert.deepEqual(seen, [
    "on_device:device answer",
    "cloud:cloud answer",
  ]);
  assert.deepEqual(device.calls, ["Prompt for t1?"]);
  assert.deepEqual(cloud.calls, ["Prompt for t1?"]);
});

test("runTask records N/A for on-device when the model is null", async () => {
  const cloud = fakeModel({ text: "cloud answer" });
  const results: string[] = [];
  await runTask(
    task("t1"),
    { onDevice: null, cloud },
    {},
    (r) => results.push(`${r.source}:${r.error ?? "ok"}`),
  );
  assert.equal(results[0].startsWith("on_device:"), true);
  assert.match(results[0], /N\/A/);
  assert.equal(results[1], "cloud:ok");
});

test("runTask retries the cloud call once, then records the error", async () => {
  const flaky = fakeModel({ failTimes: 1, text: "second try" });
  const results: { output: string; error?: string }[] = [];
  await runTask(task("t1"), { onDevice: null, cloud: flaky }, {}, (r) =>
    results.push(r),
  );
  assert.equal(flaky.calls.length, 2);
  assert.equal(results[1].output, "second try");
  assert.equal(results[1].error, undefined);

  const broken = fakeModel({ failTimes: 5, failMessage: "cloud down" });
  const bad: { output: string; error?: string }[] = [];
  await runTask(task("t2"), { onDevice: null, cloud: broken }, {}, (r) =>
    bad.push(r),
  );
  assert.equal(broken.calls.length, 2); // one retry, then give up
  assert.equal(bad[1].output, "");
  assert.equal(bad[1].error, "cloud down");
});

test("runAll warms up on-device once, initialises the model, runs in order", async () => {
  const device = fakeModel({ text: "d" });
  const cloud = fakeModel({ text: "c" });
  const order: string[] = [];
  const summary = await runAll(
    [task("a"), task("b")],
    { onDevice: device, cloud },
    {},
    (r) => order.push(`${r.taskId}:${r.source}`),
  );
  assert.equal(device.initCalls, 1);
  assert.equal(device.calls[0], WARMUP_PROMPT); // warm-up first, before timing
  assert.deepEqual(device.calls.slice(1), ["Prompt for a?", "Prompt for b?"]);
  assert.deepEqual(order, [
    "a:on_device",
    "a:cloud",
    "b:on_device",
    "b:cloud",
  ]);
  assert.deepEqual(summary, {
    tasksAttempted: 2,
    callsDone: 4,
    callsTotal: 4,
    aborted: false,
  });
});

test("runAll caps a run at 25 tasks", async () => {
  const device = fakeModel();
  const cloud = fakeModel();
  const tasks = Array.from({ length: 30 }, (_v, i) => task(`t${i}`));
  const summary = await runAll(
    tasks,
    { onDevice: device, cloud },
    {},
    () => {},
  );
  assert.equal(summary.tasksAttempted, MAX_TASKS_PER_RUN);
  assert.equal(MAX_TASKS_PER_RUN, 25);
  assert.equal(summary.callsDone, 50);
  assert.equal(summary.callsTotal, 50);
  assert.equal(summary.aborted, false);
});

test("runAll aborts between tasks and reports it", async () => {
  const device = fakeModel();
  const cloud = fakeModel();
  const controller = new AbortController();
  let seen = 0;
  const summary = await runAll(
    [task("a"), task("b"), task("c")],
    { onDevice: device, cloud },
    { signal: controller.signal },
    () => {
      seen++;
      if (seen === 2) controller.abort(); // after task "a" finished both sides
    },
  );
  assert.equal(summary.aborted, true);
  assert.equal(summary.tasksAttempted, 1);
  assert.equal(summary.callsDone, 2);
});

test("runAll without an on-device model skips warm-up and init", async () => {
  const cloud = fakeModel();
  const summary = await runAll(
    [task("a")],
    { onDevice: null, cloud },
    {},
    () => {},
  );
  assert.equal(summary.callsDone, 2); // one N/A row + one cloud call
  assert.deepEqual(cloud.calls, ["Prompt for a?"]);
});

test("presets are the 5 starter tasks from the spec", () => {
  assert.equal(PRESET_TASKS.length, 5);
  assert.deepEqual(
    PRESET_TASKS.map((t) => t.type),
    ["summarize", "classify", "extract_json", "rewrite", "extract_json"],
  );
  for (const t of PRESET_TASKS) {
    assert.ok(t.id.length > 0 && t.name.length > 0 && t.prompt.length > 0);
  }
  // Preset 5 uses made-up data only (spec §9).
  assert.match(PRESET_TASKS[4].prompt, /Fictional/);
});
