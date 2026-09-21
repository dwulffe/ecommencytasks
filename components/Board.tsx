"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { Client, Task, Suggestion, User, Priority, Role, PRIORITIES } from "@/lib/types";

type Filter = "open" | "overdue" | "completed" | "all";
type Sort = "priority" | "due" | "added";

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

interface Me {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export function Board() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string | "all">("all");
  const [filter, setFilter] = useState<Filter>("open");
  const [sort, setSort] = useState<Sort>("priority");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [reportOpen, setReportOpen] = useState(false);

  const isAdmin = me?.role === "admin";

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(""), 3500);
  }

  async function refresh(role: Role) {
    try {
      const requests: Promise<Response>[] = [
        fetch("/api/clients"),
        fetch("/api/tasks"),
      ];
      if (role === "admin") {
        requests.push(fetch("/api/suggestions"), fetch("/api/users"));
      }
      const [cRes, tRes, sRes, uRes] = await Promise.all(requests);
      const c = await cRes.json();
      const t = await tRes.json();
      if (c.error) throw new Error(c.error);
      if (t.error) throw new Error(t.error);
      setClients(c.clients || []);
      setTasks(t.tasks || []);
      if (sRes) setSuggestions((await sRes.json()).suggestions || []);
      if (uRes) setUsers((await uRes.json()).users || []);
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setMe(data.user);
      await refresh(data.user.role);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick every second while any timer is running, so elapsed time updates live.
  useEffect(() => {
    if (!tasks.some((t) => t.timerStartedAt)) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [tasks]);

  const employees = useMemo(() => users, [users]);
  const userName = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u.name || u.username]));
    return (id: string) => map.get(id) || "";
  }, [users]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tasks) if (!t.done) map[t.clientId] = (map[t.clientId] || 0) + 1;
    return map;
  }, [tasks]);

  const today = new Date().toISOString().slice(0, 10);

  const visibleTasks = useMemo(() => {
    let list = tasks.filter((t) => !isAdmin || selected === "all" || t.clientId === selected);
    if (filter === "open") list = list.filter((t) => !t.done);
    else if (filter === "completed") list = list.filter((t) => t.done);
    else if (filter === "overdue")
      list = list.filter((t) => !t.done && t.dueDate && t.dueDate < today);

    const sorted = [...list].sort((a, b) => {
      if (sort === "priority") {
        if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority])
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return dueSortValue(a.dueDate) - dueSortValue(b.dueDate);
      }
      if (sort === "due") return dueSortValue(a.dueDate) - dueSortValue(b.dueDate);
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return sorted.sort((a, b) => Number(a.done) - Number(b.done));
  }, [tasks, selected, filter, sort, isAdmin, today]);

  const selectedClient = clients.find((c) => c.id === selected);
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => selected === "all" || s.clientId === selected),
    [suggestions, selected]
  );

  // ── Mutations ──────────────────────────────────────────
  async function addClient(name: string, email: string) {
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json();
    if (!res.ok) return flashError(data.error || "Could not add client");
    setClients((prev) => [...prev, data.client].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected(data.client.id);
  }

  async function removeClient(id: string) {
    if (!confirm("Delete this client and all of its tasks?")) return;
    setClients((prev) => prev.filter((c) => c.id !== id));
    setTasks((prev) => prev.filter((t) => t.clientId !== id));
    if (selected === id) setSelected("all");
    const res = await fetch(`/api/clients?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not delete client");
      refresh("admin");
    }
  }

  async function addTask(input: {
    title: string;
    priority: Priority;
    dueDate: string;
    assigneeId: string;
  }) {
    const clientId = selected === "all" ? clients[0]?.id : selected;
    if (!clientId) return flashError("Add a client first");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, clientId }),
    });
    const data = await res.json();
    if (!res.ok) return flashError(data.error || "Could not add task");
    setTasks((prev) => [data.task, ...prev]);
  }

  function replaceTask(t: Task) {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
  }

  async function patchTask(id: string, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      flashError(data.error || "Could not save change");
      me && refresh(me.role);
    } else if (data.task) {
      replaceTask(data.task);
    }
  }

  async function timerAction(id: string, action: "start" | "pause") {
    const res = await fetch(`/api/tasks/${id}/timer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return flashError(data.error || "Timer failed");
    if (data.task) replaceTask(data.task);
  }

  async function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not delete task");
      me && refresh(me.role);
    }
  }

  async function acceptSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    const res = await fetch(`/api/suggestions/${id}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) return flashError(data.error || "Could not accept suggestion");
    setTasks((prev) => [data.task, ...prev]);
  }

  async function dismissSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
    if (!res.ok) flashError("Could not dismiss suggestion");
  }

  async function addEmployee(input: { username: string; name: string; password: string }) {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) return flashError(data.error || "Could not add employee");
    setUsers((prev) => [...prev, data.user]);
  }

  async function removeUser(id: string) {
    if (!confirm("Remove this person? Their tasks will become unassigned.")) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setTasks((prev) =>
      prev.map((t) => (t.assigneeId === id ? { ...t, assigneeId: "", assigneeName: "" } : t))
    );
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not remove person");
      me && refresh(me.role);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const activeCount = visibleTasks.filter((t) => !t.done).length;
  const heading = isAdmin ? (selected === "all" ? "All clients" : selectedClient?.name || "Tasks") : "My tasks";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo size={30} />
          <span className="wordmark">ECOMMENCY</span>
          <span className="divider" />
          <span className="app-name">Client Tasks</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {me && (
            <span className="whoami">
              {me.name || me.username}
              <span className={`role-tag ${me.role}`}>{me.role}</span>
            </span>
          )}
          <button className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className={`layout ${isAdmin ? "" : "solo"}`}>
        {isAdmin && (
          <aside className="sidebar">
            <h2>Clients</h2>
            <div
              className={`client-item ${selected === "all" ? "active" : ""}`}
              onClick={() => setSelected("all")}
            >
              <span className="name">All clients</span>
              <span className="count">{tasks.filter((t) => !t.done).length}</span>
            </div>
            {clients.map((c) => (
              <div
                key={c.id}
                className={`client-item ${selected === c.id ? "active" : ""}`}
                onClick={() => setSelected(c.id)}
              >
                <span className="name">
                  <span className="dot" />
                  {c.name}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="count">{counts[c.id] || 0}</span>
                  <button
                    className="kill"
                    title="Delete client"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeClient(c.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
            <AddClient onAdd={addClient} />

            <Team users={users} meId={me?.id || ""} onAdd={addEmployee} onRemove={removeUser} />
          </aside>
        )}

        <main className="main">
          <div className="main-head">
            <div>
              <h1>{heading}</h1>
              <div className="sub">
                {loading
                  ? "Loading…"
                  : `${activeCount} open ${activeCount === 1 ? "task" : "tasks"}${
                      isAdmin && selected === "all" ? ` across ${clients.length} clients` : ""
                    }`}
              </div>
            </div>

            <div className="toolbar">
              <div className="segmented">
                {(["open", "overdue", "completed", "all"] as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                    {f === "open" ? "Open" : f === "overdue" ? "Overdue" : f === "completed" ? "Completed" : "All"}
                  </button>
                ))}
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="priority">Sort: Priority</option>
                <option value="due">Sort: Due date</option>
                <option value="added">Sort: Newest</option>
              </select>
              {isAdmin && (
                <button className="btn ghost" onClick={() => setReportOpen(true)}>
                  ⏱ Time report
                </button>
              )}
            </div>
          </div>

          {isAdmin && clients.length > 0 && (
            <AddTask key={selected} employees={employees} onAdd={addTask} />
          )}

          {isAdmin && visibleSuggestions.length > 0 && (
            <div className="suggest-block">
              <div className="suggest-head">
                <span className="spark">✦</span>
                Suggested from email
                <span className="suggest-count">{visibleSuggestions.length}</span>
              </div>
              {visibleSuggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  showClient={selected === "all"}
                  clientName={clientName.get(s.clientId) || ""}
                  onAccept={() => acceptSuggestion(s.id)}
                  onDismiss={() => dismissSuggestion(s.id)}
                />
              ))}
            </div>
          )}

          <div className="task-list" style={{ marginTop: 14 }}>
            {loading ? null : visibleTasks.length === 0 ? (
              <EmptyState isAdmin={isAdmin} hasClients={clients.length > 0} filter={filter} />
            ) : (
              visibleTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  now={now}
                  isAdmin={!!isAdmin}
                  showClient={!isAdmin || selected === "all"}
                  clientName={clientName.get(t.clientId) || ""}
                  employees={employees}
                  assigneeName={t.assigneeName || userName(t.assigneeId)}
                  onToggle={() => patchTask(t.id, { done: !t.done })}
                  onCyclePriority={() => patchTask(t.id, { priority: nextPriority(t.priority) })}
                  onDue={(d) => patchTask(t.id, { dueDate: d })}
                  onRename={(title) => title.trim() && patchTask(t.id, { title })}
                  onAssign={(assigneeId) => patchTask(t.id, { assigneeId })}
                  onTimer={(action) => timerAction(t.id, action)}
                  onDelete={() => removeTask(t.id)}
                />
              ))
            )}
          </div>
        </main>
      </div>

      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
      {error && <div className="toast">{error}</div>}
    </div>
  );
}

interface ReportRow {
  assigneeId: string;
  name: string;
  taskCount: number;
  totalSeconds: number;
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState(() => monthStart());
  const [end, setEnd] = useState(() => localDate(new Date()));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`/api/report?start=${start}&end=${end}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load report");
        if (!cancelled) setRows(data.rows || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const max = Math.max(1, ...rows.map((r) => r.totalSeconds));
  const grandSeconds = rows.reduce((s, r) => s + r.totalSeconds, 0);
  const grandTasks = rows.reduce((s, r) => s + r.taskCount, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Time report</h2>
            <div className="modal-sub">Hours logged per person on tasks completed in the range.</div>
          </div>
          <button className="kill modal-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="report-controls">
          <div className="report-presets">
            {(
              [
                ["This week", weekStart(), localDate(new Date())],
                ["This month", monthStart(), localDate(new Date())],
                ["Last 30 days", daysAgo(29), localDate(new Date())],
                ["Last month", lastMonthStart(), lastMonthEnd()],
              ] as [string, string, string][]
            ).map(([label, s, e]) => (
              <button
                key={label}
                className={`preset ${start === s && end === e ? "on" : ""}`}
                onClick={() => {
                  setStart(s);
                  setEnd(e);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="report-range">
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            <span className="range-dash">→</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        {err && <div className="report-err">{err}</div>}

        <div className="report-body">
          {loading ? (
            <div className="report-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="report-empty">No completed tasks with logged time in this range.</div>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Tasks</th>
                  <th className="num">Time logged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assigneeId || "unassigned"}>
                    <td>
                      <div className="report-person">{r.name}</div>
                      <div className="report-bar">
                        <span style={{ width: `${(r.totalSeconds / max) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{r.taskCount}</td>
                    <td className="num strong">{formatDuration(r.totalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{grandTasks}</td>
                  <td className="num strong">{formatDuration(grandSeconds)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function AutoTextarea({
  value,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}

function AddClient({ onAdd }: { onAdd: (name: string, email: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="add-client-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          onAdd(name.trim(), email.trim());
          setName("");
          setEmail("");
        }
      }}
    >
      <input type="text" placeholder="Add client…" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        type="text"
        placeholder="Client email or domain (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn" type="submit" disabled={!name.trim()}>
        Add client
      </button>
    </form>
  );
}

function Team({
  users,
  meId,
  onAdd,
  onRemove,
}: {
  users: User[];
  meId: string;
  onAdd: (input: { username: string; name: string; password: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="team">
      <h2 style={{ marginTop: 20 }}>Team</h2>
      {users.map((u) => (
        <div key={u.id} className="team-item">
          <span className="name">
            {u.name || u.username}
            <span className={`role-tag ${u.role}`}>{u.role}</span>
          </span>
          {u.id !== meId && (
            <button className="kill" title="Remove" onClick={() => onRemove(u.id)}>
              ×
            </button>
          )}
        </div>
      ))}

      {open ? (
        <form
          className="add-client-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) {
              onAdd({ username: username.trim(), name: name.trim(), password });
              setUsername("");
              setName("");
              setPassword("");
              setOpen(false);
            }
          }}
        >
          <input
            type="text"
            placeholder="Username (e.g. maria)"
            value={username}
            autoCapitalize="none"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input type="text" placeholder="Full name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            type="text"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit" disabled={!username.trim() || !password}>
              Create
            </button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          + Add employee
        </button>
      )}
    </div>
  );
}

function AddTask({
  onAdd,
  employees,
}: {
  onAdd: (input: { title: string; priority: Priority; dueDate: string; assigneeId: string }) => void;
  employees: User[];
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  return (
    <form
      className="add-task"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd({ title: title.trim(), priority, dueDate, assigneeId });
        setTitle("");
        setPriority("Medium");
        setDueDate("");
        setAssigneeId("");
      }}
    >
      <AutoTextarea
        className="title grow"
        placeholder="Add a task…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} title="Assign to">
        <option value="">Unassigned</option>
        {employees.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name || u.username}
          </option>
        ))}
      </select>
      <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <button className="btn" type="submit" disabled={!title.trim()}>
        Add task
      </button>
    </form>
  );
}

function TaskRow({
  task,
  now,
  isAdmin,
  showClient,
  clientName,
  employees,
  assigneeName,
  onToggle,
  onCyclePriority,
  onDue,
  onRename,
  onAssign,
  onTimer,
  onDelete,
}: {
  task: Task;
  now: number;
  isAdmin: boolean;
  showClient: boolean;
  clientName: string;
  employees: User[];
  assigneeName: string;
  onToggle: () => void;
  onCyclePriority: () => void;
  onDue: (d: string) => void;
  onRename: (title: string) => void;
  onAssign: (assigneeId: string) => void;
  onTimer: (action: "start" | "pause") => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const dateRef = useRef<HTMLInputElement>(null);

  const due = describeDue(task.dueDate);
  const running = !!task.timerStartedAt;
  const seconds = elapsedSeconds(task, now);

  function openDatePicker() {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <div className={`task-row ${task.done ? "done" : ""}`}>
      <button
        className={`checkbox ${task.done ? "checked" : ""}`}
        onClick={onToggle}
        aria-label={task.done ? "Mark as not done" : "Mark as done"}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#06120b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="task-main">
        {isAdmin && editing ? (
          <AutoTextarea
            className="grow"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft !== task.title) onRename(draft.trim());
              else setDraft(task.title);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            style={{ width: "100%" }}
          />
        ) : (
          <div
            className="task-title"
            onClick={() => isAdmin && setEditing(true)}
            title={isAdmin ? "Click to rename" : undefined}
          >
            {task.title}
          </div>
        )}

        <div className="task-subline">
          {showClient && clientName && <span>{clientName}</span>}
          {isAdmin ? (
            <select
              className="assignee-select"
              value={task.assigneeId}
              onChange={(e) => onAssign(e.target.value)}
              title="Assign to"
            >
              <option value="">Unassigned</option>
              {employees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.username}
                </option>
              ))}
            </select>
          ) : (
            assigneeName && <span className="assignee-chip">{assigneeName}</span>
          )}
        </div>

        {task.done && task.completedAt && (
          <div className="completed-at">
            ✓ Completed {formatCompleted(task.completedAt)}
            {task.timeSpentSeconds > 0 && <> · {formatDuration(task.timeSpentSeconds)} logged</>}
          </div>
        )}
      </div>

      <div className="task-meta">
        {!task.done && (
          <div className="timer">
            <button
              className={`timer-btn ${running ? "running" : ""}`}
              onClick={() => onTimer(running ? "pause" : "start")}
              title={running ? "Pause timer" : "Start timer"}
            >
              {running ? "⏸ Pause" : "▶ Start"}
            </button>
            {(running || seconds > 0) && (
              <span className={`timer-time ${running ? "live" : ""}`}>{formatDuration(seconds)}</span>
            )}
          </div>
        )}

        {isAdmin ? (
          <button className={`badge ${task.priority.toLowerCase()}`} onClick={onCyclePriority} title="Click to change priority" style={{ border: "none", cursor: "pointer" }}>
            <span className="pdot" />
            {task.priority}
          </button>
        ) : (
          <span className={`badge ${task.priority.toLowerCase()}`}>
            <span className="pdot" />
            {task.priority}
          </span>
        )}

        {isAdmin ? (
          <button type="button" className={`due due-btn ${due.cls}`} title="Set due date" onClick={openDatePicker}>
            {due.label}
            <input ref={dateRef} type="date" value={task.dueDate} onChange={(e) => onDue(e.target.value)} className="due-input" tabIndex={-1} aria-hidden="true" />
          </button>
        ) : (
          task.dueDate && <span className={`due ${due.cls}`}>{due.label}</span>
        )}

        {isAdmin && (
          <button className="kill" title="Delete task" onClick={onDelete}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  showClient,
  clientName,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  showClient: boolean;
  clientName: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const due = describeDue(suggestion.dueDate);
  return (
    <div className="suggest-card">
      <div className="task-main">
        <div className="task-title">{suggestion.title}</div>
        <div className="suggest-source">
          {showClient && clientName ? `${clientName} · ` : ""}
          from “{suggestion.sourceSubject || "email"}”
        </div>
      </div>
      <div className="task-meta">
        <span className={`badge ${suggestion.priority.toLowerCase()}`}>
          <span className="pdot" />
          {suggestion.priority}
        </span>
        {suggestion.dueDate && <span className={`due ${due.cls}`}>{due.label}</span>}
        <button className="btn suggest-accept" onClick={onAccept} title="Add as task">
          Accept
        </button>
        <button className="kill" title="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}

function EmptyState({ isAdmin, hasClients, filter }: { isAdmin: boolean; hasClients: boolean; filter: Filter }) {
  if (isAdmin && !hasClients) {
    return (
      <div className="empty">
        <div className="pill">Get started</div>
        <div className="big" style={{ marginTop: 14 }}>
          Add your first client
        </div>
        <div>Use the “Add client” box on the left to create a client, then add tasks.</div>
      </div>
    );
  }
  return (
    <div className="empty">
      <div className="big">
        {filter === "completed" ? "Nothing completed yet" : filter === "overdue" ? "Nothing overdue" : "No tasks here"}
      </div>
      <div>
        {isAdmin ? "Add a task with the form above." : "Tasks assigned to you will show up here."}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function nextPriority(p: Priority): Priority {
  const order: Priority[] = ["High", "Medium", "Low"];
  return order[(order.indexOf(p) + 1) % order.length];
}

function elapsedSeconds(task: Task, now: number): number {
  let s = task.timeSpentSeconds;
  if (task.timerStartedAt) {
    const started = Date.parse(task.timerStartedAt);
    if (!Number.isNaN(started)) s += Math.max(0, Math.floor((now - started) / 1000));
  }
  return s;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function formatCompleted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Date helpers for the report presets (all local dates) ──

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStart(): string {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function weekStart(): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // days since Monday
  d.setDate(d.getDate() - dow);
  return localDate(d);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

function lastMonthStart(): string {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

function lastMonthEnd(): string {
  const d = new Date();
  return localDate(new Date(d.getFullYear(), d.getMonth(), 0)); // day 0 = last day of prev month
}

function dueSortValue(dueDate: string): number {
  if (!dueDate) return Number.MAX_SAFE_INTEGER;
  const t = new Date(dueDate + "T00:00:00").getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function describeDue(dueDate: string): { label: string; cls: string } {
  if (!dueDate) return { label: "No date", cls: "none" };
  const due = new Date(dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return { label: "No date", cls: "none" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  const label = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (diffDays < 0) return { label: `${label} · overdue`, cls: "overdue" };
  if (diffDays === 0) return { label: "Today", cls: "soon" };
  if (diffDays === 1) return { label: "Tomorrow", cls: "soon" };
  if (diffDays <= 3) return { label, cls: "soon" };
  return { label, cls: "" };
}
