// ---------------------------------------------------------------------------
// F2 — Task editor screen (spec §5, §7 "Tasks").
//
// Add, edit and delete tasks (name, type, prompt, optional reference
// answer, optional expected JSON keys, monthly request volume). The 5
// starter presets (§9) are the default list. Every change is saved to
// localStorage immediately (via the parent's onChange), so tasks persist
// across reload. One form does both add and edit.
//
// Done when tasks persist across reload (F2 acceptance) and the 5 presets
// run in one batch from the editor (Day 3 done-when).
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { Task } from "../lib/types.ts";
import {
  TASK_TYPES,
  TASK_TYPE_LABELS,
  createTaskId,
  draftFromTask,
  draftToTask,
  emptyDraft,
  freshPresets,
  validateDraft,
  type TaskDraft,
} from "../lib/tasks.ts";

const PROMPT_PREVIEW_CHARS = 140;

interface TaskEditorProps {
  tasks: Task[];
  onChange: (tasks: Task[]) => void;
}

export default function TaskEditor({ tasks, onChange }: TaskEditorProps) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  function setField<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit(task: Task) {
    setDraft(draftFromTask(task));
    setEditingId(task.id);
    setErrors([]);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setDraft(emptyDraft());
    setEditingId(null);
    setErrors([]);
  }

  function saveTask() {
    const validation = validateDraft(draft);
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }
    setErrors([]);
    if (editingId) {
      const updated = draftToTask(draft, editingId);
      onChange(tasks.map((t) => (t.id === editingId ? updated : t)));
    } else {
      onChange([...tasks, draftToTask(draft, createTaskId())]);
    }
    setDraft(emptyDraft());
    setEditingId(null);
  }

  function deleteTask(id: string) {
    onChange(tasks.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
    if (editingId === id) cancelEdit();
  }

  function restorePresets() {
    onChange(freshPresets());
    setConfirmRestore(false);
    cancelEdit();
  }

  const editingTask = editingId
    ? tasks.find((t) => t.id === editingId)
    : undefined;

  return (
    <section className="card" aria-label="Task editor">
      <h2>Tasks — editor</h2>
      <p className="muted">
        Add your real task prompts here. Each task runs on-device and in
        the cloud from the Run screen, and the Report screen recommends
        where each one belongs. Tasks are stored in this browser only
        (localStorage) — they persist across reloads. Do not paste secrets
        or personal data into prompts.
      </p>

      {tasks.length === 0 ? (
        <p className="status warn" id="no-tasks">
          No tasks yet — add one below, or restore the 5 starter presets.
        </p>
      ) : (
        <ul className="task-editor-list" id="task-list">
          {tasks.map((t) => (
            <li key={t.id} data-task-id={t.id}>
              <div className="task-row-main">
                <strong>{t.name}</strong>{" "}
                <span className="pill pill-muted">
                  {TASK_TYPE_LABELS[t.type]}
                </span>
                {t.monthlyRequests != null && (
                  <span className="muted">
                    {" "}
                    · {t.monthlyRequests.toLocaleString()} req/mo
                  </span>
                )}
                {t.expectedJsonKeys && t.expectedJsonKeys.length > 0 && (
                  <span className="muted">
                    {" "}
                    · keys: {t.expectedJsonKeys.join(", ")}
                  </span>
                )}
                <div className="task-prompt-preview muted">
                  {t.prompt.length > PROMPT_PREVIEW_CHARS
                    ? `${t.prompt.slice(0, PROMPT_PREVIEW_CHARS)}…`
                    : t.prompt}
                </div>
              </div>
              <div className="task-row-actions">
                {confirmDeleteId === t.id ? (
                  <>
                    <span className="status error">Delete this task?</span>
                    <button
                      type="button"
                      className="danger"
                      data-action="confirm-delete"
                      onClick={() => deleteTask(t.id)}
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      data-action="cancel-delete"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      data-action="edit"
                      onClick={() => startEdit(t)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      data-action="delete"
                      onClick={() => setConfirmDeleteId(t.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 id="task-form-heading">
        {editingId
          ? `Edit task: ${editingTask?.name ?? ""}`
          : "Add a task"}
      </h3>
      <div className="task-form" id="task-form">
        <label>
          Name *
          <input
            type="text"
            id="task-name"
            value={draft.name}
            placeholder="e.g. Summarize a support ticket"
            onChange={(e) => setField("name", e.target.value)}
            aria-label="Task name"
          />
        </label>
        <label>
          Type *
          <select
            id="task-type"
            value={draft.type}
            onChange={(e) =>
              setField("type", e.target.value as TaskDraft["type"])
            }
            aria-label="Task type"
          >
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {TASK_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prompt *
          <textarea
            id="task-prompt"
            value={draft.prompt}
            rows={4}
            placeholder="The exact prompt to run on both models…"
            onChange={(e) => setField("prompt", e.target.value)}
            aria-label="Task prompt"
          />
        </label>
        <label>
          Reference answer (optional)
          <textarea
            id="task-reference"
            value={draft.referenceAnswer}
            rows={2}
            placeholder="What a good answer looks like — used by scoring later"
            onChange={(e) => setField("referenceAnswer", e.target.value)}
            aria-label="Reference answer (optional)"
          />
        </label>
        <label>
          Expected JSON keys (optional, comma-separated)
          <input
            type="text"
            id="task-json-keys"
            value={draft.expectedJsonKeys}
            placeholder="e.g. name, amount, date"
            onChange={(e) => setField("expectedJsonKeys", e.target.value)}
            aria-label="Expected JSON keys (optional, comma-separated)"
          />
        </label>
        <label>
          Monthly requests (optional)
          <input
            type="number"
            id="task-monthly"
            min="0"
            step="1"
            value={draft.monthlyRequests}
            placeholder="e.g. 10000"
            onChange={(e) => setField("monthlyRequests", e.target.value)}
            aria-label="Monthly requests (optional)"
          />
        </label>
      </div>

      {errors.length > 0 && (
        <ul className="status error" id="task-form-errors">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="primary"
          id="task-save-btn"
          onClick={saveTask}
        >
          {editingId ? "Save changes" : "Add task"}
        </button>
        {editingId && (
          <button
            type="button"
            className="secondary"
            id="task-cancel-edit-btn"
            onClick={cancelEdit}
          >
            Cancel edit
          </button>
        )}
      </div>

      <div className="btn-row">
        {confirmRestore ? (
          <>
            <span className="status warn">
              Replace the current list with the 5 starter presets?
            </span>
            <button
              type="button"
              className="secondary"
              id="restore-presets-confirm-btn"
              onClick={restorePresets}
            >
              Yes, restore presets
            </button>
            <button
              type="button"
              className="secondary"
              id="restore-presets-cancel-btn"
              onClick={() => setConfirmRestore(false)}
            >
              Keep my tasks
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary"
            id="restore-presets-btn"
            onClick={() => setConfirmRestore(true)}
          >
            Restore 5 starter presets
          </button>
        )}
      </div>
    </section>
  );
}
