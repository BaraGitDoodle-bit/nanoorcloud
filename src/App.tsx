// ---------------------------------------------------------------------------
// NanoOrCloud — app shell.
//
// Screens per spec §7: Setup, Tasks, Run, Report. Setup (Day 1), Run
// (Day 2), Tasks (Day 3) and Report (Day 5) are live. The task list is
// owned here and shared by the editor (Day 3) and the runner (Day 2);
// the run snapshot (results + scores) is also owned here so it survives
// switching between the Run and Report screens — each screen unmounts
// when hidden, and RunScreen restores from / syncs to this snapshot.
// ---------------------------------------------------------------------------

import { useState } from "react";
import EnvCheck from "./components/EnvCheck.tsx";
import ReportScreen from "./components/ReportScreen.tsx";
import RunScreen from "./components/RunScreen.tsx";
import TaskEditor from "./components/TaskEditor.tsx";
import { APP_NAME } from "./lib/brand.ts";
import { loadTasks, saveTasks } from "./lib/tasks.ts";
import type { RunSnapshot, Task } from "./lib/types.ts";

type Screen = "setup" | "tasks" | "run" | "report";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot | null>(null);

  function updateTasks(next: Task[]) {
    setTasks(next);
    saveTasks(next);
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <h1>{APP_NAME}</h1>
          <p className="tagline">
            Stop guessing when to use on-device AI. Run your prompts on
            Gemini Nano and the cloud side by side — then route each task
            where it belongs.
          </p>
        </div>
      </header>

      <nav className="wrap screen-nav" aria-label="Screens">
        <button
          type="button"
          className={`nav-item nav-btn${screen === "setup" ? " nav-active" : ""}`}
          onClick={() => setScreen("setup")}
          aria-current={screen === "setup" ? "page" : undefined}
        >
          1 · Setup
        </button>
        <button
          type="button"
          className={`nav-item nav-btn${screen === "tasks" ? " nav-active" : ""}`}
          onClick={() => setScreen("tasks")}
          aria-current={screen === "tasks" ? "page" : undefined}
        >
          2 · Tasks ({tasks.length})
        </button>
        <button
          type="button"
          className={`nav-item nav-btn${screen === "run" ? " nav-active" : ""}`}
          onClick={() => setScreen("run")}
          aria-current={screen === "run" ? "page" : undefined}
        >
          3 · Run
        </button>
        <button
          type="button"
          className={`nav-item nav-btn${screen === "report" ? " nav-active" : ""}`}
          onClick={() => setScreen("report")}
          aria-current={screen === "report" ? "page" : undefined}
        >
          4 · Report
        </button>
      </nav>

      <main className="wrap">
        {screen === "setup" ? (
          <>
            <EnvCheck />

            <section className="card">
              <h2>Privacy</h2>
              <p className="muted">
                Your prompts stay in this browser. In cloud mode they are sent
                to the Gemini API through Firebase AI Logic. Do not paste
                secrets or personal data. On-device runs never leave this
                device. Tasks and results are stored in this browser only
                (localStorage).
              </p>
            </section>
          </>
        ) : screen === "tasks" ? (
          <TaskEditor tasks={tasks} onChange={updateTasks} />
        ) : screen === "run" ? (
          <RunScreen
            tasks={tasks}
            initialSnapshot={runSnapshot}
            onSnapshot={setRunSnapshot}
          />
        ) : (
          <ReportScreen tasks={tasks} snapshot={runSnapshot} />
        )}
      </main>

      <footer className="wrap muted">
        {APP_NAME} — #BuildHybridAI 2026. Open source (MIT). Day 7:
        Polish + Firebase Hosting deploy.
      </footer>
    </>
  );
}
