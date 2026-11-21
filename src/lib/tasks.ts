// ---------------------------------------------------------------------------
// Task store for NanoOrCloud — F2 task editor (spec §5, §8, §9).
//
// Tasks persist in localStorage (wrapped in try/catch per spec §3). On the
// first visit — or when the stored data is corrupt — the list is seeded
// with the 5 starter presets (§9). A stored empty list is a deliberate
// user choice (all tasks deleted) and is NOT re-seeded: only a missing
// key (null) seeds the presets.
// ---------------------------------------------------------------------------

import { PRESET_TASKS } from "../data/presets.ts";
import type { Task, TaskType } from "./types.ts";

const KEY = "routewise-tasks-v1";

export const TASK_TYPES: TaskType[] = [
  "summarize",
  "classify",
  "extract_json",
  "rewrite",
  "qa",
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  summarize: "Summarize",
  classify: "Classify",
  extract_json: "Extract JSON",
  rewrite: "Rewrite",
  qa: "Q&A",
};

/** Fresh deep copies of the starter presets — mutating the result never
 *  touches PRESET_TASKS. */
export function freshPresets(): Task[] {
  return PRESET_TASKS.map((t) => ({
    ...t,
    expectedJsonKeys: t.expectedJsonKeys ? [...t.expectedJsonKeys] : undefined,
  }));
}

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) {
      const seeded = freshPresets();
      saveTasks(seeded);
      return seeded;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const seeded = freshPresets();
      saveTasks(seeded);
      return seeded;
    }
    // A stored empty array means the user deleted every task — keep it.
    return parsed.filter(isValidTask);
  } catch {
    return freshPresets();
  }
}

export function saveTasks(tasks: Task[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks));
  } catch {
    // Storage full or unavailable — tasks stay in memory for this visit.
  }
}

export function createTaskId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `task-${crypto.randomUUID()}`;
  }
  return `task-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function isValidTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.id !== "string" || t.id.trim() === "") return false;
  if (typeof t.name !== "string" || t.name.trim() === "") return false;
  if (!TASK_TYPES.includes(t.type as TaskType)) return false;
  if (typeof t.prompt !== "string" || t.prompt.trim() === "") return false;
  if (
    t.referenceAnswer !== undefined &&
    typeof t.referenceAnswer !== "string"
  ) {
    return false;
  }
  if (t.expectedJsonKeys !== undefined) {
    if (
      !Array.isArray(t.expectedJsonKeys) ||
      !t.expectedJsonKeys.every((k) => typeof k === "string" && k.length > 0)
    ) {
      return false;
    }
  }
  if (t.monthlyRequests !== undefined) {
    if (
      typeof t.monthlyRequests !== "number" ||
      !Number.isFinite(t.monthlyRequests) ||
      t.monthlyRequests < 0
    ) {
      return false;
    }
  }
  return true;
}

// --- Editor draft ----------------------------------------------------------
// The form works with strings (text inputs); the draft is converted to a
// Task only after validation passes.

export interface TaskDraft {
  name: string;
  type: TaskType;
  prompt: string;
  referenceAnswer: string;
  expectedJsonKeys: string; // comma-separated
  monthlyRequests: string; // raw text, "" = unset
}

export function emptyDraft(): TaskDraft {
  return {
    name: "",
    type: "summarize",
    prompt: "",
    referenceAnswer: "",
    expectedJsonKeys: "",
    monthlyRequests: "",
  };
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    name: task.name,
    type: task.type,
    prompt: task.prompt,
    referenceAnswer: task.referenceAnswer ?? "",
    expectedJsonKeys: (task.expectedJsonKeys ?? []).join(", "),
    monthlyRequests:
      task.monthlyRequests == null ? "" : String(task.monthlyRequests),
  };
}

/** "a, b ,c,, a" -> ["a", "b", "c"] (trimmed, empties dropped, deduped). */
export function parseJsonKeys(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const key = part.trim();
    if (key) seen.add(key);
  }
  return [...seen];
}

/** Returns human-readable validation errors; empty means the draft is a
 *  valid task. */
export function validateDraft(draft: TaskDraft): string[] {
  const errors: string[] = [];
  if (draft.name.trim() === "") errors.push("Name is required.");
  if (!TASK_TYPES.includes(draft.type)) errors.push("Pick a valid task type.");
  if (draft.prompt.trim() === "") errors.push("Prompt is required.");
  const monthly = draft.monthlyRequests.trim();
  if (monthly !== "") {
    const n = Number(monthly);
    if (!Number.isInteger(n) || n < 0) {
      errors.push("Monthly requests must be a whole number of 0 or more.");
    }
  }
  return errors;
}

/** Converts a validated draft into a Task (trims strings; drops empty
 *  optional fields). Call validateDraft first. */
export function draftToTask(draft: TaskDraft, id: string): Task {
  const keys = parseJsonKeys(draft.expectedJsonKeys);
  const monthlyText = draft.monthlyRequests.trim();
  const task: Task = {
    id,
    name: draft.name.trim(),
    type: draft.type,
    prompt: draft.prompt.trim(),
  };
  const reference = draft.referenceAnswer.trim();
  if (reference) task.referenceAnswer = reference;
  if (keys.length > 0) task.expectedJsonKeys = keys;
  if (monthlyText !== "") task.monthlyRequests = Number(monthlyText);
  return task;
}
