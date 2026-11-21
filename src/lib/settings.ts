// ---------------------------------------------------------------------------
// Settings persistence for NanoOrCloud (spec §4, §6).
//
// Prices per 1M tokens and the cloud model name are entered by the user and
// stored in localStorage (wrapped in try/catch per spec §3). Prices are
// never hard-coded: 0 means "not set", and cost displays as "—" until the
// user enters prices. Thresholds default to the spec §6 values (0.90 / 0.70).
// ---------------------------------------------------------------------------

import { DEFAULT_SETTINGS, type Settings } from "./types.ts";

const KEY = "routewise-settings-v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      cloudModel:
        typeof parsed.cloudModel === "string" && parsed.cloudModel.trim()
          ? parsed.cloudModel.trim()
          : DEFAULT_SETTINGS.cloudModel,
      priceInPer1M: numOr(parsed.priceInPer1M, DEFAULT_SETTINGS.priceInPer1M),
      priceOutPer1M: numOr(
        parsed.priceOutPer1M,
        DEFAULT_SETTINGS.priceOutPer1M,
      ),
      qualityThreshold: numOr(
        parsed.qualityThreshold,
        DEFAULT_SETTINGS.qualityThreshold,
      ),
      escalateThreshold: numOr(
        parsed.escalateThreshold,
        DEFAULT_SETTINGS.escalateThreshold,
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — settings stay in memory for this visit.
  }
}

function numOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
