// ---------------------------------------------------------------------------
// Environment helpers for NanoOrCloud (F1).
//
// Pure functions (no DOM, no Firebase) so they can be unit-tested in plain
// Node. See test/env.test.ts.
// ---------------------------------------------------------------------------

export type OnDeviceStatus =
  | "checking"
  | "available"
  | "downloading"
  | "downloadable"
  | "unavailable"
  | "unknown";

/** Parse the Chrome major version from a user-agent string, or null. */
export function parseChromeVersion(userAgent: string): number | null {
  const m = /Chrome\/(\d+)/.exec(userAgent || "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Chrome on Desktop 139+ is required for on-device inference. */
export function supportsOnDevice(chromeVersion: number | null): boolean {
  return chromeVersion != null && chromeVersion >= 139;
}

/** Human-readable label for an on-device availability status. */
export function availabilityLabel(status: OnDeviceStatus): string {
  switch (status) {
    case "checking":
      return "Checking…";
    case "available":
      return "Available — Gemini Nano is ready on this device.";
    case "downloading":
      return "Downloading — Gemini Nano is being downloaded. The first on-device run may take a moment.";
    case "downloadable":
      return "Downloadable — Gemini Nano is not downloaded yet. It will download on the first on-device request.";
    case "unavailable":
      return "Unavailable — Gemini Nano cannot run here.";
    case "unknown":
      return "Unknown — this browser has no on-device model (needs Chrome on Desktop 139+ with the Prompt API flag).";
  }
}
