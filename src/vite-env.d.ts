/// <reference types="vite/client" />

// Chrome Prompt API (Gemini Nano) — not in the default TS DOM lib yet.
// Firebase App Check debug token flag — set on `self` before init.
declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  }

  const LanguageModel:
    | {
        availability(): Promise<
          "available" | "downloading" | "downloadable" | "unavailable"
        >;
      }
    | undefined;
}

export {};
