import { useState, useRef, useEffect, useCallback } from "react";

/* ============================================================
   MASTER ORCHESTRATOR — control plane for an AI agent swarm
   ------------------------------------------------------------
   The Orchestrator class below is framework-free plain JS.
   Lift it into Node/deno/worker as-is and drive it with a real
   event loop; the React layer is only a viewport onto it.
   ============================================================ */

const CAPS = ["research", "code", "write", "review", "data"];
const CAP_ICON = { research: "◎", code: "⌘", write: "✎", review: "☑", data: "▤" };
const NAMES = ["Athena", "Boreas", "Circe", "Daedalus", "Echo", "Fenrir", "Gaia", "Hermes", "Icarus", "Janus", "Kirin", "Lyra", "Mimir", "Nyx", "Orion", "Pallas", "Quill", "Rhea", "Sable", "Talos"];

let _id = 0;
const uid = (p) => `${p}-${(++_id).toString(36)}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class Orchestrator {
  constructor() {
    this.agents = new Map();
    this.tasks = new Map();
    this.events = [];
    this.tick_ = 0;
    this.completed = 0;
    this.failed = 0;
    this.history = []; // throughput per window
    this._windowDone = 0;
    this._usedNames = new Set();
  }

  log(kind, msg) {
    this.events.unshift({ id: uid("ev"), tick: this.tick_, kind, msg, ts: Date.now() });
    if (this.events.length > 60) this.events.pop();
  }

  /* ---------- agent lifecycle ---------- */
  spawnAgent(caps) {
    const free = NAMES.filter((n) => !this._usedNames.has(n));
    const name = free.length ? pick(free) : uid("agent");
    this._usedNames.add(name);
    const capabilities = caps || [...CAPS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
    const agent = {
      id: uid("ag"), name, capabilities,
      status: "idle",          // idle | busy | degraded | offline
      taskId: null, tasksDone: 0, failures: 0,
      heartbeat: this.tick_, load: 0,
    };
    this.agents.set(agent.id, agent);
    this.log("spawn", `${name} joined the swarm · ${capabilities.join(" / ")}`);
    return agent;
  }

  retireAgent(id) {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.taskId) this._requeue(a.taskId, `${a.name} retired mid-task`);
    this._usedNames.delete(a.name);
    this.agents.delete(id);
    this.log("retire", `${a.name} retired from the swarm`);
  }

  /* ---------- task lifecycle ---------- */
  submitTask(type, priority = 2) {
    const task = {
      id: uid("tk"), type, priority,       // 1 = critical, 2 = normal, 3 = background
      status: "pending",                   // pending | running | done | failed
      agentId: null, progress: 0, retries: 0, created: this.tick_,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  _requeue(taskId, reason) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.retries += 1;
    t.agentId = null;
    t.progress = 0;
    if (t.retries > 2) {
      t.status = "failed";
      this.failed += 1;
      this.log("fail", `task ${t.type} ${t.id} failed permanently — ${reason}`);
    } else {
      t.status = "pending";
      this.log("retry", `task ${t.type} ${t.id} requeued (attempt ${t.retries + 1}) — ${reason}`);
    }
  }

  /* ---------- scheduler ---------- */
  _schedule() {
    const pending = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.priority - b.priority || a.created - b.created);
    for (const task of pending) {
      const candidates = [...this.agents.values()]
        .filter((a) => a.status === "idle" && a.capabilities.includes(task.type))
        .sort((a, b) => a.load - b.load); // least-loaded wins
      const agent = candidates[0];
      if (!agent) continue;
      agent.status = "busy";
      agent.taskId = task.id;
      task.status = "running";
      task.agentId = agent.id;
      this.log("assign", `${agent.name} ← ${task.type} ${task.id}${task.priority === 1 ? " (critical)" : ""}`);
    }
  }

  /* ---------- health + progress ---------- */
  tick() {
    this.tick_ += 1;

    for (const a of this.agents.values()) {
      // heartbeat drift → degradation → recovery
      if (a.status !== "offline" && Math.random() < 0.012) {
        a.status = "degraded";
        this.log("health", `${a.name} heartbeat degraded`);
      } else if (a.status === "degraded" && Math.random() < 0.35) {
        a.status = a.taskId ? "busy" : "idle";
        this.log("health", `${a.name} recovered`);
      }

      if (a.status === "busy" && a.taskId) {
        const t = this.tasks.get(a.taskId);
        if (!t) { a.status = "idle"; a.taskId = null; continue; }
        t.progress = Math.min(1, t.progress + 0.12 + Math.random() * 0.15);
        a.load = Math.min(1, a.load + 0.08);

        if (Math.random() < 0.02) {           // task-level fault
          a.failures += 1;
          a.status = "idle"; a.taskId = null;
          this._requeue(t.id, `${a.name} threw an execution fault`);
          continue;
        }
        if (t.progress >= 1) {
          t.status = "done";
          this.completed += 1;
          this._windowDone += 1;
          a.tasksDone += 1;
          a.status = "idle"; a.taskId = null;
          this.log("done", `${a.name} completed ${t.type} ${t.id}`);
        }
      } else {
        a.load = Math.max(0, a.load - 0.05);
      }
    }

    this._schedule();

    // throughput window (every 5 ticks)
    if (this.tick_ % 5 === 0) {
      this.history.push(this._windowDone);
      this._windowDone = 0;
      if (this.history.length > 40) this.history.shift();
    }

    // prune finished tasks so the board stays readable
    const finished = [...this.tasks.values()].filter((t) => t.status === "done" || t.status === "failed");
    if (finished.length > 14) {
      finished.sort((a, b) => a.created - b.created).slice(0, finished.length - 14)
        .forEach((t) => this.tasks.delete(t.id));
    }
  }
}

/* ============================================================
   THEME — ops-console: graphite-blue ink, phosphor amber,
   radar teal. IBM-terminal register, mono for all telemetry.
   ============================================================ */
const T = {
  bg: "#10151C", panel: "#151C25", panel2: "#1A222D", line: "#26313F",
  text: "#D9E1EB", dim: "#75828F", faint: "#4A5561",
  amber: "#FFB454", teal: "#43C6B9", red: "#F2555A", violet: "#9D8CFF",
};
const STATUS_COLOR = { idle: T.dim, busy: T.teal, degraded: T.amber, offline: T.red };
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace" };

/* ============================================================
   DASHBOARD
   ============================================================ */
export default function MasterOrchestrator() {
  const orcRef = useRef(null);
  if (!orcRef.current) {
    const o = new Orchestrator();
    for (let i = 0; i < 6; i++) o.spawnAgent();
    for (let i = 0; i < 8; i++) o.submitTask(pick(CAPS), pick([1, 2, 2, 3]));
    o.log("boot", "orchestrator online — control plane initialized");
    orcRef.current = o;
  }
  const orc = orcRef.current;

  const [, force] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(null);
  const rerender = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    if (paused) return;
    const iv = setInterval(() => {
      orc.tick();
      if (Math.random() < 0.35) orc.submitTask(pick(CAPS), pick([1, 2, 2, 2, 3])); // ambient demand
      rerender();
    }, 800);
    return () => clearInterval(iv);
  }, [paused, orc, rerender]);

  const agents = [...orc.agents.values()];
  const tasks = [...orc.tasks.values()];
  const pending = tasks.filter((t) => t.status === "pending").sort((a, b) => a.priority - b.priority);
  const running = tasks.filter((t) => t.status === "running");
  const settled = tasks.filter((t) => t.status === "done" || t.status === "failed").slice(-8).reverse();
  const busyPct = agents.length ? Math.round((agents.filter((a) => a.status === "busy").length / agents.length) * 100) : 0;

  return (
    <div className="min-h-screen w-full" style={{ background: T.bg, color: T.text, ...mono }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap');
        @keyframes sweep { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes blink { 0%,100% {opacity:1} 50% {opacity:.25} }
        ::-webkit-scrollbar{width:6px;height:6px} ::-webkit-scrollbar-thumb{background:${T.line};border-radius:3px}
        @media (prefers-reduced-motion: reduce){ *{animation:none !important; transition:none !important} }
      `}</style>

      {/* ── command bar ─────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 border-b" style={{ borderColor: T.line, background: T.panel }}>
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: paused ? T.amber : T.teal, animation: paused ? "none" : "blink 2s infinite" }} />
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.14em" }} className="text-sm font-bold uppercase">
            Master&nbsp;Orchestrator
          </h1>
          <span className="text-xs" style={{ color: T.faint }}>swarm control plane · t+{orc.tick_}</span>
        </div>

        <div className="flex items-center gap-5 text-xs ml-auto" style={{ color: T.dim }}>
          <Stat label="agents" value={agents.length} />
          <Stat label="queue" value={pending.length} color={pending.length > 6 ? T.amber : undefined} />
          <Stat label="done" value={orc.completed} color={T.teal} />
          <Stat label="failed" value={orc.failed} color={orc.failed ? T.red : undefined} />
          <Stat label="utilization" value={`${busyPct}%`} />
        </div>

        <div className="flex items-center gap-2">
          <Btn onClick={() => { orc.spawnAgent(); rerender(); }}>+ agent</Btn>
          <Btn onClick={() => { for (let i = 0; i < 5; i++) orc.submitTask(pick(CAPS), pick([1, 2, 3])); orc.log("burst", "operator injected 5 tasks"); rerender(); }}>+ 5 tasks</Btn>
          <Btn accent onClick={() => setPaused((p) => !p)}>{paused ? "resume" : "pause"}</Btn>
        </div>
      </header>

      <main className="grid gap-3 p-3" style={{ gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gridTemplateRows: "auto auto" }}>
        {/* ── swarm ring (signature) ───────────────── */}
        <Panel title="Swarm topology" sub="tasks pulse outward from the hub to their assigned agent">
          <SwarmRing agents={agents} tasks={tasks} tick={orc.tick_} selected={selected} onSelect={setSelected} />
        </Panel>

        {/* ── right column: queue + agents ─────────── */}
        <div className="flex flex-col gap-3 min-w-0">
          <Panel title="Task queue" sub={`${pending.length} pending · ${running.length} running`}>
            <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
              {pending.length === 0 && running.length === 0 && (
                <Empty>Queue is clear. Inject tasks to give the swarm work.</Empty>
              )}
              {running.map((t) => <TaskRow key={t.id} t={t} agents={orc.agents} />)}
              {pending.map((t) => <TaskRow key={t.id} t={t} agents={orc.agents} />)}
            </div>
            {settled.length > 0 && (
              <div className="mt-2 pt-2 border-t space-y-1 max-h-28 overflow-y-auto pr-1" style={{ borderColor: T.line }}>
                {settled.map((t) => <TaskRow key={t.id} t={t} agents={orc.agents} muted />)}
              </div>
            )}
          </Panel>

          <Panel title="Agent registry" sub="least-loaded capable agent wins each assignment">
            <div className="max-h-64 overflow-y-auto pr-1 space-y-1">
              {agents.map((a) => (
                <div key={a.id}
                  onClick={() => setSelected(selected === a.id ? null : a.id)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs"
                  style={{ background: selected === a.id ? T.panel2 : "transparent", outline: selected === a.id ? `1px solid ${T.line}` : "none" }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[a.status] }} />
                  <span className="w-20 truncate font-medium">{a.name}</span>
                  <span style={{ color: T.faint }} className="w-24 truncate">{a.capabilities.map((c) => CAP_ICON[c]).join(" ")}</span>
                  <span style={{ color: STATUS_COLOR[a.status] }} className="w-16">{a.status}</span>
                  <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: T.line }}>
                    <div className="h-full rounded-full" style={{ width: `${a.load * 100}%`, background: T.teal, transition: "width .4s" }} />
                  </div>
                  <span style={{ color: T.dim }} className="w-8 text-right">{a.tasksDone}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); orc.retireAgent(a.id); if (selected === a.id) setSelected(null); rerender(); }}
                    className="px-1 rounded hover:opacity-100 opacity-40"
                    style={{ color: T.red }} title="Retire agent">✕</button>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ── throughput ───────────────────────────── */}
        <Panel title="Throughput" sub="tasks completed per window">
          <Sparkline data={orc.history} />
        </Panel>

        {/* ── event log ────────────────────────────── */}
        <Panel title="Event log">
          <div className="max-h-40 overflow-y-auto pr-1 space-y-0.5 text-xs">
            {orc.events.map((e) => (
              <div key={e.id} className="flex gap-2">
                <span style={{ color: T.faint }} className="shrink-0 w-12">t+{e.tick}</span>
                <span className="shrink-0 w-14" style={{ color: { done: T.teal, fail: T.red, retry: T.amber, health: T.amber, spawn: T.violet, retire: T.violet, assign: T.dim, burst: T.violet, boot: T.teal }[e.kind] || T.dim }}>{e.kind}</span>
                <span style={{ color: T.dim }} className="truncate">{e.msg}</span>
              </div>
            ))}
          </div>
        </Panel>
      </main>
    </div>
  );
}

/* ============================================================
   COMPONENTS
   ============================================================ */
function Stat({ label, value, color }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b style={{ color: color || T.text }} className="text-sm font-semibold">{value}</b>
      <span className="uppercase tracking-wider" style={{ fontSize: 10, color: T.faint }}>{label}</span>
    </span>
  );
}

function Btn({ children, onClick, accent }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded text-xs font-medium focus:outline-none focus-visible:ring-2"
      style={{
        background: accent ? T.amber : T.panel2,
        color: accent ? "#141414" : T.text,
        border: `1px solid ${accent ? T.amber : T.line}`,
      }}>
      {children}
    </button>
  );
}

function Panel({ title, sub, children }) {
  return (
    <section className="rounded-lg border p-3 min-w-0" style={{ background: T.panel, borderColor: T.line }}>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.text }}>{title}</h2>
        {sub && <span style={{ fontSize: 10, color: T.faint }}>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <div className="text-xs py-4 text-center" style={{ color: T.faint }}>{children}</div>;
}

function TaskRow({ t, agents, muted }) {
  const agent = t.agentId ? agents.get(t.agentId) : null;
  const pcolor = t.priority === 1 ? T.red : t.priority === 2 ? T.dim : T.faint;
  const scolor = { pending: T.dim, running: T.teal, done: T.teal, failed: T.red }[t.status];
  return (
    <div className="flex items-center gap-2 text-xs px-2 py-1 rounded" style={{ opacity: muted ? 0.5 : 1, background: t.status === "running" ? T.panel2 : "transparent" }}>
      <span title={`priority ${t.priority}`} style={{ color: pcolor }}>{t.priority === 1 ? "▲" : t.priority === 3 ? "▽" : "—"}</span>
      <span className="w-6" style={{ color: T.amber }}>{CAP_ICON[t.type]}</span>
      <span className="w-16">{t.type}</span>
      <span style={{ color: T.faint }} className="w-16 truncate">{t.id}</span>
      <span style={{ color: scolor }} className="w-14">{t.status}</span>
      {t.status === "running" && (
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: T.line }}>
          <div className="h-full" style={{ width: `${t.progress * 100}%`, background: T.teal, transition: "width .4s" }} />
        </div>
      )}
      {agent && <span style={{ color: T.faint }} className="ml-auto truncate">{agent.name}</span>}
      {t.retries > 0 && t.status !== "failed" && <span style={{ color: T.amber }}>r{t.retries}</span>}
    </div>
  );
}

/* radial swarm map — the signature element */
function SwarmRing({ agents, tasks, tick, selected, onSelect }) {
  const W = 520, H = 380, cx = W / 2, cy = H / 2, R = 140;
  const n = Math.max(agents.length, 1);
  const pos = agents.map((a, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { a, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Swarm topology map">
      {/* radar rings */}
      {[R * 0.45, R * 0.75, R * 1.05].map((r, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={T.line} strokeWidth="1" strokeDasharray={i === 2 ? "2 5" : "none"} />
      ))}
      {/* radar sweep */}
      <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: "sweep 9s linear infinite" }}>
        <path d={`M ${cx} ${cy} L ${cx + R * 1.05} ${cy} A ${R * 1.05} ${R * 1.05} 0 0 0 ${cx + R * 0.93} ${cy - R * 0.48} Z`}
          fill={T.teal} opacity="0.05" />
      </g>

      {/* links + task pulses */}
      {pos.map(({ a, x, y }) => {
        const running = a.taskId ? tasks.find((t) => t.id === a.taskId) : null;
        const lc = a.status === "degraded" ? T.amber : a.status === "busy" ? T.teal : T.line;
        return (
          <g key={a.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={lc} strokeWidth={a.status === "busy" ? 1.5 : 1} opacity={a.status === "idle" ? 0.35 : 0.8} />
            {running && (
              <circle
                cx={cx + (x - cx) * running.progress}
                cy={cy + (y - cy) * running.progress}
                r="3.5" fill={T.amber}>
                <title>{running.type} {running.id} · {Math.round(running.progress * 100)}%</title>
              </circle>
            )}
          </g>
        );
      })}

      {/* hub */}
      <circle cx={cx} cy={cy} r="26" fill={T.panel2} stroke={T.amber} strokeWidth="1.5" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="9" fill={T.amber} style={mono} letterSpacing="2">HUB</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill={T.faint} style={mono}>t+{tick}</text>

      {/* agent nodes */}
      {pos.map(({ a, x, y }) => (
        <g key={a.id} onClick={() => onSelect(selected === a.id ? null : a.id)} style={{ cursor: "pointer" }}>
          <circle cx={x} cy={y} r={selected === a.id ? 17 : 13}
            fill={T.panel2} stroke={STATUS_COLOR[a.status]} strokeWidth={selected === a.id ? 2.5 : 1.5} />
          {a.status === "busy" && <circle cx={x} cy={y} r="17" fill="none" stroke={T.teal} strokeWidth="1" opacity="0.3" />}
          <text x={x} y={y + 3} textAnchor="middle" fontSize="8" fill={T.text} style={mono}>{a.name.slice(0, 3).toUpperCase()}</text>
          <text x={x} y={y + 26} textAnchor="middle" fontSize="7.5" fill={T.faint} style={mono}>{a.status}</text>
        </g>
      ))}
    </svg>
  );
}

function Sparkline({ data }) {
  const W = 460, H = 90, pad = 6;
  if (!data.length) return <Empty>Collecting throughput data…</Empty>;
  const max = Math.max(...data, 1);
  const step = (W - pad * 2) / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${pad + i * step},${H - pad - (v / max) * (H - pad * 2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <polyline points={pts} fill="none" stroke={T.teal} strokeWidth="1.5" />
      <polygon points={`${pad},${H - pad} ${pts} ${pad + (data.length - 1) * step},${H - pad}`} fill={T.teal} opacity="0.08" />
      {data.map((v, i) => (
        <circle key={i} cx={pad + i * step} cy={H - pad - (v / max) * (H - pad * 2)} r="1.5" fill={T.teal} />
      ))}
      <text x={pad} y={12} fontSize="9" fill={T.faint} style={mono}>peak {max}/window</text>
    </svg>
  );
}
