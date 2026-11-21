// ---------------------------------------------------------------------------
// F3 — Side-by-side runner screen (spec §5, §7 "Run").
//
// Runs the current task list (edited on the Tasks screen, Day 3 — the
// 5 starter presets by default) on-device and in the cloud, sequentially,
// and shows outputs, latency, estimated cost and errors in a table that
// fills in progressively as each call finishes. Progress bar + Cancel
// button (spec §4.5). Prices are user-entered (spec §4) — cost shows "—"
// until prices are set; on-device cost is always $0.
//
// Done when a 5-task run completes and results appear progressively.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../lib/brand.ts";
import {
  createCloudModel,
  createJudgeModel,
  createOnDeviceModel,
  initFirebase,
  isConfigured,
} from "../lib/firebase.ts";
import { estimateCostUsd, runAll, type ModelLike, type RunSummary } from "../lib/runner.ts";
import {
  judgePair,
  runDeterministicChecks,
  type DeterministicCheck,
  type Source,
} from "../lib/scoring.ts";
import { loadSettings, saveSettings } from "../lib/settings.ts";
import type { OnDeviceStatus } from "../lib/env.ts";
import type {
  RunResult,
  RunSnapshot,
  Score,
  Settings,
  Task,
} from "../lib/types.ts";

const OUTPUT_PREVIEW_CHARS = 280;

function formatUsd(value: number): string {
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatCost(result: RunResult, settings: Settings): string {
  if (result.error) return "—";
  if (result.source === "on_device") return "$0.00";
  if (result.inputTokens == null || result.outputTokens == null) return "—";
  const cost = estimateCostUsd(
    result.inputTokens,
    result.outputTokens,
    settings,
  );
  return cost == null ? "—" : formatUsd(cost);
}

function formatTokens(result: RunResult): string {
  if (result.inputTokens == null || result.outputTokens == null) return "—";
  const mark = result.tokensEstimated ? " (est.)" : "";
  return `${result.inputTokens} in · ${result.outputTokens} out${mark}`;
}

export default function RunScreen({
  tasks,
  initialSnapshot,
  onSnapshot,
}: {
  tasks: Task[];
  /** The last run's data, owned by App.tsx — restored here when this
   *  screen remounts after a tab switch, so results survive going to
   *  the Report screen and back. */
  initialSnapshot?: RunSnapshot | null;
  /** Called whenever the run data changes; App.tsx stores it for the
   *  Report screen. */
  onSnapshot?: (snap: RunSnapshot) => void;
}) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [onDevice, setOnDevice] = useState<OnDeviceStatus>("checking");
  const [results, setResults] = useState<RunResult[]>(
    () => initialSnapshot?.results ?? [],
  );
  // F4 scoring: one Score per result (key `${taskId}:${source}`), the
  // detailed check list behind it, and the judge's blind A/B assignment
  // per task (key taskId). Scores are filled in as results arrive;
  // judge fields land when the per-task judge call returns.
  const [scores, setScores] = useState<Record<string, Score>>(
    () => initialSnapshot?.scores ?? {},
  );
  const [checkDetails, setCheckDetails] = useState<
    Record<string, DeterministicCheck[]>
  >(() => initialSnapshot?.checkDetails ?? {});
  const [judgeInfo, setJudgeInfo] = useState<
    Record<string, { a?: Source; b?: Source; error?: string }>
  >(() => initialSnapshot?.judgeInfo ?? {});
  const [judgeNote, setJudgeNote] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, note: "" });
  const [summary, setSummary] = useState<RunSummary | null>(
    () => initialSnapshot?.summary ?? null,
  );
  const [runError, setRunError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const runStartedAt = useRef(0);
  // Refs for the scoring pipeline: results seen so far (pair detection),
  // the judge model (created in the click handler), a queue keeping
  // judge calls sequential, and the set of tasks already judged.
  // Restored from the snapshot so a remount does not re-judge tasks.
  const resultsRef = useRef<RunResult[]>(initialSnapshot?.results ?? []);
  const judgeModelRef = useRef<ModelLike | null>(null);
  const judgeInitErrorRef = useRef("");
  const judgeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const judgedRef = useRef<Set<string>>(
    new Set(Object.keys(initialSnapshot?.judgeInfo ?? {})),
  );

  useEffect(() => {
    setFirebaseReady(initFirebase());
    (async () => {
      try {
        if (typeof LanguageModel === "undefined") {
          setOnDevice("unknown");
          return;
        }
        setOnDevice(await LanguageModel.availability());
      } catch {
        setOnDevice("unknown");
      }
    })();
  }, []);

  // Sync the run data up to App.tsx whenever it changes, so the Report
  // screen (which reads it from App) always sees the latest results and
  // scores. Runs on mount too, which re-sends the restored snapshot.
  useEffect(() => {
    onSnapshot?.({ results, scores, checkDetails, judgeInfo, summary });
  }, [results, scores, checkDetails, judgeInfo, summary, onSnapshot]);

  const onDeviceUsable =
    onDevice === "available" ||
    onDevice === "downloading" ||
    onDevice === "downloadable";

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  function scoreKey(taskId: string, source: Source): string {
    return `${taskId}:${source}`;
  }

  /** Store a Score (and its check details) for one result. */
  function putScore(score: Score, checks?: DeterministicCheck[]) {
    setScores((prev) => ({ ...prev, [scoreKey(score.taskId, score.source)]: score }));
    if (checks) {
      setCheckDetails((prev) => ({
        ...prev,
        [scoreKey(score.taskId, score.source)]: checks,
      }));
    }
  }

  /** Run the deterministic checks for a result as soon as it arrives. */
  function scoreArrival(task: Task, result: RunResult) {
    const { checksPassed, checks } = runDeterministicChecks(task, result);
    putScore(
      { taskId: result.taskId, source: result.source, checksPassed },
      checks,
    );
  }

  /**
   * When both sides of a task have results, score the pair with the
   * cloud judge (blind A/B). Judge calls run sequentially on a queue so
   * they never overlap; a cancelled run skips pending judges and marks
   * their scores "Not judged — run cancelled." instead.
   */
  function maybeJudge(taskId: string) {
    if (judgedRef.current.has(taskId)) return;
    const pair = resultsRef.current.filter((r) => r.taskId === taskId);
    const onDevice = pair.find((r) => r.source === "on_device");
    const cloud = pair.find((r) => r.source === "cloud");
    if (!onDevice || !cloud) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    judgedRef.current.add(taskId);

    const markNotJudged = (reason: string) => {
      for (const result of [onDevice, cloud]) {
        setScores((prev) => {
          const existing = prev[scoreKey(result.taskId, result.source)];
          if (!existing) return prev;
          return {
            ...prev,
            [scoreKey(result.taskId, result.source)]: {
              ...existing,
              judgeRationale: reason,
            },
          };
        });
      }
      setJudgeInfo((prev) => ({ ...prev, [taskId]: { error: reason } }));
    };

    const model = judgeModelRef.current;
    if (!model) {
      markNotJudged(
        `Not judged — judge unavailable: ${judgeInitErrorRef.current || "no judge model"}.`,
      );
      return;
    }

    judgeQueueRef.current = judgeQueueRef.current.then(async () => {
      const signal = abortRef.current?.signal;
      if (signal?.aborted) {
        markNotJudged("Not judged — run cancelled.");
        return;
      }
      try {
        const outcome = await judgePair(model, task, onDevice, cloud);
        if (signal?.aborted) {
          markNotJudged("Not judged — run cancelled.");
          return;
        }
        putScore(outcome.scores.on_device);
        putScore(outcome.scores.cloud);
        setJudgeInfo((prev) => ({
          ...prev,
          [taskId]: outcome.ab
            ? { a: outcome.ab.a, b: outcome.ab.b, error: outcome.judgeError }
            : { error: outcome.judgeError ?? "Not judged." },
        }));
      } catch (err) {
        // judgePair never throws, but never let a judge failure crash
        // the run or stall the queue.
        markNotJudged(
          `Judge failed: ${(err as Error).message || String(err)}`,
        );
      }
    });
  }

  /** After a run ends, give every unjudged result a clear final state. */
  function finalizeScores(aborted: boolean) {
    for (const result of resultsRef.current) {
      if (judgedRef.current.has(result.taskId)) continue;
      judgedRef.current.add(result.taskId);
      const reason = aborted
        ? "Not judged — run cancelled."
        : "Not judged — incomplete results.";
      setScores((prev) => {
        const existing = prev[scoreKey(result.taskId, result.source)];
        if (!existing || existing.judgeRationale) return prev;
        return {
          ...prev,
          [scoreKey(result.taskId, result.source)]: {
            ...existing,
            judgeRationale: reason,
          },
        };
      });
    }
  }

  async function startRun() {
    if (running) return;
    if (!firebaseReady) {
      setRunError(
        "Firebase is not configured — copy .env.example to .env and fill in the routewise-web config.",
      );
      return;
    }
    setRunError("");
    setResults([]);
    setScores({});
    setCheckDetails({});
    setJudgeInfo({});
    setJudgeNote("");
    setSummary(null);
    setProgress({ done: 0, total: tasks.length * 2, note: "" });
    setRunning(true);
    runStartedAt.current = performance.now();
    resultsRef.current = [];
    judgedRef.current = new Set();
    judgeQueueRef.current = Promise.resolve();

    const controller = new AbortController();
    abortRef.current = controller;

    // Judge model (cloud-only, structured JSON output when a model name
    // is set) — created inside the click handler like the run models.
    try {
      judgeModelRef.current = createJudgeModel(settings.cloudModel);
      judgeInitErrorRef.current = "";
    } catch (err) {
      judgeModelRef.current = null;
      judgeInitErrorRef.current = (err as Error).message || String(err);
      setJudgeNote(
        `Judge unavailable: ${judgeInitErrorRef.current} — results will show deterministic checks only.`,
      );
    }

    const handleResult = (r: RunResult) => {
      resultsRef.current = [...resultsRef.current, r];
      setResults((prev) => [...prev, r]);
      const task = tasks.find((t) => t.id === r.taskId);
      if (task) {
        scoreArrival(task, r);
        maybeJudge(r.taskId);
      }
    };

    try {
      // Model instances are created inside the click handler (spec §4.1).
      const cloud = createCloudModel(settings.cloudModel);
      const onDeviceModel = onDeviceUsable ? createOnDeviceModel() : null;
      const result = await runAll(
        tasks,
        { onDevice: onDeviceModel, cloud },
        {
          signal: controller.signal,
          onProgress: (done, total, note) =>
            setProgress({ done, total, note: note ?? "" }),
        },
        handleResult,
      );
      finalizeScores(result.aborted);
      setSummary(result);
    } catch (err) {
      setRunError((err as Error).message || String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  const errors = results.filter((r) => r.error).length;
  const cloudCost = results
    .filter((r) => r.source === "cloud" && !r.error)
    .reduce((sum, r) => {
      const cost = estimateCostUsd(
        r.inputTokens ?? 0,
        r.outputTokens ?? 0,
        settings,
      );
      return sum + (cost ?? 0);
    }, 0);
  const costKnown = settings.priceInPer1M > 0 && settings.priceOutPer1M > 0;
  const totalMs = summary
    ? Math.round(performance.now() - runStartedAt.current)
    : null;

  // F4 scoring tallies for the summary line.
  const scoreList = Object.values(scores);
  const checksPassedCount = scoreList.filter((s) => s.checksPassed).length;
  const judgedCount = scoreList.filter((s) => s.judgeScore != null).length;
  const judgeFailedTasks = Object.values(judgeInfo).filter(
    (j) => j.error,
  ).length;
  const pairsComplete = new Set<string>();
  {
    const seen = new Map<string, Set<Source>>();
    for (const r of results) {
      const set = seen.get(r.taskId) ?? new Set<Source>();
      set.add(r.source);
      seen.set(r.taskId, set);
      if (set.size === 2) pairsComplete.add(r.taskId);
    }
  }
  const judgingPending = [...pairsComplete].filter(
    (id) => !(id in judgeInfo),
  ).length;

  /** Score cell for one result row (F4). */
  function scoreCell(r: RunResult) {
    const score = scores[scoreKey(r.taskId, r.source)];
    const checks = checkDetails[scoreKey(r.taskId, r.source)] ?? [];
    const failedChecks = checks.filter((c) => !c.passed);
    const info = judgeInfo[r.taskId];
    const pairDone = results.filter((x) => x.taskId === r.taskId).length >= 2;
    return (
      <div>
        {score ? (
          score.checksPassed ? (
            <span className="status ok">✓ Checks passed</span>
          ) : (
            <span className="status error">✗ Checks failed</span>
          )
        ) : (
          <span className="muted">—</span>
        )}
        {failedChecks.map((c) => (
          <div key={c.name} className="score-detail" title={c.detail}>
            ✗ {c.name}: {c.detail}
          </div>
        ))}
        {score?.judgeScore != null ? (
          <div>
            <span className="status ok">Judge: {score.judgeScore}/5</span>
            {score.judgeRationale && (
              <div className="score-detail">{score.judgeRationale}</div>
            )}
          </div>
        ) : score?.judgeRationale ? (
          <div className="score-detail">{score.judgeRationale}</div>
        ) : score ? (
          <div className="score-detail">
            {pairDone ? "Judging…" : "Waiting for the other side…"}
          </div>
        ) : null}
        {info?.a && (
          <div className="score-detail">
            Judge saw A = {info.a === "on_device" ? "On-device" : "Cloud"},
            B = {info.b === "on_device" ? "On-device" : "Cloud"} (random
            order)
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="card" aria-label="Run tasks side by side">
      <h2>Run — side by side</h2>
      <p className="muted">
        Runs each task on-device (Gemini Nano,{" "}
        <code>ONLY_ON_DEVICE</code>) and in the cloud (Gemini,{" "}
        <code>ONLY_IN_CLOUD</code>), sequentially, and shows outputs,
        latency, estimated cost and errors as they arrive. One warm-up call
        runs on-device before timing. On-device cost is $0; cloud cost is
        an estimate from the prices you enter below. Each result is scored
        as it arrives: deterministic checks (non-empty, valid JSON with
        expected keys, length bounds) plus a cloud judge score 1–5. The
        judge sees the outputs as A and B in random order, so it is blind
        to which came from on-device or the cloud.
      </p>

      {!onDeviceUsable && onDevice !== "checking" && (
        <p className="status warn" id="cloud-only-note">
          On-device model is {onDevice} in this browser, so this run is
          cloud-only — on-device rows will show N/A. Enable the Prompt API
          flag on the Setup screen for full side-by-side runs.
        </p>
      )}

      <div className="settings-row" id="run-settings">
        <label>
          Cloud model
          <input
            type="text"
            value={settings.cloudModel ?? ""}
            placeholder="SDK default"
            disabled={running}
            onChange={(e) =>
              updateSettings({
                cloudModel: e.target.value.trim() || undefined,
              })
            }
            aria-label="Cloud model name (optional, SDK default if empty)"
          />
        </label>
        <label>
          Input price $ / 1M tokens
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.priceInPer1M || ""}
            placeholder="e.g. 0.10"
            disabled={running}
            onChange={(e) =>
              updateSettings({ priceInPer1M: Number(e.target.value) || 0 })
            }
            aria-label="Input price in USD per 1M tokens"
          />
        </label>
        <label>
          Output price $ / 1M tokens
          <input
            type="number"
            min="0"
            step="0.01"
            value={settings.priceOutPer1M || ""}
            placeholder="e.g. 0.40"
            disabled={running}
            onChange={(e) =>
              updateSettings({ priceOutPer1M: Number(e.target.value) || 0 })
            }
            aria-label="Output price in USD per 1M tokens"
          />
        </label>
      </div>

      <h3>Tasks to run ({tasks.length})</h3>
      {tasks.length === 0 ? (
        <p className="status warn" id="no-tasks-to-run">
          No tasks to run — add tasks on the Tasks screen first.
        </p>
      ) : (
        <ul className="task-list" id="run-task-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong>{" "}
              <span className="muted">({t.type})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        Tasks come from the Tasks screen — add, edit, or delete them there;
        the next run uses the current list.
      </p>

      <div className="run-controls">
        <button
          type="button"
          className="primary"
          onClick={startRun}
          disabled={running || !isConfigured() || tasks.length === 0}
          id="run-all-btn"
        >
          {running ? "Running…" : `Run all ${tasks.length} tasks`}
        </button>
        {running && (
          <button
            type="button"
            className="secondary"
            onClick={cancelRun}
            id="cancel-run-btn"
          >
            Cancel
          </button>
        )}
      </div>

      {runError && (
        <p className="status error" id="run-error">
          Run failed: {runError}
        </p>
      )}

      {judgeNote && (
        <p className="status warn" id="judge-note">
          {judgeNote}
        </p>
      )}

      {(running || results.length > 0) && (
        <div id="run-progress" aria-live="polite">
          <progress
            value={progress.done}
            max={progress.total || 1}
            aria-label="Run progress"
          />{" "}
          <span>
            {progress.done} / {progress.total} calls
            {progress.note ? ` — ${progress.note}` : ""}
          </span>
        </div>
      )}

      {summary && (
        <p className="status" id="run-summary">
          {summary.aborted
            ? `Cancelled after ${summary.callsDone} of ${summary.callsTotal} calls.`
            : `Run finished in ${totalMs != null ? (totalMs / 1000).toFixed(1) : "?"} s: ${summary.callsDone} calls, ${errors} error${errors === 1 ? "" : "s"}.`}
          {" "}Cloud cost this run:{" "}
          {costKnown ? `${formatUsd(cloudCost)} (estimate)` : "— (enter prices above to estimate cost)"}.
          {" "}Scores: {judgedCount} of {results.length} result
          {results.length === 1 ? "" : "s"} have a judge score;{" "}
          {checksPassedCount} passed the deterministic checks.
          {judgingPending > 0 && ` Judging ${judgingPending} task${judgingPending === 1 ? "" : "s"}…`}
          {judgeFailedTasks > 0 &&
            ` ${judgeFailedTasks} task${judgeFailedTasks === 1 ? "" : "s"} could not be judged — see the Score column.`}
        </p>
      )}

      {results.length > 0 && (
        <table className="results-table" id="results-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Source</th>
              <th>Output</th>
              <th>Latency</th>
              <th>Tokens</th>
              <th>Est. cost</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const task = tasks.find((t) => t.id === r.taskId);
              return (
                <tr key={`${r.taskId}-${r.source}-${i}`}>
                  <td>{task?.name ?? r.taskId}</td>
                  <td>
                    <span
                      className={
                        r.source === "on_device" ? "pill pill-ok" : "pill pill-cloud"
                      }
                    >
                      {r.source === "on_device" ? "On-device" : "Cloud"}
                    </span>
                  </td>
                  <td>
                    {r.error ? (
                      <span className="muted">—</span>
                    ) : r.output.length > OUTPUT_PREVIEW_CHARS ? (
                      <details>
                        <summary>
                          {r.output.slice(0, OUTPUT_PREVIEW_CHARS)}…
                        </summary>
                        <pre className="result-text">{r.output}</pre>
                      </details>
                    ) : (
                      <span className="output-cell">{r.output}</span>
                    )}
                  </td>
                  <td>{r.error ? "—" : `${r.latencyMs.toLocaleString()} ms`}</td>
                  <td>{formatTokens(r)}</td>
                  <td>{formatCost(r, settings)}</td>
                  <td>
                    {r.error ? (
                      <span className="status error" title={r.error}>
                        Error
                      </span>
                    ) : (
                      <span className="status ok">OK</span>
                    )}
                    {r.error && <div className="error-text">{r.error}</div>}
                  </td>
                  <td>{scoreCell(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {results.length === 0 && !running && tasks.length > 0 && (
        <p className="muted" id="no-results">
          No results yet — run the {tasks.length} task
          {tasks.length === 1 ? "" : "s"} to compare on-device vs cloud.
        </p>
      )}

      <p className="muted">
        {APP_NAME} runs tasks sequentially (max 25 per run). Prompts stay
        in this browser; cloud calls go to the Gemini API through Firebase
        AI Logic. Do not paste secrets or personal data.
      </p>
    </section>
  );
}
