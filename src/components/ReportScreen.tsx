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
// Export (JSON / TypeScript, F7) and sample report mode (F8) live here
// too (Day 6): the export section renders when a report exists, and the
// sample toggle renders the bundled demo run (src/data/sample-report.json)
// so visitors without Gemini Nano can see the product. Sample mode uses
// its own threshold state so moving a slider there never overwrites the
// user's real settings; the export is labeled sample when it is one.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  buildReportExport,
  buildRoutingConfigTs,
  copyText,
  downloadText,
  loadSampleReport,
  serializeReportJson,
} from "../lib/export.ts";
import {
  buildRecommendations,
  computeSavings,
} from "../lib/routing.ts";
import { loadSettings, saveSettings } from "../lib/settings.ts";
import sampleData from "../data/sample-report.json";
import {
  DEFAULT_SETTINGS,
  type Recommendation,
  type RunSnapshot,
  type Settings,
  type Task,
} from "../lib/types.ts";

/** The bundled demo run, validated once at load; null if the file is
 *  malformed (the sample button is hidden then, the app keeps working). */
const SAMPLE = loadSampleReport(sampleData);

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
  const [sampleMode, setSampleMode] = useState(false);
  const [sampleSettings, setSampleSettings] = useState<Settings>(
    () => SAMPLE?.settings ?? { ...DEFAULT_SETTINGS },
  );
  const [exportStatus, setExportStatus] = useState("");

  function updateSettings(patch: Partial<Settings>) {
    // Sample mode has its own threshold state — moving a slider there
    // must not overwrite the user's real settings.
    if (sampleMode) {
      setSampleSettings((prev) => ({ ...prev, ...patch }));
      return;
    }
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  const liveResults = snapshot?.results ?? [];
  const liveScores = useMemo(
    () => Object.values(snapshot?.scores ?? {}),
    [snapshot],
  );

  // Sample mode (F8): render the bundled demo run instead of the live one.
  const inSample = sampleMode && SAMPLE != null;
  const activeTasks = inSample ? SAMPLE.tasks : tasks;
  const activeResults = inSample ? SAMPLE.results : liveResults;
  const activeScores = inSample ? SAMPLE.scores : liveScores;
  const activeSettings = sampleMode ? sampleSettings : settings;

  const recommendations = useMemo(
    () =>
      buildRecommendations(
        activeTasks,
        activeResults,
        activeScores,
        activeSettings,
      ),
    [activeTasks, activeResults, activeScores, activeSettings],
  );
  const savings = useMemo(
    () => computeSavings(activeTasks, recommendations, activeSettings),
    [activeTasks, recommendations, activeSettings],
  );

  const recByTask = new Map(recommendations.map((r) => [r.taskId, r]));
  const notRun = activeTasks.filter((t) => !recByTask.has(t.id));
  const hasResults = activeResults.length > 0;
  const costKnown = savings.pricesSet;

  function hasSuccessfulResult(taskId: string, source: "on_device" | "cloud"): boolean {
    return activeResults.some(
      (r) => r.taskId === taskId && r.source === source && !r.error,
    );
  }

  // F7 — the exportable report, rebuilt whenever the report changes.
  const report = useMemo(
    () =>
      hasResults
        ? buildReportExport({
            tasks: activeTasks,
            results: activeResults,
            scores: activeScores,
            recommendations,
            savings,
            settings: activeSettings,
            sample: inSample,
          })
        : null,
    [
      hasResults,
      activeTasks,
      activeResults,
      activeScores,
      recommendations,
      savings,
      activeSettings,
      inSample,
    ],
  );
  const tsSnippet = useMemo(
    () => (report ? buildRoutingConfigTs(report) : ""),
    [report],
  );

  function enterSampleMode() {
    setExportStatus("");
    setSampleMode(true);
  }
  function exitSampleMode() {
    setExportStatus("");
    setSampleMode(false);
  }

  function onDownloadJson() {
    if (!report) return;
    const filename = inSample
      ? "nanoorcloud-report-sample.json"
      : "nanoorcloud-report.json";
    downloadText(filename, serializeReportJson(report), "application/json");
    setExportStatus(`Downloaded ${filename}.`);
  }
  async function onCopyJson() {
    if (!report) return;
    const ok = await copyText(serializeReportJson(report));
    setExportStatus(
      ok
        ? "JSON copied to clipboard."
        : "Copy failed — the browser blocked clipboard access; use Download instead.",
    );
  }
  function onDownloadTs() {
    if (!report) return;
    const filename = inSample
      ? "nanoorcloud-routing-config-sample.ts"
      : "nanoorcloud-routing-config.ts";
    downloadText(filename, tsSnippet, "text/plain");
    setExportStatus(`Downloaded ${filename}.`);
  }
  async function onCopyTs() {
    if (!report) return;
    const ok = await copyText(tsSnippet);
    setExportStatus(
      ok
        ? "TypeScript routing config copied to clipboard."
        : "Copy failed — the browser blocked clipboard access; use Download instead.",
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

      {inSample && SAMPLE && (
        <p className="status sample-banner" id="sample-banner">
          <strong>SAMPLE REPORT</strong> — this is bundled demo data, not
          a run from this browser. {SAMPLE.note} Run your own tasks on the
          Run screen to get a real report.
        </p>
      )}

      <div className="btn-row">
        {SAMPLE && !sampleMode && (
          <button
            type="button"
            className="secondary"
            id="view-sample-btn"
            onClick={enterSampleMode}
          >
            View a sample report
          </button>
        )}
        {sampleMode && (
          <button
            type="button"
            className="secondary"
            id="exit-sample-btn"
            onClick={exitSampleMode}
          >
            Back to my report
          </button>
        )}
      </div>

      {!hasResults && (
        <p className="status warn" id="no-report-data">
          No run results yet — run tasks on the Run screen first.
          Recommendations and savings appear here after a run. Or view the
          sample report above to see what a finished report looks like.
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
                value={activeSettings.qualityThreshold}
                onChange={(e) =>
                  updateSettings({
                    qualityThreshold: Number(e.target.value),
                  })
                }
                id="threshold-quality"
                aria-label="Quality threshold for the on-device route"
              />
              <span className="muted">
                {pct(activeSettings.qualityThreshold)} (spec default 90%)
              </span>
            </label>
            <label>
              Escalate threshold — try on-device at or above this
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={activeSettings.escalateThreshold}
                onChange={(e) =>
                  updateSettings({
                    escalateThreshold: Number(e.target.value),
                  })
                }
                id="threshold-escalate"
                aria-label="Escalate threshold for trying on-device first"
              />
              <span className="muted">
                {pct(activeSettings.escalateThreshold)} (spec default 70%)
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
                const task = activeTasks.find((t) => t.id === rec.taskId);
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
                  const task = activeTasks.find((t) => t.id === row.taskId);
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

          <h3>Export</h3>
          <p className="muted">
            Download or copy this report as JSON, or as a TypeScript
            routing config you can paste into your own app.
            {inSample
              ? " This exports the SAMPLE report, labeled as such."
              : ""}
          </p>
          <div className="btn-row" id="export-buttons">
            <button
              type="button"
              className="secondary"
              id="export-json-download"
              onClick={onDownloadJson}
            >
              Download JSON
            </button>
            <button
              type="button"
              className="secondary"
              id="export-json-copy"
              onClick={onCopyJson}
            >
              Copy JSON
            </button>
            <button
              type="button"
              className="secondary"
              id="export-ts-download"
              onClick={onDownloadTs}
            >
              Download routing config (.ts)
            </button>
            <button
              type="button"
              className="secondary"
              id="export-ts-copy"
              onClick={onCopyTs}
            >
              Copy routing config
            </button>
          </div>
          {exportStatus && (
            <p className="status" id="export-status" role="status">
              {exportStatus}
            </p>
          )}
          <details id="export-ts-preview">
            <summary>Preview the TypeScript routing config</summary>
            <pre className="result-text">{tsSnippet}</pre>
          </details>
        </>
      )}
    </section>
  );
}
