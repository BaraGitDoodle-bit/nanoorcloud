// ---------------------------------------------------------------------------
// F5 + F6 — Routing recommendations and savings (spec §5, §6, §8).
//
// Pure functions over the runner's results and the Day 4 scores, so they
// can be unit-tested with hand-calculated numbers (see test/routing.test.ts).
// No AI calls here — the judge scores and check results are inputs.
//
// Routing (spec §6, followed exactly):
//   quality_ratio   = mean judge score on-device / mean judge score cloud,
//                     capped at 1.0
//   check_pass_rate = share of on-device runs passing the deterministic checks
//   route = on_device  if quality_ratio >= qualityThreshold
//                        AND check_pass_rate >= 0.90
//         = escalate   if quality_ratio >= escalateThreshold
//                        (on-device first, fall back to cloud when checks fail)
//         = cloud      otherwise
//   confidence = high with >= 3 runs per task, medium with 1–2,
//                low if the judge failed or the sample is tiny.
//
// Two invariants worth knowing:
//  * qualityRatio === 0 means "no judge data" (judge scores are 1–5, so a
//    real ratio is always > 0). The note always says why.
//  * checkPassRate === 0 means "no on-device runs scored" (or none passed).
//    The check threshold 0.90 is fixed by the spec — the two sliders are
//    the quality and escalate thresholds (Settings.qualityThreshold and
//    Settings.escalateThreshold, defaults 0.90 / 0.70).
//
// Savings (spec §6): per task S = N x p x c, where N is monthly requests,
// p is the share handled on-device (1 for on_device, check_pass_rate for
// escalate, 0 for cloud) and c is the average cloud cost per request.
// Total savings is the sum over tasks. This is an estimate: it assumes
// failures are caught by the checks and ignores the extra latency of
// escalations — the UI says so.
// ---------------------------------------------------------------------------

import { estimateCostUsd } from "./runner.ts";
import type {
  Recommendation,
  RunResult,
  Score,
  Settings,
  Task,
} from "./types.ts";

/** Spec §6: the check-pass bar for the on_device route (fixed, not a slider). */
export const CHECK_PASS_THRESHOLD = 0.9;

/** Spec §6: high confidence needs at least 3 runs per task. */
export const HIGH_CONFIDENCE_MIN_RUNS = 3;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean latency over successful calls only — a failed call's latency is
 *  the time to failure, not a useful comparison number. 0 when no
 *  successful call exists for that source. */
function meanLatencyMs(results: RunResult[]): number {
  const ok = results.filter((r) => !r.error);
  const m = mean(ok.map((r) => r.latencyMs));
  return m == null ? 0 : Math.round(m);
}

/** Mean cloud cost per request over the cloud results that have token
 *  counts and set prices. 0 when nothing is computable (prices unset or
 *  no cloud result) — the UI shows "—" in that case. */
function meanCloudCostUsd(
  cloudResults: RunResult[],
  settings: Settings,
): number {
  const costs: number[] = [];
  for (const r of cloudResults) {
    if (r.error || r.inputTokens == null || r.outputTokens == null) continue;
    const cost = estimateCostUsd(r.inputTokens, r.outputTokens, settings);
    if (cost != null) costs.push(cost);
  }
  return mean(costs) ?? 0;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * One task's routing recommendation from its results and scores.
 * Never throws and never returns a bare "cloud" without a reason in
 * `note` — the note is the short reason the F5 acceptance asks for.
 */
export function recommendRoute(
  task: Task,
  results: RunResult[],
  scores: Score[],
  settings: Settings,
): Recommendation {
  const onDeviceResults = results.filter((r) => r.source === "on_device");
  const cloudResults = results.filter((r) => r.source === "cloud");
  const onScores = scores.filter((s) => s.source === "on_device");
  const cloudScores = scores.filter((s) => s.source === "cloud");

  const onJudge = onScores
    .map((s) => s.judgeScore)
    .filter((x): x is number => x != null);
  const cloudJudge = cloudScores
    .map((s) => s.judgeScore)
    .filter((x): x is number => x != null);
  const meanOn = mean(onJudge);
  const meanCloud = mean(cloudJudge);
  const judgeFailed = meanOn == null || meanCloud == null || meanCloud <= 0;
  // Capped at 1.0 per spec; 0 is the documented "no judge data" value.
  const qualityRatio = judgeFailed
    ? 0
    : Math.min(1, (meanOn as number) / (meanCloud as number));

  const checkPassRate =
    onScores.length === 0
      ? 0
      : onScores.filter((s) => s.checksPassed).length / onScores.length;

  const runsPerTask = onDeviceResults.length;

  let route: Recommendation["route"];
  if (
    !judgeFailed &&
    qualityRatio >= settings.qualityThreshold &&
    checkPassRate >= CHECK_PASS_THRESHOLD
  ) {
    route = "on_device";
  } else if (!judgeFailed && qualityRatio >= settings.escalateThreshold) {
    route = "escalate";
  } else {
    route = "cloud";
  }

  const confidence: Recommendation["confidence"] = judgeFailed
    ? "low"
    : runsPerTask >= HIGH_CONFIDENCE_MIN_RUNS
      ? "high"
      : runsPerTask >= 1
        ? "medium"
        : "low";

  let note: string;
  if (onDeviceResults.length === 0) {
    note = "No on-device runs in this browser — cloud only.";
  } else if (judgeFailed) {
    note =
      "Judge failed or was skipped, so there is no quality comparison — cloud is the safe default.";
  } else if (route === "on_device") {
    note = `On-device quality is ${pct(qualityRatio)} of cloud and it passes ${pct(checkPassRate)} of checks — route on-device.`;
  } else if (route === "escalate") {
    note =
      qualityRatio >= settings.qualityThreshold
        ? `On-device quality is ${pct(qualityRatio)} of cloud, but it only passes ${pct(checkPassRate)} of checks — try on-device first, fall back to cloud when checks fail.`
        : `On-device quality is ${pct(qualityRatio)} of cloud — try on-device first, fall back to cloud when checks fail.`;
  } else if (qualityRatio >= settings.qualityThreshold) {
    note = `On-device quality is high (${pct(qualityRatio)} of cloud) but it only passes ${pct(checkPassRate)} of checks — keep on cloud.`;
  } else {
    note = `On-device quality is only ${pct(qualityRatio)} of cloud — keep on cloud.`;
  }

  return {
    taskId: task.id,
    route,
    qualityRatio,
    checkPassRate,
    latencyOnDeviceMs: meanLatencyMs(onDeviceResults),
    latencyCloudMs: meanLatencyMs(cloudResults),
    avgCloudCostUsd: meanCloudCostUsd(cloudResults, settings),
    confidence,
    note,
  };
}

/**
 * Recommendations for every task that has at least one result. Tasks
 * that were never run get no recommendation (the Report screen says so
 * instead of inventing one).
 */
export function buildRecommendations(
  tasks: Task[],
  results: RunResult[],
  scores: Score[],
  settings: Settings,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const task of tasks) {
    const taskResults = results.filter((r) => r.taskId === task.id);
    if (taskResults.length === 0) continue;
    const taskScores = scores.filter((s) => s.taskId === task.id);
    recs.push(recommendRoute(task, taskResults, taskScores, settings));
  }
  return recs;
}

// ---------------------------------------------------------------------------
// F6 — Savings (spec §6).
// ---------------------------------------------------------------------------

export interface TaskSavings {
  taskId: string;
  monthlyRequests: number;
  route: Recommendation["route"];
  /** Share of requests handled on-device: 1 / checkPassRate / 0. */
  shareOnDevice: number;
  avgCloudCostUsd: number;
  costBeforeUsd: number;
  costAfterUsd: number;
  savingsUsd: number;
}

export interface SavingsSummary {
  perTask: TaskSavings[];
  totalBeforeUsd: number;
  totalAfterUsd: number;
  totalSavingsUsd: number;
  /** False when prices are unset — costs are then 0 and the UI must
   *  show "—" instead of a $0 that would look like real savings. */
  pricesSet: boolean;
}

/**
 * Monthly cloud cost before routing (everything on cloud), after routing
 * (only the share that stays on cloud), and the savings — per task and
 * in total. costBefore - costAfter === savings by construction.
 * Tasks without a monthly volume contribute 0 and are still listed, so
 * the UI can point at the missing input.
 */
export function computeSavings(
  tasks: Task[],
  recommendations: Recommendation[],
  settings: Settings,
): SavingsSummary {
  const pricesSet =
    settings.priceInPer1M > 0 && settings.priceOutPer1M > 0;
  const perTask: TaskSavings[] = [];
  let totalBeforeUsd = 0;
  let totalAfterUsd = 0;
  let totalSavingsUsd = 0;

  for (const rec of recommendations) {
    const task = tasks.find((t) => t.id === rec.taskId);
    const monthlyRequests = task?.monthlyRequests ?? 0;
    const shareOnDevice =
      rec.route === "on_device"
        ? 1
        : rec.route === "escalate"
          ? rec.checkPassRate
          : 0;
    const costBeforeUsd = monthlyRequests * rec.avgCloudCostUsd;
    const costAfterUsd = monthlyRequests * rec.avgCloudCostUsd * (1 - shareOnDevice);
    const savingsUsd = monthlyRequests * shareOnDevice * rec.avgCloudCostUsd;
    perTask.push({
      taskId: rec.taskId,
      monthlyRequests,
      route: rec.route,
      shareOnDevice,
      avgCloudCostUsd: rec.avgCloudCostUsd,
      costBeforeUsd,
      costAfterUsd,
      savingsUsd,
    });
    totalBeforeUsd += costBeforeUsd;
    totalAfterUsd += costAfterUsd;
    totalSavingsUsd += savingsUsd;
  }

  return {
    perTask,
    totalBeforeUsd,
    totalAfterUsd,
    totalSavingsUsd,
    pricesSet,
  };
}
