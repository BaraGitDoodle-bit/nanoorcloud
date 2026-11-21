// ---------------------------------------------------------------------------
// Starter presets — spec §9. Five tasks, the default task set for a run.
// Preset 5 uses made-up data only (fictional exchange notification).
// ---------------------------------------------------------------------------

import type { Task } from "../lib/types.ts";

export const PRESET_TASKS: Task[] = [
  {
    id: "preset-summarize",
    name: "Summarize a news paragraph",
    type: "summarize",
    prompt:
      "Summarize this paragraph in exactly 3 sentences:\n\n" +
      "The city council approved a plan on Tuesday to turn the old riverside warehouse district into a public park with a weekend market. The project will take three years and cost an estimated 42 million dollars, funded mostly by a state green-space grant. Local shop owners welcomed the plan but asked for a temporary parking area during construction, and the council promised to review parking options before work begins in the spring.",
    monthlyRequests: 10000,
  },
  {
    id: "preset-classify",
    name: "Classify customer sentiment",
    type: "classify",
    prompt:
      "Classify the sentiment of this customer message as exactly one word — positive, neutral, or negative:\n\n" +
      "\"Hi, I ordered the blue lamp last week and it arrived today in perfect condition. The packaging was great and it looks even better than the photos. Thank you!\"",
    monthlyRequests: 20000,
  },
  {
    id: "preset-extract-json",
    name: "Extract JSON from a messy message",
    type: "extract_json",
    prompt:
      "Extract name, amount, and date from this message and reply with JSON only, using the keys name, amount, and date:\n\n" +
      "\"hey its Maria, just sent you forty five dollars for the tickets, that was on the 12th of march, let me know you got it\"",
    expectedJsonKeys: ["name", "amount", "date"],
    monthlyRequests: 15000,
  },
  {
    id: "preset-rewrite",
    name: "Rewrite casually, formally",
    type: "rewrite",
    prompt:
      "Rewrite this casual message in a formal tone, keeping the same meaning:\n\n" +
      "\"hey boss, sorry, can't make the 9am meeting tomorrow, got a dentist thing, can we push it to thursday?\"",
    monthlyRequests: 8000,
  },
  {
    id: "preset-crypto-fields",
    name: "Extract fields from an exchange notification",
    type: "extract_json",
    prompt:
      "Extract the coin, amount, price, and time from this fictional exchange notification and reply with JSON only, using the keys coin, amount, price, and time:\n\n" +
      "\"[Fictional] NovaTrade alert: your limit order filled — bought 0.25 ZQX at $12.40 per coin on 2026-11-20 14:32 UTC.\"",
    expectedJsonKeys: ["coin", "amount", "price", "time"],
    monthlyRequests: 12000,
  },
];
