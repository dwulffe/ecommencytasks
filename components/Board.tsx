"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { Client, Task, Suggestion, Priority, PRIORITIES } from "@/lib/types";

type Filter = "all" | "active" | "done";
type Sort = "priority" | "due" | "added";

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export function Board() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<string | "all">("all");
  const [filter, setFilter] = useState<Filter>("active");
  const [sort, setSort] = useState<Sort>("priority");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function flashError(msg: string) {
    setError(msg);
    setTimeout(() => setError(""), 3500);
  }

  async function refresh() {
    try {
      const [c, t, s] = await Promise.all([
        fetch("/api/clients").then((r) => r.json()),
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/suggestions").then((r) => r.json()),
      ]);
      if (c.error) throw new Error(c.error);
      if (t.error) throw new Error(t.error);
      setClients(c.clients || []);
      setTasks(t.tasks || []);
      setSuggestions(s.suggestions || []);
    } catch (err) {
      flashError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tasks) {
      if (!t.done) map[t.clientId] = (map[t.clientId] || 0) + 1;
    }
    return map;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    let list = tasks.filter((t) => selected === "all" || t.clientId === selected);
    if (filter === "active") list = list.filter((t) => !t.done);
    if (filter === "done") list = list.filter((t) => t.done);

    const sorted = [...list].sort((a, b) => {
      if (sort === "priority") {
        if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        }
        return dueSortValue(a.dueDate) - dueSortValue(b.dueDate);
      }
      if (sort === "due") return dueSortValue(a.dueDate) - dueSortValue(b.dueDate);
      return (a.createdAt < b.createdAt ? 1 : -1); // newest first
    });
    // Completed tasks always sink to the bottom in the "all" filter.
    return sorted.sort((a, b) => Number(a.done) - Number(b.done));
  }, [tasks, selected, filter, sort]);

  const selectedClient = clients.find((c) => c.id === selected);
  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients]
  );

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

  async function acceptSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    const res = await fetch(`/api/suggestions/${id}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      flashError(data.error || "Could not accept suggestion");
      refresh();
      return;
    }
    setTasks((prev) => [data.task, ...prev]);
  }

  async function dismissSuggestion(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not dismiss suggestion");
      refresh();
    }
  }

  async function removeClient(id: string) {
    if (!confirm("Delete this client and all of its tasks?")) return;
    setClients((prev) => prev.filter((c) => c.id !== id));
    setTasks((prev) => prev.filter((t) => t.clientId !== id));
    if (selected === id) setSelected("all");
    const res = await fetch(`/api/clients?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not delete client");
      refresh();
    }
  }

  async function addTask(input: { title: string; priority: Priority; dueDate: string }) {
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

  async function patchTask(id: string, patch: Partial<Task>) {
    // optimistic
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      flashError("Could not save change");
      refresh();
    }
  }

  async function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flashError("Could not delete task");
      refresh();
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const activeCount = visibleTasks.filter((t) => !t.done).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo size={30} />
          <span className="wordmark">ECOMMENCY</span>
          <span className="divider" />
          <span className="app-name">Client Tasks</span>
        </div>
        <button className="btn ghost" onClick={logout}>
          Log out
        </button>
      </header>

      <div className="layout">
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
        </aside>

        <main className="main">
          <div className="main-head">
            <div>
              <h1>{selected === "all" ? "All clients" : selectedClient?.name || "Tasks"}</h1>
              <div className="sub">
                {loading
                  ? "Loading…"
                  : `${activeCount} open ${activeCount === 1 ? "task" : "tasks"}${
                      selected === "all" ? ` across ${clients.length} clients` : ""
                    }`}
              </div>
            </div>

            <div className="toolbar">
              <div className="segmented">
                {(["active", "all", "done"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "on" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f === "active" ? "Open" : f === "done" ? "Done" : "All"}
                  </button>
                ))}
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="priority">Sort: Priority</option>
                <option value="due">Sort: Due date</option>
                <option value="added">Sort: Newest</option>
              </select>
            </div>
          </div>

          {clients.length > 0 && (
            <AddTask
              key={selected}
              disabled={selected === "all" && clients.length === 0}
              onAdd={addTask}
            />
          )}

          {visibleSuggestions.length > 0 && (
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
              <EmptyState hasClients={clients.length > 0} filter={filter} />
            ) : (
              visibleTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showClient={selected === "all"}
                  clientName={clientName.get(t.clientId) || ""}
                  onToggle={() => patchTask(t.id, { done: !t.done })}
                  onCyclePriority={() =>
                    patchTask(t.id, { priority: nextPriority(t.priority) })
                  }
                  onDue={(d) => patchTask(t.id, { dueDate: d })}
                  onRename={(title) => title.trim() && patchTask(t.id, { title })}
                  onDelete={() => removeTask(t.id)}
                />
              ))
            )}
          </div>
        </main>
      </div>

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

/** A textarea that soft-wraps and grows its height to fit its content. */
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
      <input
        type="text"
        placeholder="Add client…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
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

function AddTask({
  onAdd,
  disabled,
}: {
  onAdd: (input: { title: string; priority: Priority; dueDate: string }) => void;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [dueDate, setDueDate] = useState("");

  return (
    <form
      className="add-task"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd({ title: title.trim(), priority, dueDate });
        setTitle("");
        setPriority("Medium");
        setDueDate("");
      }}
    >
      <AutoTextarea
        className="title grow"
        placeholder="Add a task…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={disabled}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter adds a line break.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <button className="btn" type="submit" disabled={!title.trim() || disabled}>
        Add task
      </button>
    </form>
  );
}

function TaskRow({
  task,
  showClient,
  clientName,
  onToggle,
  onCyclePriority,
  onDue,
  onRename,
  onDelete,
}: {
  task: Task;
  showClient: boolean;
  clientName: string;
  onToggle: () => void;
  onCyclePriority: () => void;
  onDue: (d: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const dateRef = useRef<HTMLInputElement>(null);

  const due = describeDue(task.dueDate);

  function openDatePicker() {
    const el = dateRef.current;
    if (!el) return;
    // showPicker() is the reliable cross-browser way to open the native
    // calendar on demand; fall back to focus() where it isn't supported.
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
          <path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            stroke="#06120b"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="task-main">
        {editing ? (
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
              // Enter saves; Shift+Enter adds a line break; Escape cancels.
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
            onClick={() => setEditing(true)}
            title="Click to rename"
          >
            {task.title}
          </div>
        )}
        {showClient && (
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
            {clientName}
          </div>
        )}
      </div>

      <div className="task-meta">
        <button
          className={`badge ${task.priority.toLowerCase()}`}
          onClick={onCyclePriority}
          title="Click to change priority"
          style={{ border: "none", cursor: "pointer" }}
        >
          <span className="pdot" />
          {task.priority}
        </button>

        <button
          type="button"
          className={`due due-btn ${due.cls}`}
          title="Set due date"
          onClick={openDatePicker}
        >
          {due.label}
          <input
            ref={dateRef}
            type="date"
            value={task.dueDate}
            onChange={(e) => onDue(e.target.value)}
            className="due-input"
            tabIndex={-1}
            aria-hidden="true"
          />
        </button>

        {task.dueDate && (
          <button
            className="kill"
            title="Clear due date"
            onClick={() => onDue("")}
            style={{ marginLeft: -6 }}
          >
            ⌫
          </button>
        )}

        <button className="kill" title="Delete task" onClick={onDelete}>
          ×
        </button>
      </div>
    </div>
  );
}

function EmptyState({ hasClients, filter }: { hasClients: boolean; filter: Filter }) {
  if (!hasClients) {
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
        {filter === "done" ? "Nothing completed yet" : "No tasks here"}
      </div>
      <div>
        {filter === "done"
          ? "Completed tasks will show up here."
          : "Add a task with the form above."}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function nextPriority(p: Priority): Priority {
  const order: Priority[] = ["High", "Medium", "Low"];
  return order[(order.indexOf(p) + 1) % order.length];
}

function dueSortValue(dueDate: string): number {
  if (!dueDate) return Number.MAX_SAFE_INTEGER; // no due date sorts last
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
