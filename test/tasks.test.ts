// Unit tests for src/lib/tasks.ts — run with: npm test
// Node has no localStorage, so a minimal in-memory stub is installed
// before any test runs. tasks.ts only touches localStorage inside
// function bodies (never at import time), so the stub is in place in time.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createTaskId,
  draftFromTask,
  draftToTask,
  emptyDraft,
  freshPresets,
  loadTasks,
  parseJsonKeys,
  saveTasks,
  validateDraft,
  type TaskDraft,
} from "../src/lib/tasks.ts";
import { PRESET_TASKS } from "../src/data/presets.ts";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

beforeEach(() => store.clear());

test("loadTasks seeds the 5 presets on first visit and saves them", () => {
  const tasks = loadTasks();
  assert.equal(tasks.length, 5);
  assert.deepEqual(
    tasks.map((t) => t.id),
    PRESET_TASKS.map((t) => t.id),
  );
  // Seeded list is persisted, so a second load reads it back.
  assert.equal(loadTasks().length, 5);
  assert.ok(store.has("routewise-tasks-v1"));
});

test("saveTasks + loadTasks round-trips an edited list (persistence)", () => {
  const tasks = loadTasks();
  const edited = [
    ...tasks.slice(0, 4),
    { ...tasks[4], name: "Renamed by the editor" },
    {
      id: "task-custom",
      name: "Custom task",
      type: "qa" as const,
      prompt: "What is 2 + 2?",
      monthlyRequests: 500,
    },
  ];
  saveTasks(edited);
  const reloaded = loadTasks();
  assert.equal(reloaded.length, 6);
  assert.equal(reloaded[4].name, "Renamed by the editor");
  assert.equal(reloaded[5].name, "Custom task");
  assert.equal(reloaded[5].monthlyRequests, 500);
});

test("loadTasks keeps a stored empty list (user deleted everything)", () => {
  saveTasks([]);
  assert.deepEqual(loadTasks(), []);
});

test("loadTasks repairs corrupt storage with fresh presets", () => {
  store.set("routewise-tasks-v1", "{not json");
  assert.equal(loadTasks().length, 5);
  store.set("routewise-tasks-v1", JSON.stringify({ not: "an array" }));
  assert.equal(loadTasks().length, 5);
});

test("loadTasks drops malformed stored entries, keeps valid ones", () => {
  const valid = PRESET_TASKS[0];
  store.set(
    "routewise-tasks-v1",
    JSON.stringify([
      valid,
      { id: "bad-1", name: "", type: "qa", prompt: "x" }, // empty name
      { id: "bad-2", name: "Bad type", type: "teleport", prompt: "x" },
      { id: "bad-3", name: "No prompt", type: "qa", prompt: "   " },
      "not an object",
    ]),
  );
  const loaded = loadTasks();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, valid.id);
});

test("freshPresets returns deep copies — mutating them never touches PRESET_TASKS", () => {
  const copy = freshPresets();
  copy[2].expectedJsonKeys!.push("hacked");
  copy[0].name = "hacked";
  assert.deepEqual(PRESET_TASKS[2].expectedJsonKeys, [
    "name",
    "amount",
    "date",
  ]);
  assert.equal(PRESET_TASKS[0].name, "Summarize a news paragraph");
});

test("createTaskId is unique and prefixed", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createTaskId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.ok(id.startsWith("task-"), id);
});

test("parseJsonKeys trims, drops empties, dedupes", () => {
  assert.deepEqual(parseJsonKeys("name, amount, date"), [
    "name",
    "amount",
    "date",
  ]);
  assert.deepEqual(parseJsonKeys("a, b ,c,, a,  ,b"), ["a", "b", "c"]);
  assert.deepEqual(parseJsonKeys(""), []);
  assert.deepEqual(parseJsonKeys("   "), []);
});

test("validateDraft requires name and prompt, checks monthly requests", () => {
  const base: TaskDraft = {
    name: "T",
    type: "qa",
    prompt: "P?",
    referenceAnswer: "",
    expectedJsonKeys: "",
    monthlyRequests: "",
  };
  assert.deepEqual(validateDraft(base), []);
  assert.ok(validateDraft({ ...base, name: "   " }).length > 0);
  assert.ok(validateDraft({ ...base, prompt: "" }).length > 0);
  assert.ok(
    validateDraft({ ...base, monthlyRequests: "-1" }).length > 0,
  );
  assert.ok(
    validateDraft({ ...base, monthlyRequests: "1.5" }).length > 0,
  );
  assert.ok(validateDraft({ ...base, monthlyRequests: "abc" }).length > 0);
  assert.deepEqual(validateDraft({ ...base, monthlyRequests: "0" }), []);
  assert.deepEqual(
    validateDraft({ ...base, monthlyRequests: "12000" }),
    [],
  );
  assert.ok(
    validateDraft({ ...base, type: "teleport" as never }).length > 0,
  );
});

test("draftToTask trims and drops empty optional fields", () => {
  const task = draftToTask(
    {
      name: "  My task  ",
      type: "extract_json",
      prompt: "  Extract it.  ",
      referenceAnswer: "  ",
      expectedJsonKeys: "coin, amount, coin",
      monthlyRequests: "2500",
    },
    "task-x",
  );
  assert.deepEqual(task, {
    id: "task-x",
    name: "My task",
    type: "extract_json",
    prompt: "Extract it.",
    expectedJsonKeys: ["coin", "amount"],
    monthlyRequests: 2500,
  });
  // No optional fields at all when the draft leaves them blank.
  const minimal = draftToTask(emptyDraft(), "task-y");
  assert.equal("referenceAnswer" in minimal, false);
  assert.equal("expectedJsonKeys" in minimal, false);
  assert.equal("monthlyRequests" in minimal, false);
});

test("draftFromTask round-trips a task through the form", () => {
  const original = PRESET_TASKS[2];
  const draft = draftFromTask(original);
  assert.equal(draft.name, original.name);
  assert.equal(draft.expectedJsonKeys, "name, amount, date");
  assert.equal(draft.monthlyRequests, String(original.monthlyRequests));
  const back = draftToTask(draft, original.id);
  assert.deepEqual(back, original);
});
