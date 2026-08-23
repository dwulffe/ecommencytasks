import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { randomUUID } from "crypto";
import { Client, Task, Priority, PRIORITIES } from "./types";

const CLIENTS_SHEET = "Clients";
const TASKS_SHEET = "Tasks";

const CLIENT_HEADERS = ["id", "name", "createdAt"];
const TASK_HEADERS = [
  "id",
  "clientId",
  "title",
  "priority",
  "dueDate",
  "done",
  "createdAt",
  "completedAt",
];

let cachedDoc: GoogleSpreadsheet | null = null;

function getAuth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variables."
    );
  }
  // Vercel stores the key with real newlines; a local .env keeps literal "\n".
  const key = rawKey.replace(/\\n/g, "\n");
  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getDoc(): Promise<GoogleSpreadsheet> {
  if (cachedDoc) return cachedDoc;
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID environment variable.");
  const doc = new GoogleSpreadsheet(id, getAuth());
  await doc.loadInfo();
  cachedDoc = doc;
  return doc;
}

async function ensureSheet(
  doc: GoogleSpreadsheet,
  title: string,
  headers: string[]
): Promise<GoogleSpreadsheetWorksheet> {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: headers });
    return sheet;
  }
  // Make sure headers are present (a brand-new empty sheet has none).
  try {
    await sheet.loadHeaderRow();
  } catch {
    await sheet.setHeaderRow(headers);
  }
  return sheet;
}

function normalizePriority(value: string): Priority {
  const match = PRIORITIES.find((p) => p.toLowerCase() === value.trim().toLowerCase());
  return match ?? "Medium";
}

// ── Clients ──────────────────────────────────────────────────

export async function listClients(): Promise<Client[]> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, CLIENTS_SHEET, CLIENT_HEADERS);
  const rows = await sheet.getRows();
  return rows
    .map((r) => ({
      id: String(r.get("id") ?? ""),
      name: String(r.get("name") ?? ""),
      createdAt: String(r.get("createdAt") ?? ""),
    }))
    .filter((c) => c.id && c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function addClient(name: string): Promise<Client> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, CLIENTS_SHEET, CLIENT_HEADERS);
  const client: Client = {
    id: randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  await sheet.addRow({ ...client });
  return client;
}

export async function deleteClient(id: string): Promise<void> {
  const doc = await getDoc();
  const clientsSheet = await ensureSheet(doc, CLIENTS_SHEET, CLIENT_HEADERS);
  const clientRows = await clientsSheet.getRows();
  const target = clientRows.find((r) => String(r.get("id")) === id);
  if (target) await target.delete();

  // Cascade: remove that client's tasks too.
  const tasksSheet = await ensureSheet(doc, TASKS_SHEET, TASK_HEADERS);
  const taskRows = await tasksSheet.getRows();
  // Delete from the bottom up so row indexes stay valid.
  const toDelete = taskRows.filter((r) => String(r.get("clientId")) === id);
  for (const row of toDelete.reverse()) {
    await row.delete();
  }
}

// ── Tasks ────────────────────────────────────────────────────

export async function listTasks(): Promise<Task[]> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, TASKS_SHEET, TASK_HEADERS);
  const rows = await sheet.getRows();
  return rows
    .map((r) => ({
      id: String(r.get("id") ?? ""),
      clientId: String(r.get("clientId") ?? ""),
      title: String(r.get("title") ?? ""),
      priority: normalizePriority(String(r.get("priority") ?? "Medium")),
      dueDate: String(r.get("dueDate") ?? ""),
      done: String(r.get("done") ?? "").trim().toUpperCase() === "TRUE",
      createdAt: String(r.get("createdAt") ?? ""),
      completedAt: String(r.get("completedAt") ?? ""),
    }))
    .filter((t) => t.id && t.title);
}

export async function addTask(input: {
  clientId: string;
  title: string;
  priority: Priority;
  dueDate: string;
}): Promise<Task> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, TASKS_SHEET, TASK_HEADERS);
  const task: Task = {
    id: randomUUID(),
    clientId: input.clientId,
    title: input.title.trim(),
    priority: input.priority,
    dueDate: input.dueDate || "",
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: "",
  };
  await sheet.addRow({
    ...task,
    done: "FALSE",
  });
  return task;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "priority" | "dueDate" | "done">>
): Promise<Task | null> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, TASKS_SHEET, TASK_HEADERS);
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("id")) === id);
  if (!row) return null;

  if (patch.title !== undefined) row.set("title", patch.title.trim());
  if (patch.priority !== undefined) row.set("priority", patch.priority);
  if (patch.dueDate !== undefined) row.set("dueDate", patch.dueDate);
  if (patch.done !== undefined) {
    row.set("done", patch.done ? "TRUE" : "FALSE");
    row.set("completedAt", patch.done ? new Date().toISOString() : "");
  }
  await row.save();

  return {
    id: String(row.get("id")),
    clientId: String(row.get("clientId")),
    title: String(row.get("title")),
    priority: normalizePriority(String(row.get("priority"))),
    dueDate: String(row.get("dueDate") ?? ""),
    done: String(row.get("done")).trim().toUpperCase() === "TRUE",
    createdAt: String(row.get("createdAt") ?? ""),
    completedAt: String(row.get("completedAt") ?? ""),
  };
}

export async function deleteTask(id: string): Promise<void> {
  const doc = await getDoc();
  const sheet = await ensureSheet(doc, TASKS_SHEET, TASK_HEADERS);
  const rows = await sheet.getRows();
  const row = rows.find((r) => String(r.get("id")) === id);
  if (row) await row.delete();
}
