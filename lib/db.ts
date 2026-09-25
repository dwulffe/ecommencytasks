import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { Client, Task, Suggestion, User, Note, Role, Priority, PRIORITIES } from "./types";
import { hashPassword, verifyPassword, sessionUserId } from "./auth";

/**
 * The Vercel/Neon integration injects the connection string under one of a few
 * names depending on how the database was created. Pick whichever is present.
 * The Neon HTTP driver works with either a pooled or a direct string.
 */
function connectionString(): string {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
  ];

  // The Neon HTTP driver needs a real postgres:// TCP string. Ignore any
  // leftover Prisma Accelerate URL (prisma+postgres://...) from a database
  // that was created earlier and later swapped out.
  const usable = candidates.find(
    (u) => u && (u.startsWith("postgres://") || u.startsWith("postgresql://"))
  );

  if (!usable) {
    throw new Error(
      "No usable Postgres connection string found. Connect a Neon (Serverless " +
        "Postgres) database in Vercel → Storage; it adds DATABASE_URL automatically."
    );
  }
  return usable;
}

type Row = Record<string, unknown>;
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

let cached: SqlTag | null = null;
function db(): SqlTag {
  if (!cached) cached = neon(connectionString()) as unknown as SqlTag;
  return cached;
}

let schemaReady: Promise<void> | null = null;

/** Create the tables on first use, once per warm instance. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db();
      await sql`
        CREATE TABLE IF NOT EXISTS clients (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS tasks (
          id            TEXT PRIMARY KEY,
          client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          title         TEXT NOT NULL,
          priority      TEXT NOT NULL DEFAULT 'Medium',
          due_date      TEXT NOT NULL DEFAULT '',
          done          BOOLEAN NOT NULL DEFAULT false,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at  TIMESTAMPTZ
        )`;
      // Added in a later version — safe to run every time.
      await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
      await sql`
        CREATE TABLE IF NOT EXISTS suggestions (
          id             TEXT PRIMARY KEY,
          client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          title          TEXT NOT NULL,
          priority       TEXT NOT NULL DEFAULT 'Medium',
          due_date       TEXT NOT NULL DEFAULT '',
          source_subject TEXT NOT NULL DEFAULT '',
          source_from    TEXT NOT NULL DEFAULT '',
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      // Users (admins + employees) and task assignment / timers.
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            TEXT PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          name          TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL DEFAULT 'employee',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id TEXT`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER NOT NULL DEFAULT 0`;

      await sql`
        CREATE TABLE IF NOT EXISTS notes (
          id          TEXT PRIMARY KEY,
          task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          author_id   TEXT NOT NULL DEFAULT '',
          author_name TEXT NOT NULL DEFAULT '',
          body        TEXT NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await ensureAdmin(sql);
    })().catch((err) => {
      // Reset so a later request can retry after a transient failure.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function normalizePriority(value: string): Priority {
  const match = PRIORITIES.find((p) => p.toLowerCase() === value.trim().toLowerCase());
  return match ?? "Medium";
}

function iso(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// ── Users (admins + employees) ───────────────────────────────

function normalizeRole(value: string): Role {
  return value === "admin" ? "admin" : "employee";
}

function rowToUser(r: Row): User {
  return {
    id: String(r.id),
    username: String(r.username),
    name: String(r.name ?? ""),
    role: normalizeRole(String(r.role)),
    createdAt: iso(r.created_at),
  };
}

/**
 * Keep the admin login in sync with the environment. The env vars are the
 * source of truth: on every cold start we (re)set the admin's password to
 * ADMIN_PASSWORD (falling back to APP_PASSWORD). So changing the env var and
 * redeploying always updates the admin login — no lockouts.
 */
async function ensureAdmin(sql: SqlTag): Promise<void> {
  const username = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD;
  if (!password) return; // can't manage the admin without a password set
  const hash = hashPassword(password);
  const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
  if (existing.length > 0) {
    await sql`UPDATE users SET password_hash = ${hash}, role = 'admin' WHERE username = ${username}`;
  } else {
    await sql`
      INSERT INTO users (id, username, name, password_hash, role)
      VALUES (${randomUUID()}, ${username}, ${"Admin"}, ${hash}, ${"admin"})`;
  }
}

export async function getUserByUsername(username: string): Promise<User | null> {
  await ensureSchema();
  const rows = await db()`SELECT * FROM users WHERE username = ${username.trim().toLowerCase()}`;
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  await ensureSchema();
  const rows = await db()`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** The signed-in user, resolved from the session cookie. */
export async function getCurrentUser(): Promise<User | null> {
  const id = sessionUserId();
  if (!id) return null;
  return getUserById(id);
}

/** Verify a login. Returns the user on success, null otherwise. */
export async function verifyLogin(username: string, password: string): Promise<User | null> {
  await ensureSchema();
  const rows = await db()`SELECT * FROM users WHERE username = ${username.trim().toLowerCase()}`;
  const row = rows[0];
  if (!row) return null;
  if (!verifyPassword(password, String(row.password_hash))) return null;
  return rowToUser(row);
}

export async function listUsers(): Promise<User[]> {
  await ensureSchema();
  const rows = await db()`SELECT id, username, name, role, created_at FROM users ORDER BY role ASC, username ASC`;
  return rows.map(rowToUser);
}

export async function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: Role;
}): Promise<User> {
  await ensureSchema();
  const username = input.username.trim().toLowerCase();
  if (!username) throw new Error("Username is required");
  if (!input.password) throw new Error("Password is required");
  const existing = await db()`SELECT id FROM users WHERE username = ${username}`;
  if (existing.length > 0) throw new Error("That username is already taken");
  const rows = await db()`
    INSERT INTO users (id, username, name, password_hash, role)
    VALUES (${randomUUID()}, ${username}, ${input.name.trim()}, ${hashPassword(input.password)}, ${input.role})
    RETURNING id, username, name, role, created_at`;
  return rowToUser(rows[0]);
}

export async function deleteUser(id: string): Promise<void> {
  await ensureSchema();
  // Unassign their tasks first (assignee_id has no FK cascade).
  await db()`UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ${id}`;
  await db()`DELETE FROM users WHERE id = ${id}`;
}

// ── Clients ──────────────────────────────────────────────────

function rowToClient(r: Row): Client {
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email ?? ""),
    createdAt: iso(r.created_at),
  };
}

export async function listClients(): Promise<Client[]> {
  await ensureSchema();
  const rows = await db()`SELECT id, name, email, created_at FROM clients ORDER BY name ASC`;
  return rows.map(rowToClient);
}

export async function addClient(name: string, email = ""): Promise<Client> {
  await ensureSchema();
  const id = randomUUID();
  const rows = await db()`
    INSERT INTO clients (id, name, email) VALUES (${id}, ${name.trim()}, ${email.trim().toLowerCase()})
    RETURNING id, name, email, created_at`;
  return rowToClient(rows[0]);
}

export async function deleteClient(id: string): Promise<void> {
  await ensureSchema();
  // ON DELETE CASCADE removes the client's tasks too.
  await db()`DELETE FROM clients WHERE id = ${id}`;
}

// ── Tasks ────────────────────────────────────────────────────

/** List tasks; pass an assigneeId to scope to one person (employees). */
export async function listTasks(opts?: { assigneeId?: string }): Promise<Task[]> {
  await ensureSchema();
  const sql = db();
  const rows = opts?.assigneeId
    ? await sql`
        SELECT t.*, u.name AS assignee_name, u.username AS assignee_username,
               (SELECT COUNT(*) FROM notes n WHERE n.task_id = t.id) AS note_count
        FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.assignee_id = ${opts.assigneeId}
        ORDER BY t.created_at DESC`
    : await sql`
        SELECT t.*, u.name AS assignee_name, u.username AS assignee_username,
               (SELECT COUNT(*) FROM notes n WHERE n.task_id = t.id) AS note_count
        FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
        ORDER BY t.created_at DESC`;
  return rows.map(rowToTask);
}

export async function getTask(id: string): Promise<Task | null> {
  await ensureSchema();
  const rows = await db()`
    SELECT t.*, u.name AS assignee_name, u.username AS assignee_username,
           (SELECT COUNT(*) FROM notes n WHERE n.task_id = t.id) AS note_count
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.id = ${id}`;
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function addTask(input: {
  clientId: string;
  title: string;
  priority: Priority;
  dueDate: string;
  assigneeId?: string;
}): Promise<Task> {
  await ensureSchema();
  const id = randomUUID();
  await db()`
    INSERT INTO tasks (id, client_id, title, priority, due_date, done, assignee_id)
    VALUES (${id}, ${input.clientId}, ${input.title.trim()}, ${input.priority},
            ${input.dueDate || ""}, false, ${input.assigneeId || null})`;
  return (await getTask(id))!;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "priority" | "dueDate" | "done" | "assigneeId">>
): Promise<Task | null> {
  await ensureSchema();
  const sql = db();

  if (patch.title !== undefined) {
    await sql`UPDATE tasks SET title = ${patch.title.trim()} WHERE id = ${id}`;
  }
  if (patch.priority !== undefined) {
    await sql`UPDATE tasks SET priority = ${patch.priority} WHERE id = ${id}`;
  }
  if (patch.dueDate !== undefined) {
    await sql`UPDATE tasks SET due_date = ${patch.dueDate} WHERE id = ${id}`;
  }
  if (patch.assigneeId !== undefined) {
    await sql`UPDATE tasks SET assignee_id = ${patch.assigneeId || null} WHERE id = ${id}`;
  }
  if (patch.done !== undefined) {
    if (patch.done) {
      // Completing auto-stops a running timer and banks the elapsed time.
      await sql`
        UPDATE tasks SET
          done = true,
          completed_at = now(),
          time_spent_seconds = time_spent_seconds
            + COALESCE(FLOOR(EXTRACT(EPOCH FROM (now() - timer_started_at)))::int, 0),
          timer_started_at = NULL
        WHERE id = ${id}`;
    } else {
      await sql`UPDATE tasks SET done = false, completed_at = NULL WHERE id = ${id}`;
    }
  }

  return getTask(id);
}

/** Start the timer (only if the task is open and not already running). */
export async function startTimer(id: string): Promise<Task | null> {
  await ensureSchema();
  await db()`
    UPDATE tasks SET timer_started_at = now()
    WHERE id = ${id} AND done = false AND timer_started_at IS NULL`;
  return getTask(id);
}

/** Pause the timer: bank the elapsed interval and stop the clock. */
export async function pauseTimer(id: string): Promise<Task | null> {
  await ensureSchema();
  await db()`
    UPDATE tasks SET
      time_spent_seconds = time_spent_seconds
        + COALESCE(FLOOR(EXTRACT(EPOCH FROM (now() - timer_started_at)))::int, 0),
      timer_started_at = NULL
    WHERE id = ${id} AND timer_started_at IS NOT NULL`;
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM tasks WHERE id = ${id}`;
}

export interface ReportRow {
  assigneeId: string;
  name: string;
  taskCount: number;
  totalSeconds: number;
}

/**
 * Time logged per person on tasks COMPLETED within [start, end] (inclusive,
 * dates as YYYY-MM-DD). Time is bucketed by each task's completion date, since
 * that's the only timestamp we have for a task's total logged time.
 */
export async function reportByUser(start: string, end: string): Promise<ReportRow[]> {
  await ensureSchema();
  const rows = await db()`
    SELECT t.assignee_id, u.name, u.username,
           COALESCE(SUM(t.time_spent_seconds), 0)::int AS total_seconds,
           COUNT(*)::int AS task_count
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.done = true
      AND t.completed_at IS NOT NULL
      AND t.completed_at::date >= ${start}::date
      AND t.completed_at::date <= ${end}::date
    GROUP BY t.assignee_id, u.name, u.username
    ORDER BY total_seconds DESC`;
  return rows.map((r) => ({
    assigneeId: r.assignee_id ? String(r.assignee_id) : "",
    name: String(r.name || r.username || "Unassigned"),
    taskCount: Number(r.task_count ?? 0),
    totalSeconds: Number(r.total_seconds ?? 0),
  }));
}

export interface ReportTask {
  id: string;
  title: string;
  clientName: string;
  assigneeId: string;
  completedAt: string;
  timeSpentSeconds: number;
}

/** The individual tasks completed within [start, end], for the report drill-down. */
export async function reportCompletedTasks(start: string, end: string): Promise<ReportTask[]> {
  await ensureSchema();
  const rows = await db()`
    SELECT t.id, t.title, t.assignee_id, t.time_spent_seconds, t.completed_at,
           c.name AS client_name
    FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.done = true
      AND t.completed_at IS NOT NULL
      AND t.completed_at::date >= ${start}::date
      AND t.completed_at::date <= ${end}::date
    ORDER BY t.completed_at DESC`;
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    clientName: String(r.client_name || ""),
    assigneeId: r.assignee_id ? String(r.assignee_id) : "",
    completedAt: iso(r.completed_at),
    timeSpentSeconds: Number(r.time_spent_seconds ?? 0),
  }));
}

function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    title: String(r.title),
    priority: normalizePriority(String(r.priority)),
    dueDate: String(r.due_date ?? ""),
    done: r.done === true,
    createdAt: iso(r.created_at),
    completedAt: iso(r.completed_at),
    assigneeId: r.assignee_id ? String(r.assignee_id) : "",
    assigneeName: String(r.assignee_name || r.assignee_username || ""),
    timerStartedAt: iso(r.timer_started_at),
    timeSpentSeconds: Number(r.time_spent_seconds ?? 0),
    noteCount: Number(r.note_count ?? 0),
  };
}

// ── Notes (shared per task) ──────────────────────────────────

function rowToNote(r: Row): Note {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    authorId: String(r.author_id ?? ""),
    authorName: String(r.author_name ?? ""),
    body: String(r.body ?? ""),
  };
}

export async function listNotes(taskId: string): Promise<Note[]> {
  await ensureSchema();
  const rows = await db()`
    SELECT id, task_id, author_id, author_name, body
    FROM notes WHERE task_id = ${taskId} ORDER BY created_at ASC`;
  return rows.map(rowToNote);
}

export async function getNote(id: string): Promise<Note | null> {
  await ensureSchema();
  const rows = await db()`SELECT id, task_id, author_id, author_name, body FROM notes WHERE id = ${id}`;
  return rows[0] ? rowToNote(rows[0]) : null;
}

export async function addNote(input: {
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
}): Promise<Note> {
  await ensureSchema();
  const id = randomUUID();
  const rows = await db()`
    INSERT INTO notes (id, task_id, author_id, author_name, body)
    VALUES (${id}, ${input.taskId}, ${input.authorId}, ${input.authorName}, ${input.body.trim()})
    RETURNING id, task_id, author_id, author_name, body`;
  return rowToNote(rows[0]);
}

export async function updateNote(id: string, body: string): Promise<Note | null> {
  await ensureSchema();
  const rows = await db()`
    UPDATE notes SET body = ${body.trim()} WHERE id = ${id}
    RETURNING id, task_id, author_id, author_name, body`;
  return rows[0] ? rowToNote(rows[0]) : null;
}

export async function deleteNote(id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM notes WHERE id = ${id}`;
}

// ── Suggestions (from inbound email) ─────────────────────────

function rowToSuggestion(r: Row): Suggestion {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    title: String(r.title),
    priority: normalizePriority(String(r.priority)),
    dueDate: String(r.due_date ?? ""),
    sourceSubject: String(r.source_subject ?? ""),
    sourceFrom: String(r.source_from ?? ""),
    createdAt: iso(r.created_at),
  };
}

export async function listSuggestions(): Promise<Suggestion[]> {
  await ensureSchema();
  const rows = await db()`
    SELECT id, client_id, title, priority, due_date, source_subject, source_from, created_at
    FROM suggestions ORDER BY created_at DESC`;
  return rows.map(rowToSuggestion);
}

export async function addSuggestion(input: {
  clientId: string;
  title: string;
  priority: Priority;
  dueDate: string;
  sourceSubject: string;
  sourceFrom: string;
}): Promise<Suggestion> {
  await ensureSchema();
  const id = randomUUID();
  const rows = await db()`
    INSERT INTO suggestions
      (id, client_id, title, priority, due_date, source_subject, source_from)
    VALUES
      (${id}, ${input.clientId}, ${input.title.trim()}, ${input.priority},
       ${input.dueDate || ""}, ${input.sourceSubject}, ${input.sourceFrom})
    RETURNING id, client_id, title, priority, due_date, source_subject, source_from, created_at`;
  return rowToSuggestion(rows[0]);
}

/** Accept a suggestion: turn it into a real task, then remove the suggestion. */
export async function acceptSuggestion(id: string): Promise<Task | null> {
  await ensureSchema();
  const rows = await db()`SELECT * FROM suggestions WHERE id = ${id}`;
  if (!rows[0]) return null;
  const s = rowToSuggestion(rows[0]);
  const task = await addTask({
    clientId: s.clientId,
    title: s.title,
    priority: s.priority,
    dueDate: s.dueDate,
  });
  await db()`DELETE FROM suggestions WHERE id = ${id}`;
  return task;
}

export async function dismissSuggestion(id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM suggestions WHERE id = ${id}`;
}

/**
 * Find the client an inbound email belongs to, by matching any of the email's
 * participant addresses against a client's saved email — first on the exact
 * address, then on the domain (so anyone @clientco.com maps to that client).
 */
export async function matchClient(addresses: string[]): Promise<Client | null> {
  const clients = (await listClients()).filter((c) => c.email);
  if (clients.length === 0) return null;

  const addrs = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const domains = new Set(addrs.map((a) => a.split("@")[1]).filter(Boolean));

  // Exact address match wins.
  for (const c of clients) {
    if (addrs.includes(c.email)) return c;
  }
  // Then domain match.
  for (const c of clients) {
    const clientDomain = c.email.split("@")[1];
    if (clientDomain && domains.has(clientDomain)) return c;
  }
  return null;
}
