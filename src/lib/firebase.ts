// ---------------------------------------------------------------------------
// Firebase setup for NanoOrCloud.
//
// Config comes from environment variables (see .env.example). The Firebase
// web apiKey is public by design (it identifies the project, it is not a
// secret) — but the spec keeps config out of the repo anyway, so .env is
// gitignored and only .env.example is committed.
//
// Project: "OffRecord" (offrecord-4161f, under tohamubarak110@gmail.com,
// Spark free). Web app: "routewise-web"
// (1:925243452849:web:ffeaa08915e280cbda2190). AI Logic with the Gemini
// Developer API is enabled on the project; App Check is enforced for
// AI Logic.
//
// API names verified against the official docs:
// https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference
// (read 21 Nov 2026): getAI + GoogleAIBackend, getGenerativeModel with
// InferenceMode (PREFER_ON_DEVICE / ONLY_ON_DEVICE / PREFER_IN_CLOUD /
// ONLY_IN_CLOUD), model.initializeDeviceModel() after a user interaction
// and before generateContent(), result.response.text().
//
// One gotcha, proven empirically on the OffRecord build: when InferenceMode
// is set, getGenerativeModel IGNORES top-level model / systemInstruction /
// generationConfig — they must go inside onDeviceParams / inCloudParams.
// That is why createCloudModel() below puts the model name in inCloudParams.
// ---------------------------------------------------------------------------

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
} from "firebase/ai";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as
    | string
    | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as
    | string
    | undefined,
};

/** True when a real Firebase config is present in the environment. */
export function isConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

let firebaseApp: FirebaseApp | null = null;
let ai: ReturnType<typeof getAI> | null = null;

/**
 * Initialise Firebase + App Check + the AI Logic service. Safe to call
 * more than once. Returns false when no config is present.
 */
export function initFirebase(): boolean {
  if (firebaseApp) return true;
  if (!isConfigured()) return false;

  firebaseApp = initializeApp(firebaseConfig);

  // App Check: debug provider on localhost (the debug token is printed to
  // the console and shown in the app); reCAPTCHA v3 in production. The
  // debug token must be registered in the Firebase console (Security >
  // App Check > Manage debug tokens) for the routewise-web app.
  // When self.FIREBASE_APPCHECK_DEBUG_TOKEN is true, the SDK uses the debug
  // provider instead of the configured one.
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    new URLSearchParams(location.search).has("debugAppCheck");
  if (isLocal) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider("debug"),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // App Check is best-effort here; AI Logic calls surface real errors.
    console.warn("App Check init:", (err as Error).message);
  }

  ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return true;
}

/**
 * Create an on-device-only model. Call inside the click handler that
 * starts a run (the spec and the docs require model creation after a
 * user interaction). Throws if Firebase is not initialised.
 */
export function createOnDeviceModel(): GenerativeModel {
  if (!ai) throw new Error("Firebase AI Logic is not initialised.");
  return getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
}

/**
 * Create a cloud-only model. Call inside the click handler that starts a
 * run. When a model name is given it goes in inCloudParams (top-level
 * model is ignored when InferenceMode is set). With no name the SDK
 * default cloud model is used (spec §4: the cloud model name is a
 * setting, defaulting to the SDK default).
 */
export function createCloudModel(cloudModel?: string): GenerativeModel {
  if (!ai) throw new Error("Firebase AI Logic is not initialised.");
  if (cloudModel) {
    return getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: cloudModel },
    });
  }
  return getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD });
}

/**
 * Create a cloud-only model for the F4 judge. Call inside the click
 * handler that starts a run. When a cloud model name is set, the judge
 * gets structured JSON output (responseMimeType application/json) via
 * inCloudParams — the generationConfig must live there, not top-level
 * (see the gotcha above). When no model name is set there is no
 * inCloudParams to put it in (ModelParams requires `model`), so the
 * judge is a plain cloud model and the prompt asks for JSON only — the
 * reply is parsed robustly either way (see scoring.ts).
 */
export function createJudgeModel(cloudModel?: string): GenerativeModel {
  if (!ai) throw new Error("Firebase AI Logic is not initialised.");
  if (cloudModel) {
    return getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: "application/json" },
      },
    });
  }
  return getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD });
}

