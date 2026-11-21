// ---------------------------------------------------------------------------
// F5 + F6 — Report screen (spec §5, §6, §7 "Report").
//
// Shows, for every task that has run results, its routing recommendation
// (on_device / escalate / cloud, confidence, short reason) and the
// savings summary (monthly cloud cost before and after routing, and the
// savings). The computation lives in src/lib/routing.ts (pure, tested
// with hand-calculated numbers); this component only displays it.
//
// Thresholds are sliders here (§6: "All thresholds are sliders with the
// defaults above") — moving one recomputes the recommendations and the
// savings live, because they are pure functions of results + settings.
// Settings are the same localStorage settings the Run screen uses
// (loadSettings/saveSettings), so a change here is visible there after
// switching tabs. Prices and monthly volumes are NOT edited here —
// prices live on the Run screen, volumes on the Tasks screen; this screen
// says so when they are missing.
//
// Export (JSON / TypeScript) and sample report mode are Day 6 (F7/F8),
// not this screen.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  buildRecommendations,
  computeSavings,
} from "../lib/routing.ts";
import { loadSettings, saveSettings } from "../lib/settings.ts";
import type {
  Recommendation,
  RunSnapshot,
  Settings,
  Task,
} from "../lib/types.ts";

function formatUsd(value: number): string {
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function routeLabel(route: Recommendation["route"]): string {
  return route === "on_device"
    ? "On-device"
    : route === "escalate"
      ? "Escalate"
      : "Cloud";
}

function routePillClass(route: Recommendation["route"]): string {
  return route === "on_device"
    ? "pill pill-ok"
    : route === "escalate"
      ? "pill pill-warn"
      : "pill pill-cloud";
}

function confidencePillClass(
  confidence: Recommendation["confidence"],
): string {
  return confidence === "high"
    ? "pill pill-ok"
    : confidence === "medium"
      ? "pill pill-warn"
      : "pill pill-muted";
}

export default function ReportScreen({
  tasks,
  snapshot,
}: {
  tasks: Task[];
  snapshot: RunSnapshot | null;
}) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  const results = snapshot?.results ?? [];
  const scores = useMemo(
    () => Object.values(snapshot?.scores ?? {}),
    [snapshot],
  );

  const recommendations = useMemo(
    () => buildRecommendations(tasks, results, scores, settings),
    [tasks, results, scores, settings],
  );
  const savings = useMemo(
    () => computeSavings(tasks, recommendations, settings),
    [tasks, recommendations, settings],
  );

  const recByTask = new Map(recommendations.map((r) => [r.taskId, r]));
  const notRun = tasks.filter((t) => !recByTask.has(t.id));
  const hasResults = results.length > 0;
  const costKnown = savings.pricesSet;

  function hasSuccessfulResult(taskId: string, source: "on_device" | "cloud"): boolean {
    return results.some(
      (r) => r.taskId === taskId && r.source === source && !r.error,
    );
  }

  return (
    <section className="card" aria-label="Report — routing and savings">
      <h2>Report — routing &amp; savings</h2>
      <p className="muted">
        For every task that has run, a routing recommendation (on-device,
        escalate, or cloud) with a confidence level and a short reason —
        plus the projected monthly cloud cost before and after routing.
        Thresholds below are sliders: moving one recomputes the
        recommendations and the savings live.
      </p>

      {!hasResults && (
        <p className="status warn" id="no-report-data">
          No run results yet — run tasks on the Run screen first.
          Recommendations and savings appear here after a run.
        </p>
      )}

      {hasResults && (
        <>
          <div className="settings-row" id="report-thresholds">
            <label>
              Quality threshold — route on-device at or above this
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={settings.qualityThreshold}
                onChange={(e) =>
                  updateSettings({
                    qualityThreshold: Number(e.target.value),
                  })
                }
                id="threshold-quality"
                aria-label="Quality threshold for the on-device route"
              />
              <span className="muted">
                {pct(settings.qualityThreshold)} (spec default 90%)
              </span>
            </label>
            <label>
              Escalate threshold — try on-device at or above this
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={settings.escalateThreshold}
                onChange={(e) =>
                  updateSettings({
                    escalateThreshold: Number(e.target.value),
                  })
                }
                id="threshold-escalate"
                aria-label="Escalate threshold for trying on-device first"
              />
              <span className="muted">
                {pct(settings.escalateThreshold)} (spec default 70%)
              </span>
            </label>
            <div>
              <strong>Check bar (fixed)</strong>
              <div className="muted">
                On-device also needs {pct(0.9)} of checks passing to route
                on-device — the spec fixes this bar, it is not a slider.
              </div>
            </div>
          </div>

          <h3>Recommendations ({recommendations.length})</h3>
          <table className="results-table" id="recommendations-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Route</th>
                <th>Confidence</th>
                <th>Quality ratio</th>
                <th>Checks passed</th>
                <th>Latency on-device / cloud</th>
                <th>Avg cloud cost / req</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => {
                const task = tasks.find((t) => t.id === rec.taskId);
                return (
                  <tr key={rec.taskId}>
                    <td>{task?.name ?? rec.taskId}</td>
                    <td>
                      <span className={routePillClass(rec.route)}>
                        {routeLabel(rec.route)}
                      </span>
                    </td>
                    <td>
                      <span className={confidencePillClass(rec.confidence)}>
                        {rec.confidence}
                      </span>
                    </td>
                    <td>
                      {rec.qualityRatio === 0
                        ? "—"
                        : pct(rec.qualityRatio)}
                    </td>
                    <td>{pct(rec.checkPassRate)}</td>
                    <td>
                      {hasSuccessfulResult(rec.taskId, "on_device")
                        ? `${rec.latencyOnDeviceMs.toLocaleString()} ms`
                        : "—"}
                      {" / "}
                      {hasSuccessfulResult(rec.taskId, "cloud")
                        ? `${rec.latencyCloudMs.toLocaleString()} ms`
                        : "—"}
                    </td>
                    <td>
                      {costKnown && rec.avgCloudCostUsd > 0
                        ? formatUsd(rec.avgCloudCostUsd)
                        : "—"}
                    </td>
                    <td>{rec.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {notRun.length > 0 && (
            <p className="muted" id="not-run-tasks">
              {notRun.length} task{notRun.length === 1 ? "" : "s"} not run
              yet ({notRun.map((t) => t.name).join(", ")}) — no
              recommendation until they have results.
            </p>
          )}

          <h3>Savings (monthly)</h3>
          <div id="savings-summary">
            {costKnown ? (
              <p className="status">
                Cloud cost before routing:{" "}
                <strong>{formatUsd(savings.totalBeforeUsd)}</strong> / mo ·{" "}
                after routing:{" "}
                <strong>{formatUsd(savings.totalAfterUsd)}</strong> / mo ·{" "}
                savings: <strong>{formatUsd(savings.totalSavingsUsd)}</strong>{" "}
                / mo (estimate).
              </p>
            ) : (
              <p className="status warn" id="savings-no-prices">
                Savings need cloud prices — enter the input and output
                prices on the Run screen first.
              </p>
            )}
          </div>

          {savings.perTask.length > 0 && (
            <table className="results-table" id="savings-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Requests / mo</th>
                  <th>Route</th>
                  <th>On-device share</th>
                  <th>Cost before</th>
                  <th>Cost after</th>
                  <th>Savings</th>
                </tr>
              </thead>
              <tbody>
                {savings.perTask.map((row) => {
                  const task = tasks.find((t) => t.id === row.taskId);
                  return (
                    <tr key={row.taskId}>
                      <td>{task?.name ?? row.taskId}</td>
                      <td>
                        {row.monthlyRequests > 0
                          ? row.monthlyRequests.toLocaleString()
                          : "—"}
                      </td>
                      <td>{routeLabel(row.route)}</td>
                      <td>{pct(row.shareOnDevice)}</td>
                      <td>
                        {costKnown && row.monthlyRequests > 0
                          ? formatUsd(row.costBeforeUsd)
                          : "—"}
                      </td>
                      <td>
                        {costKnown && row.monthlyRequests > 0
                          ? formatUsd(row.costAfterUsd)
                          : "—"}
                      </td>
                      <td>
                        {costKnown && row.monthlyRequests > 0
                          ? formatUsd(row.savingsUsd)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {savings.perTask.some((row) => row.monthlyRequests === 0) && (
            <p className="muted">
              Tasks without a monthly volume show “—” — set the volume on
              the Tasks screen to include them in the savings.
            </p>
          )}

          <p className="muted" id="savings-estimate-note">
            Savings are estimates: they assume failures are caught by the
            deterministic checks and ignore the extra latency of
            escalations.
          </p>
        </>
      )}

      <p className="muted">
        Export (JSON / TypeScript) and sample report mode land on Day 6
        (F7 / F8).
      </p>
    </section>
  );
}
