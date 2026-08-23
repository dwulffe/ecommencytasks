import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { Client, Task, Suggestion, Priority, PRIORITIES } from "./types";

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

export async function listTasks(): Promise<Task[]> {
  await ensureSchema();
  const rows = await db()`
    SELECT id, client_id, title, priority, due_date, done, created_at, completed_at
    FROM tasks ORDER BY created_at DESC`;
  return rows.map(rowToTask);
}

export async function addTask(input: {
  clientId: string;
  title: string;
  priority: Priority;
  dueDate: string;
}): Promise<Task> {
  await ensureSchema();
  const id = randomUUID();
  const rows = await db()`
    INSERT INTO tasks (id, client_id, title, priority, due_date, done)
    VALUES (${id}, ${input.clientId}, ${input.title.trim()}, ${input.priority}, ${input.dueDate || ""}, false)
    RETURNING id, client_id, title, priority, due_date, done, created_at, completed_at`;
  return rowToTask(rows[0]);
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "priority" | "dueDate" | "done">>
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
  if (patch.done !== undefined) {
    const completedAt = patch.done ? new Date().toISOString() : null;
    await sql`UPDATE tasks SET done = ${patch.done}, completed_at = ${completedAt} WHERE id = ${id}`;
  }

  const rows = await sql`
    SELECT id, client_id, title, priority, due_date, done, created_at, completed_at
    FROM tasks WHERE id = ${id}`;
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function deleteTask(id: string): Promise<void> {
  await ensureSchema();
  await db()`DELETE FROM tasks WHERE id = ${id}`;
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
  };
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
