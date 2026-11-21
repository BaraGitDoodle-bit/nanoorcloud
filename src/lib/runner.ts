// ---------------------------------------------------------------------------
// F3 — Side-by-side runner core (spec §4, §5, §8, §10).
//
// For each task: one call on-device (ONLY_ON_DEVICE) and one in the cloud
// (ONLY_IN_CLOUD), run sequentially, results reported progressively via
// onResult as each call finishes. Latency is measured with
// performance.now(); token counts come from the response usageMetadata when
// the SDK exposes it, otherwise estimated as characters / 4 (spec §4).
// On-device cost is 0; cloud cost is computed from user-entered prices
// (never hard-coded — see estimateCostUsd).
//
// Model instances are created by the caller inside the click handler that
// starts a run (spec §4.1) and passed in — the runner never creates models.
// The on-device model is null when Gemini Nano is unavailable; the runner
// then records an N/A result for the on-device side and continues with the
// cloud (spec §10). Tasks are capped at 25 per run and a Cancel button
// aborts between calls (spec §4.5); an in-flight generateContent cannot be
// cancelled by the SDK, so cancellation takes effect after the current
// call finishes.
//
// This module is pure TypeScript over a minimal ModelLike interface, so it
// can be unit-tested with fake models (see test/runner.test.ts). The real
// GenerativeModel from firebase/ai satisfies ModelLike structurally.
// ---------------------------------------------------------------------------

import type { RunResult, Settings, Task } from "./types.ts";

/** Minimal surface of firebase/ai's GenerativeModel that the runner uses. */
export interface ModelResponseLike {
  text(): string;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface ModelLike {
  generateContent(
    prompt: string,
  ): Promise<{ response: ModelResponseLike }>;
  initializeDeviceModel?(
    onProgress?: (progress: number) => void,
  ): Promise<void>;
}

export const MAX_TASKS_PER_RUN = 25;
export const ON_DEVICE_TIMEOUT_MS = 60_000; // spec §10: on-device timeout 60 s
export const CLOUD_TIMEOUT_MS = 60_000; // same cap for cloud so a hung call cannot stall a run
export const WARMUP_PROMPT = "Reply with one word: ok";

export interface RunModels {
  /** Null when Gemini Nano is unavailable — on-device results become N/A. */
  onDevice: ModelLike | null;
  cloud: ModelLike;
}

export interface RunOptions {
  /** Per-call latency shown while the run is in progress. */
  onProgress?: (done: number, total: number, note?: string) => void;
  /** AbortSignal from the Cancel button; checked between calls. */
  signal?: AbortSignal;
}

export interface RunSummary {
  tasksAttempted: number;
  callsDone: number;
  callsTotal: number;
  aborted: boolean;
}

/** Estimate token count as characters / 4 (spec §4 fallback). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Cloud cost in USD for one call, or null when prices are not set.
 * Prices are user-entered (spec §4) — 0 means "not set", never a real price.
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  settings: Settings,
): number | null {
  if (settings.priceInPer1M <= 0 || settings.priceOutPer1M <= 0) return null;
  return (
    (inputTokens * settings.priceInPer1M) / 1_000_000 +
    (outputTokens * settings.priceOutPer1M) / 1_000_000
  );
}

/** Token counts for a call: usage metadata when exposed, else the estimate. */
export function extractTokens(
  response: ModelResponseLike | undefined,
  prompt: string,
  output: string,
): { inputTokens: number; outputTokens: number; estimated: boolean } {
  const meta = response?.usageMetadata;
  if (
    meta &&
    Number.isFinite(meta.promptTokenCount) &&
    Number.isFinite(meta.candidatesTokenCount)
  ) {
    return {
      inputTokens: meta.promptTokenCount,
      outputTokens: meta.candidatesTokenCount,
      estimated: false,
    };
  }
  return {
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(output),
    estimated: true,
  };
}

function timeoutError(ms: number): Error {
  return new Error(`Timed out after ${Math.round(ms / 1000)} s`);
}

/** One generateContent call with a timeout. Returns text + token counts. */
async function callModel(
  model: ModelLike,
  prompt: string,
  timeoutMs: number,
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  tokensEstimated: boolean;
}> {
  const t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
    const latencyMs = Math.round(performance.now() - t0);
    const text = result.response.text();
    const tokens = extractTokens(result.response, prompt, text);
    return {
      text,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      latencyMs,
      tokensEstimated: tokens.estimated,
    };
  } finally {
    // A settled call must not leave its 60 s timer behind (it would keep
    // the Node test process alive for a full minute after the run).
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run one side (on-device or cloud) of one task. On failure the error is
 * recorded on the result (never thrown), so a run continues past a bad call.
 * Cloud calls are retried once (spec §10).
 */
async function runOneSide(
  model: ModelLike,
  task: Task,
  source: "on_device" | "cloud",
): Promise<RunResult> {
  const timeoutMs =
    source === "on_device" ? ON_DEVICE_TIMEOUT_MS : CLOUD_TIMEOUT_MS;
  const attempts = source === "cloud" ? 2 : 1; // spec §10: retry the cloud call once
  let lastError: Error | null = null;
  let lastLatency = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const t0 = performance.now();
    try {
      const call = await callModel(model, task.prompt, timeoutMs);
      return {
        taskId: task.id,
        source,
        output: call.text,
        latencyMs: call.latencyMs,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        tokensEstimated: call.tokensEstimated,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastLatency = Math.round(performance.now() - t0);
    }
  }
  return {
    taskId: task.id,
    source,
    output: "",
    latencyMs: lastLatency,
    error: lastError?.message ?? "Unknown error",
  };
}

/**
 * Run one task on both sides, sequentially (on-device first, then cloud),
 * reporting each RunResult as soon as its call finishes. When the
 * on-device model is null, the on-device result is recorded as N/A.
 */
export async function runTask(
  task: Task,
  models: RunModels,
  opts: RunOptions,
  onResult: (result: RunResult) => void,
): Promise<void> {
  if (models.onDevice) {
    const result = await runOneSide(models.onDevice, task, "on_device");
    onResult(result);
  } else {
    onResult({
      taskId: task.id,
      source: "on_device",
      output: "",
      latencyMs: 0,
      error: "On-device model unavailable in this browser — marked N/A.",
    });
  }
  if (opts.signal?.aborted) return;
  const cloudResult = await runOneSide(models.cloud, task, "cloud");
  onResult(cloudResult);
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

/**
 * Run a batch of tasks sequentially (spec §4.5), capped at 25 per run.
 * One warm-up call runs on-device before timing (spec §4.3); it is untimed
 * and its result is discarded, and a warm-up failure never stops the run.
 * The on-device model is initialised (download progress) before the first
 * call, when it is available. Returns a summary; results arrive
 * progressively through onResult.
 */
export async function runAll(
  tasks: Task[],
  models: RunModels,
  opts: RunOptions,
  onResult: (result: RunResult) => void,
): Promise<RunSummary> {
  const batch = tasks.slice(0, MAX_TASKS_PER_RUN);
  const callsTotal = batch.length * 2;
  let callsDone = 0;

  const report = (note?: string) => opts.onProgress?.(callsDone, callsTotal, note);

  // Initialise (and download, if needed) the on-device model before the
  // first timed call. Still inside the click-handler chain that started
  // the run, so the user-gesture requirement holds.
  if (models.onDevice?.initializeDeviceModel) {
    try {
      await models.onDevice.initializeDeviceModel((p) =>
        opts.onProgress?.(callsDone, callsTotal, `Downloading the on-device model… ${Math.round(p * 100)}%`),
      );
    } catch (err) {
      // A failed download surfaces on the first real on-device call.
      console.warn("On-device model init failed:", err);
    }
  }
  if (isAborted(opts.signal)) {
    return { tasksAttempted: 0, callsDone, callsTotal, aborted: true };
  }

  // One warm-up call on-device before timing (spec §4.3).
  if (models.onDevice) {
    try {
      await callModel(models.onDevice, WARMUP_PROMPT, ON_DEVICE_TIMEOUT_MS);
    } catch {
      // Warm-up is best-effort; the first real call reports real errors.
    }
  }
  if (isAborted(opts.signal)) {
    return { tasksAttempted: 0, callsDone, callsTotal, aborted: true };
  }

  let tasksAttempted = 0;
  for (const task of batch) {
    if (isAborted(opts.signal)) break;
    tasksAttempted++;
    await runTask(task, models, opts, (result) => {
      callsDone++;
      onResult(result);
      report();
    });
  }

  const aborted = isAborted(opts.signal);
  return { tasksAttempted, callsDone, callsTotal, aborted };
}
