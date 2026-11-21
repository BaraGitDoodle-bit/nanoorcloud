// Unit tests for src/lib/env.ts — run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChromeVersion,
  supportsOnDevice,
  availabilityLabel,
} from "../src/lib/env.ts";

test("parseChromeVersion reads the Chrome major version", () => {
  assert.equal(
    parseChromeVersion(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ),
    141,
  );
  assert.equal(parseChromeVersion("Mozilla/5.0 Firefox/144.0"), null);
  assert.equal(parseChromeVersion(""), null);
});

test("supportsOnDevice needs Chrome 139+", () => {
  assert.equal(supportsOnDevice(141), true);
  assert.equal(supportsOnDevice(139), true);
  assert.equal(supportsOnDevice(138), false);
  assert.equal(supportsOnDevice(null), false);
});

test("availabilityLabel covers every status", () => {
  for (const s of [
    "checking",
    "available",
    "downloading",
    "downloadable",
    "unavailable",
    "unknown",
  ] as const) {
    assert.ok(availabilityLabel(s).length > 5, s);
  }
  assert.match(availabilityLabel("available"), /Gemini Nano/);
  assert.match(availabilityLabel("unavailable"), /cannot run/);
});
