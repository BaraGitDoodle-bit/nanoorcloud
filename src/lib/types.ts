// ---------------------------------------------------------------------------
// Data types for NanoOrCloud — spec §8, verbatim. Shared by the runner (Day 2),
// the task editor (Day 3), scoring (Day 4) and routing/savings (Day 5).
// ---------------------------------------------------------------------------

export type TaskType =
  | "summarize"
  | "classify"
  | "extract_json"
  | "rewrite"
  | "qa";

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  prompt: string;
  referenceAnswer?: string;
  expectedJsonKeys?: string[];
  monthlyRequests?: number;
}

export interface RunResult {
  taskId: string;
  source: "on_device" | "cloud";
  output: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  /** Display hint (not in the spec §8 shape): true when the token counts
   *  were estimated as characters / 4 because the response carried no
   *  usage metadata. Lets the UI label costs as estimates honestly. */
  tokensEstimated?: boolean;
}

export interface Score {
  taskId: string;
  source: "on_device" | "cloud";
  checksPassed: boolean;
  judgeScore?: number;
  judgeRationale?: string;
}

export interface Recommendation {
  taskId: string;
  route: "on_device" | "escalate" | "cloud";
  qualityRatio: number;
  checkPassRate: number;
  latencyOnDeviceMs: number;
  latencyCloudMs: number;
  avgCloudCostUsd: number;
  confidence: "low" | "medium" | "high";
  note: string;
}

export interface Settings {
  cloudModel?: string;
  priceInPer1M: number;
  priceOutPer1M: number;
  qualityThreshold: number;
  escalateThreshold: number;
}

/** Defaults from the spec: thresholds §6 (0.90 / 0.70). Prices are NOT
 *  hard-coded (spec §4) — 0 means "not set yet", and cost displays as "—"
 *  until the user enters prices.
 *
 *  Cloud model: the spec says "defaulting to the SDK default", but the
 *  Firebase JS SDK 12.19.0 default is gemini-2.5-flash-lite, which the
 *  official AI Logic models doc lists as deprecated (replacement
 *  gemini-3.5-flash-lite; see firebase.google.com/docs/ai-logic/models).
 *  The default is therefore the current replacement; the user can still
 *  change it in the Run screen. */
export const DEFAULT_SETTINGS: Settings = {
  cloudModel: "gemini-3.5-flash-lite",
  priceInPer1M: 0,
  priceOutPer1M: 0,
  qualityThreshold: 0.9,
  escalateThreshold: 0.7,
};

/**
 * A snapshot of a run's data, owned by App.tsx so it survives switching
 * between the Run and Report screens (each screen unmounts when hidden).
 * NOT a spec §8 type — app state only. RunScreen syncs its live data
 * here as results arrive and restores from it when it remounts; the
 * Report screen reads it. The inline shapes match RunSummary (runner.ts)
 * and the judge info RunScreen keeps, so assignment is structural.
 */
export interface RunSnapshot {
  results: RunResult[];
  scores: Record<string, Score>;
  /** Failed-check detail lines behind each Score (shape matches
   *  DeterministicCheck in scoring.ts; inlined here to avoid a
   *  types.ts -> scoring.ts import cycle). */
  checkDetails: Record<
    string,
    { name: string; passed: boolean; detail: string }[]
  >;
  judgeInfo: Record<
    string,
    { a?: "on_device" | "cloud"; b?: "on_device" | "cloud"; error?: string }
  >;
  summary: {
    tasksAttempted: number;
    callsDone: number;
    callsTotal: number;
    aborted: boolean;
  } | null;
}

/**
 * Bundled demo report (src/data/sample-report.json, F8) — a recorded run
 * rendered in the Report screen so visitors without Gemini Nano can see
 * the product. The file is validated by loadSampleReport (export.ts) and
 * by test/sample-report.test.ts; the UI never trusts it blindly.
 */
export interface SampleReport {
  label: string;
  note: string;
  generatedAt: string;
  settings: Settings;
  tasks: Task[];
  results: RunResult[];
  scores: Score[];
}
