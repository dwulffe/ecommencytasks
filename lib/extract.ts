import Anthropic from "@anthropic-ai/sdk";
import { Priority, PRIORITIES } from "./types";

export interface ExtractedTask {
  title: string;
  priority: Priority;
  dueDate: string; // YYYY-MM-DD or ""
}

const MODEL = process.env.EXTRACT_MODEL || "claude-opus-5";

// Keep a lid on token usage for very long threads.
const MAX_CHARS = 12000;

const SYSTEM = `You read an email between a marketing agency and its client and pull out concrete action items that the AGENCY (the reader) needs to do.

Rules:
- Only include real, actionable tasks the agency owns. Ignore pleasantries, FYIs, and things the client said THEY would do.
- If the email contains no action items for the agency, return an empty array.
- Keep each task title short and imperative (e.g. "Send revised A+ content", "Confirm ad budget for July").
- priority is one of: High, Medium, Low. Infer from urgency/tone; default Medium.
- dueDate is an ISO date (YYYY-MM-DD) if the email implies one, otherwise an empty string. Resolve relative dates ("by Friday", "end of month") against the provided current date.

Respond with ONLY a JSON array, no prose, no code fences. Each element: {"title": string, "priority": "High"|"Medium"|"Low", "dueDate": string}.`;

function coercePriority(v: unknown): Priority {
  const s = String(v ?? "").trim();
  return PRIORITIES.find((p) => p.toLowerCase() === s.toLowerCase()) ?? "Medium";
}

function coerceDate(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** Ask Claude for the action items in an email. Returns [] on any failure. */
export async function extractTasks(email: {
  from: string;
  subject: string;
  body: string;
}): Promise<ExtractedTask[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);
  const body = email.body.slice(0, MAX_CHARS);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Current date: ${today}
From: ${email.from}
Subject: ${email.subject}

${body}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const json = stripFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item): ExtractedTask | null => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      const title = String(rec.title ?? "").trim();
      if (!title) return null;
      return {
        title: title.slice(0, 300),
        priority: coercePriority(rec.priority),
        dueDate: coerceDate(rec.dueDate),
      };
    })
    .filter((t): t is ExtractedTask => t !== null);
}

/** Strip ```json ... ``` fences if the model added them despite instructions. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Otherwise grab the outermost array if there's surrounding prose.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}
