// ---------------------------------------------------------------------------
// F1 — Environment check (spec §5).
//
// Shows the Chrome version, whether the on-device model is available /
// downloading / unavailable, and whether a Firebase AI Logic cloud call
// succeeds. Two test buttons prove the two paths end to end: one on-device
// call and one cloud call returning text in the browser.
//
// Done when each status displays correctly in a clean Chrome profile with
// and without the flag. (The live calls can only be proven in a real
// browser — this VM's headless Chrome has no Gemini Nano and cannot do
// TLS to Google.)
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  parseChromeVersion,
  supportsOnDevice,
  availabilityLabel,
  type OnDeviceStatus,
} from "../lib/env.ts";
import {
  firebaseConfig,
  isConfigured,
  initFirebase,
  createOnDeviceModel,
  createCloudModel,
} from "../lib/firebase.ts";

const TEST_PROMPT = "Reply with one short sentence: what is 2 + 2?";

type TestState =
  | { state: "idle" }
  | { state: "running"; note?: string }
  | { state: "done"; text: string; ms: number }
  | { state: "error"; error: string };

function pillClass(kind: "ok" | "warn" | "error" | "muted"): string {
  return `pill pill-${kind}`;
}

export default function EnvCheck() {
  const [chromeVersion, setChromeVersion] = useState<number | null>(null);
  const [onDevice, setOnDevice] = useState<OnDeviceStatus>("checking");
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [debugToken, setDebugToken] = useState("");
  const [cloudTest, setCloudTest] = useState<TestState>({ state: "idle" });
  const [deviceTest, setDeviceTest] = useState<TestState>({ state: "idle" });

  useEffect(() => {
    setChromeVersion(parseChromeVersion(navigator.userAgent));

    // On-device availability via the Chrome Prompt API.
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

    // Firebase init (config from .env). Surface the App Check debug token
    // so it can be registered in the console.
    setFirebaseReady(initFirebase());
    setTimeout(() => {
      const token = self.FIREBASE_APPCHECK_DEBUG_TOKEN;
      if (typeof token === "string" && token.length > 10) {
        setDebugToken(token);
      }
    }, 1500);
  }, []);

  async function testCloud() {
    if (!firebaseReady) {
      setCloudTest({
        state: "error",
        error: "Firebase is not configured — copy .env.example to .env and fill in the routewise-web config.",
      });
      return;
    }
    setCloudTest({ state: "running" });
    const t0 = performance.now();
    try {
      // Model instances are created inside the click handler (spec §4).
      const model = createCloudModel();
      const result = await model.generateContent(TEST_PROMPT);
      setCloudTest({
        state: "done",
        text: result.response.text(),
        ms: Math.round(performance.now() - t0),
      });
    } catch (err) {
      console.warn("Cloud test failed:", err);
      setCloudTest({ state: "error", error: (err as Error).message || String(err) });
    }
  }

  async function testOnDevice() {
    if (!firebaseReady) {
      setDeviceTest({
        state: "error",
        error: "Firebase is not configured — copy .env.example to .env and fill in the routewise-web config.",
      });
      return;
    }
    setDeviceTest({ state: "running", note: "Starting the on-device model…" });
    const t0 = performance.now();
    try {
      // Model instances are created inside the click handler (spec §4).
      const model = createOnDeviceModel();
      // initializeDeviceModel() must run on the user gesture, before the call.
      await model.initializeDeviceModel((progress: number) => {
        setDeviceTest({
          state: "running",
          note: `Downloading the on-device model… ${Math.round(progress * 100)}%`,
        });
      });
      const result = await model.generateContent(TEST_PROMPT);
      setDeviceTest({
        state: "done",
        text: result.response.text(),
        ms: Math.round(performance.now() - t0),
      });
    } catch (err) {
      console.warn("On-device test failed:", err);
      setDeviceTest({ state: "error", error: (err as Error).message || String(err) });
    }
  }

  const onDeviceOk = onDevice === "available";
  const onDeviceBusy = onDevice === "downloading" || onDevice === "downloadable";

  return (
    <section className="card" aria-label="Environment check">
      <h2>Setup — environment check</h2>
      <p className="muted">
        NanoOrCloud runs on Chrome on desktop. This screen proves the two
        inference paths work before you run anything: one on-device call
        and one cloud call, both through Firebase AI Logic.
      </p>

      <dl className="status-list">
        <div>
          <dt>Chrome version</dt>
          <dd>
            {chromeVersion != null ? (
              <>
                <span className={pillClass(supportsOnDevice(chromeVersion) ? "ok" : "error")}>
                  Chrome {chromeVersion}
                </span>{" "}
                {supportsOnDevice(chromeVersion)
                  ? "— version 139+ is required for on-device inference, and this browser qualifies."
                  : "— on-device inference needs Chrome on Desktop 139 or higher. Please update Chrome."}
              </>
            ) : (
              <span className={pillClass("warn")}>Not detected</span>
            )}
          </dd>
        </div>

        <div>
          <dt>On-device model (Gemini Nano)</dt>
          <dd>
            <span
              className={pillClass(
                onDeviceOk ? "ok" : onDeviceBusy ? "warn" : onDevice === "checking" ? "muted" : "error",
              )}
            >
              {onDevice}
            </span>{" "}
            {availabilityLabel(onDevice)}
            {(onDevice === "unavailable" || onDevice === "unknown") && (
              <>
                {" "}
                Enable the flag at{" "}
                <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>,
                restart Chrome, and let the model download. Cloud-only runs
                still work — and the sample report shows the product without
                the on-device model.
              </>
            )}
          </dd>
        </div>

        <div>
          <dt>Firebase AI Logic</dt>
          <dd>
            {isConfigured() ? (
              <>
                <span className={pillClass("ok")}>Configured</span>{" "}
                Project <code>{firebaseConfig.projectId}</code>, app{" "}
                <code>{firebaseConfig.appId}</code> (routewise-web, Gemini
                Developer API). App Check is enforced for AI Logic.
              </>
            ) : (
              <>
                <span className={pillClass("error")}>Not configured</span>{" "}
                Copy <code>.env.example</code> to <code>.env</code> and fill
                in the routewise-web Firebase config, then reload.
              </>
            )}
          </dd>
        </div>

        {debugToken && (
          <div>
            <dt>App Check debug token</dt>
            <dd>
              <code>{debugToken}</code> — register it in the Firebase
              console under Security &gt; App Check &gt; Manage debug tokens
              (routewise-web app).
            </dd>
          </div>
        )}
      </dl>

      <div className="test-grid">
        <div className="test-card">
          <h3>☁️ Cloud call</h3>
          <p className="muted">
            One <code>generateContent()</code> through Firebase AI Logic with{" "}
            <code>ONLY_IN_CLOUD</code>.
          </p>
          <button
            type="button"
            className="primary"
            onClick={testCloud}
            disabled={cloudTest.state === "running" || !firebaseReady}
            id="test-cloud-btn"
          >
            {cloudTest.state === "running" ? "Calling the cloud…" : "Test cloud call"}
          </button>
          <TestResult test={cloudTest} id="cloud-test-result" />
        </div>

        <div className="test-card">
          <h3>🔒 On-device call</h3>
          <p className="muted">
            One <code>generateContent()</code> through Firebase AI Logic with{" "}
            <code>ONLY_ON_DEVICE</code> (Gemini Nano).
          </p>
          <button
            type="button"
            className="primary"
            onClick={testOnDevice}
            disabled={
              deviceTest.state === "running" ||
              !firebaseReady ||
              (!onDeviceOk && !onDeviceBusy)
            }
            id="test-device-btn"
          >
            {deviceTest.state === "running" ? "Calling on-device…" : "Test on-device call"}
          </button>
          {(!onDeviceOk && !onDeviceBusy) && onDevice !== "checking" && (
            <p className="muted">
              Disabled: Gemini Nano is not available in this browser.
            </p>
          )}
          <TestResult test={deviceTest} id="device-test-result" />
        </div>
      </div>
    </section>
  );
}

function TestResult({ test, id }: { test: TestState; id: string }) {
  if (test.state === "idle") return <p className="muted" id={id}>Not run yet.</p>;
  if (test.state === "running")
    return (
      <p className="status" id={id}>
        {test.note || "Running…"}
      </p>
    );
  if (test.state === "done")
    return (
      <div id={id}>
        <p className="status ok">Returned text in {test.ms} ms:</p>
        <pre className="result-text">{test.text}</pre>
      </div>
    );
  return (
    <div id={id}>
      <p className="status error">Call failed:</p>
      <pre className="result-text">{test.error}</pre>
    </div>
  );
}
