// ---------------------------------------------------------------------------
// F7 + F8 — Report export and sample report loading (spec §5).
//
// Pure builders (unit-tested, see test/export.test.ts):
//   buildReportExport    — one JSON-serializable report object: the tasks,
//                          the results with their scores merged in, the
//                          recommendations and the savings summary.
//   serializeReportJson  — the same object as pretty-printed JSON.
//   buildRoutingConfigTs — a TypeScript snippet mapping each task id to a
//                          Firebase AI Logic InferenceMode, per spec §4:
//                          on_device -> PREFER_ON_DEVICE,
//                          cloud -> ONLY_IN_CLOUD, escalate -> "ESCALATE"
//                          (not an InferenceMode: try on-device first,
//                          validate with your checks, fall back to cloud).
//   loadSampleReport     — validates the bundled sample JSON (F8); returns
//                          null instead of trusting a malformed file.
//
// Browser helpers (called only from click handlers, not unit-tested):
//   downloadText — Blob + anchor download. copyText — Clipboard API with
//   a textarea fallback for browsers without clipboard permission.
// ---------------------------------------------------------------------------

import type { SavingsSummary } from "./routing.ts";
import type {
  Recommendation,
  RunResult,
  SampleReport,
  Score,
  Settings,
  Task,
} from "./types.ts";

export interface ReportExport {
  app: "NanoOrCloud";
  version: 1;
  generatedAt: string;
  /** True when the report is the bundled demo data (F8), not a live run. */
  sample: boolean;
  settings: {
    qualityThreshold: number;
    escalateThreshold: number;
    priceInPer1M: number;
    priceOutPer1M: number;
    cloudModel?: string;
  };
  tasks: {
    id: string;
    name: string;
    type: string;
    monthlyRequests: number;
  }[];
  results: {
    taskId: string;
    source: "on_device" | "cloud";
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
    checksPassed?: boolean;
    judgeScore?: number;
  }[];
  recommendations: Recommendation[];
  savings: {
    totalBeforeUsd: number;
    totalAfterUsd: number;
    totalSavingsUsd: number;
    pricesSet: boolean;
    perTask: SavingsSummary["perTask"];
  };
}

export interface BuildReportInput {
  tasks: Task[];
  results: RunResult[];
  scores: Score[];
  recommendations: Recommendation[];
  savings: SavingsSummary;
  settings: Settings;
  sample: boolean;
  /** Overridable for tests; defaults to new Date().toISOString(). */
  generatedAt?: string;
}

export function buildReportExport(input: BuildReportInput): ReportExport {
  const scoreByKey = new Map(
    input.scores.map((s) => [`${s.taskId}:${s.source}`, s]),
  );
  return {
    app: "NanoOrCloud",
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sample: input.sample,
    settings: {
      qualityThreshold: input.settings.qualityThreshold,
      escalateThreshold: input.settings.escalateThreshold,
      priceInPer1M: input.settings.priceInPer1M,
      priceOutPer1M: input.settings.priceOutPer1M,
      ...(input.settings.cloudModel
        ? { cloudModel: input.settings.cloudModel }
        : {}),
    },
    tasks: input.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      monthlyRequests: t.monthlyRequests ?? 0,
    })),
    results: input.results.map((r) => {
      const s = scoreByKey.get(`${r.taskId}:${r.source}`);
      return {
        taskId: r.taskId,
        source: r.source,
        latencyMs: r.latencyMs,
        ...(r.inputTokens != null ? { inputTokens: r.inputTokens } : {}),
        ...(r.outputTokens != null ? { outputTokens: r.outputTokens } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(s ? { checksPassed: s.checksPassed } : {}),
        ...(s?.judgeScore != null ? { judgeScore: s.judgeScore } : {}),
      };
    }),
    recommendations: input.recommendations,
    savings: {
      totalBeforeUsd: input.savings.totalBeforeUsd,
      totalAfterUsd: input.savings.totalAfterUsd,
      totalSavingsUsd: input.savings.totalSavingsUsd,
      pricesSet: input.savings.pricesSet,
      perTask: input.savings.perTask,
    },
  };
}

export function serializeReportJson(report: ReportExport): string {
  return JSON.stringify(report, null, 2);
}

/** Spec §4: the InferenceMode for a route. "ESCALATE" is not an
 *  InferenceMode — the snippet says so next to it. */
export function routingModeFor(
  route: Recommendation["route"],
): "PREFER_ON_DEVICE" | "ONLY_IN_CLOUD" | "ESCALATE" {
  return route === "on_device"
    ? "PREFER_ON_DEVICE"
    : route === "cloud"
      ? "ONLY_IN_CLOUD"
      : "ESCALATE";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Task names/reasons are user text — a newline or "//" in them must not
 *  break the generated comment. */
function oneLineComment(text: string): string {
  return truncate(text.replace(/[\r\n]+/g, " ").trim(), 110);
}

export function buildRoutingConfigTs(report: ReportExport): string {
  const nameById = new Map(report.tasks.map((t) => [t.id, t.name]));
  const lines = report.recommendations.map((rec) => {
    const comment = oneLineComment(
      `${nameById.get(rec.taskId) ?? rec.taskId} — ${rec.note}`,
    );
    return `  "${rec.taskId}": "${routingModeFor(rec.route)}", // ${comment}`;
  });
  return [
    `// NanoOrCloud routing config — generated ${report.generatedAt}.`,
    ...(report.sample
      ? ["// Generated from a SAMPLE report (bundled demo data)."]
      : []),
    "// Map each task to a Firebase AI Logic InferenceMode:",
    "// on_device -> PREFER_ON_DEVICE, cloud -> ONLY_IN_CLOUD.",
    '// "ESCALATE" is not an InferenceMode: try on-device first, validate',
    "// the output with your checks, and fall back to cloud when a check fails.",
    "",
    "export const routingConfig = {",
    ...lines,
    "} as const;",
    "",
  ].join("\n");
}

/**
 * Validate the bundled sample JSON. Returns null on any structural
 * problem instead of throwing — the Report screen hides the sample
 * button when the file is unusable, so the app keeps working.
 */
export function loadSampleReport(value: unknown): SampleReport | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !Array.isArray(v.tasks) ||
    !Array.isArray(v.results) ||
    !Array.isArray(v.scores)
  ) {
    return null;
  }
  if (!v.settings || typeof v.settings !== "object") return null;
  const s = v.settings as Record<string, unknown>;
  if (
    typeof s.qualityThreshold !== "number" ||
    typeof s.escalateThreshold !== "number" ||
    typeof s.priceInPer1M !== "number" ||
    typeof s.priceOutPer1M !== "number"
  ) {
    return null;
  }
  for (const t of v.tasks as Record<string, unknown>[]) {
    if (
      !t ||
      typeof t.id !== "string" ||
      typeof t.name !== "string" ||
      typeof t.type !== "string" ||
      typeof t.prompt !== "string"
    ) {
      return null;
    }
  }
  return value as SampleReport;
}

// ---------------------------------------------------------------------------
// Browser helpers (click handlers only).
// ---------------------------------------------------------------------------

export function downloadText(
  filename: string,
  text: string,
  mime: string,
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the download can start first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
