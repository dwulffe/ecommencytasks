import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import { Client, Task, Priority, PRIORITIES } from "./types";

/**
 * The Vercel/Neon integration injects the connection string under one of a few
 * names depending on how the database was created. Pick whichever is present.
 * The Neon HTTP driver works with either a pooled or a direct string.
 */
function connectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "No Postgres connection string found. Set DATABASE_URL or POSTGRES_URL " +
        "(the Vercel Postgres/Neon integration adds this automatically)."
    );
  }
  return url;
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

export async function listClients(): Promise<Client[]> {
  await ensureSchema();
  const rows = await db()`SELECT id, name, created_at FROM clients ORDER BY name ASC`;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    createdAt: iso(r.created_at),
  }));
}

export async function addClient(name: string): Promise<Client> {
  await ensureSchema();
  const id = randomUUID();
  const trimmed = name.trim();
  const rows = await db()`
    INSERT INTO clients (id, name) VALUES (${id}, ${trimmed})
    RETURNING id, name, created_at`;
  const r = rows[0];
  return { id: String(r.id), name: String(r.name), createdAt: iso(r.created_at) };
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
