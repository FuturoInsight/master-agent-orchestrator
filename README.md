# Master Agent Orchestrator

A single-page React dashboard that visualizes a simulated multi-agent task-orchestration system — a "control plane" that spawns AI-agent stand-ins, queues tasks, schedules them onto the least-loaded capable agent, and animates the whole thing as a live radar-style swarm map.

## Overview

The dashboard is built around two parts:

- **`Orchestrator`** — a framework-free JS class holding all the simulation state and logic: agents, tasks, a scheduler, and an event log. It has no dependency on React and could be lifted into a Node service, a Deno script, or a web worker and driven by a real event loop instead of a UI timer.
- **A React view layer** — a thin viewport onto the `Orchestrator` instance. It renders the current state (agents, task queue, throughput, event log) and re-renders on a fixed tick interval, but never contains orchestration logic itself.

This is a UI/simulation project, not a production agent framework — no real agents, LLM calls, or task execution are involved. It's a visual model of how a scheduler like this *behaves*.

## Features

- **Simulated agent swarm** — agents are spawned with 2–3 random capabilities (`research`, `code`, `write`, `review`, `data`), each tracked with a status (`idle` / `busy` / `degraded` / `offline`), a load meter, and a completed/failed task count.
- **Task scheduling** — pending tasks are sorted by priority (critical / normal / background) and age, then assigned to the least-loaded idle agent that has the matching capability.
- **Fault simulation** — agents randomly degrade and recover (heartbeat drift), and running tasks have a small chance of failing mid-execution and being requeued (up to 2 retries before failing permanently).
- **Swarm topology map** — an animated SVG radar view: agents ringed around a central hub, links pulse amber as tasks move from hub to agent based on progress.
- **Live task queue & agent registry** — pending/running/settled tasks and per-agent status, load, and throughput, with click-to-select and an agent "retire" action.
- **Throughput sparkline** — tasks completed per time window, plotted as a rolling sparkline.
- **Event log** — a scrolling, color-coded log of spawns, assignments, completions, failures, retries, and health events.
- **Manual controls** — buttons to spawn an agent, inject a burst of 5 tasks, and pause/resume the simulation loop.

## Tech Stack

- [React](https://react.dev/) 18 (hooks: `useState`, `useRef`, `useEffect`, `useCallback`)
- [Vite](https://vitejs.dev/) — dev server and build tool
- [Tailwind CSS](https://tailwindcss.com/) — utility classes for layout, with inline styles for the ops-console color theme
- Plain SVG for the swarm map and sparkline (no charting library)
- Google Fonts (IBM Plex Mono, Space Grotesk), loaded via `@import` in the component

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm

## Installation

```bash
git clone <this-repo-url>
cd master-agent-orchestrator
npm install
```

## Usage

Start the dev server:

```bash
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`) in a browser. The simulation starts automatically with 6 agents and 8 seeded tasks, ticking every 800ms.

Other scripts:

```bash
npm run build      # production build to dist/
npm run preview    # preview the production build locally
```

> **Note:** This project was packaged from a single standalone component file. The scaffolding (Vite/Tailwind config, entry point) was added to make it runnable, but has not yet been verified end-to-end in a browser in this environment — please run `npm install && npm run dev` and confirm it loads as expected.

## Project Structure

```
.
├── index.html                        # Vite HTML entry point
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx                      # React root, mounts the dashboard
    ├── index.css                     # Tailwind directives
    └── MasterOrchestratorDashboard.jsx  # Orchestrator class + dashboard UI (the whole app)
```

## How It Works

1. On first render, an `Orchestrator` instance is created, seeded with 6 agents and 8 random tasks.
2. A `setInterval` calls `orchestrator.tick()` every 800ms (while not paused), which:
   - Randomly degrades/recovers agent health.
   - Advances progress on each busy agent's task, with a small chance of a mid-task fault.
   - Completes tasks that reach 100% progress and marks agents idle again.
   - Runs the scheduler to assign any pending tasks to newly-idle, capability-matching agents.
   - Records completed-tasks-per-window for the throughput sparkline.
3. Ambient demand occasionally injects a new random task each tick, so the queue doesn't drain to zero on its own.
4. The React layer re-renders after each tick by forcing a state update; all simulation state lives on the `Orchestrator` instance (via `useRef`), not in React state.

## Roadmap / Known Limitations

- TBD — no roadmap has been defined yet. Candidate ideas: persist state across reloads, drive the `Orchestrator` with real backend tasks/agents instead of a random simulation, extract it as a standalone npm package.
- No test suite currently exists.
- No accessibility audit has been performed beyond the `aria-label` on the SVG map and a `prefers-reduced-motion` rule.

## Contributing

TBD — no contribution guidelines have been established yet. Issues and pull requests are welcome.

## License

MIT — see [LICENSE](LICENSE).

## Author

Jerald Reinshagen
