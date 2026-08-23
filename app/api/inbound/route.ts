import { NextRequest, NextResponse } from "next/server";
import { matchClient, addSuggestion } from "@/lib/db";
import { extractTasks } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Parsing + a Claude call can take a while; give it room.
export const maxDuration = 60;

interface NormalizedEmail {
  from: string;
  addresses: string[];
  subject: string;
  body: string;
}

/**
 * Inbound-email webhook. An email-forwarding service (CloudMailin, Postmark,
 * SendGrid Inbound Parse, …) POSTs each forwarded email here; we match it to a
 * client, ask Claude for the action items, and store them as suggestions.
 *
 * Secured with a shared token in the query string (?token=...), since the
 * sender can't send auth cookies.
 */
export async function POST(req: NextRequest) {
  const token = process.env.INBOUND_TOKEN;
  if (!token || req.nextUrl.searchParams.get("token") !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email: NormalizedEmail;
  try {
    email = await normalize(req);
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }

  try {
    const client = await matchClient(email.addresses);
    if (!client) {
      // Not an error — just no client matches this email's participants.
      return NextResponse.json({ matched: false, created: 0 });
    }

    const tasks = await extractTasks({
      from: email.from,
      subject: email.subject,
      body: email.body,
    });

    for (const t of tasks) {
      await addSuggestion({
        clientId: client.id,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
        sourceSubject: email.subject,
        sourceFrom: email.from,
      });
    }

    return NextResponse.json({ matched: true, client: client.name, created: tasks.length });
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

// ── Payload normalization ────────────────────────────────────

async function normalize(req: NextRequest): Promise<NormalizedEmail> {
  const contentType = req.headers.get("content-type") || "";
  let raw: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    raw = (await req.json()) as Record<string, unknown>;
  } else {
    // multipart/form-data or x-www-form-urlencoded (SendGrid, some others)
    const form = await req.formData();
    raw = {};
    for (const [k, v] of form.entries()) raw[k] = typeof v === "string" ? v : "";
  }

  const headers = (raw.headers as Record<string, unknown>) || {};
  const envelope = (raw.envelope as Record<string, unknown>) || {};

  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const fromRaw = raw[k];
      if (typeof fromRaw === "string" && fromRaw) return fromRaw;
      const fromHeaders = headers[k];
      if (typeof fromHeaders === "string" && fromHeaders) return fromHeaders;
    }
    return "";
  };

  const fromField = pick("from", "From", "FromFull");
  const toField = pick("to", "To");
  const ccField = pick("cc", "Cc");
  const subject = pick("subject", "Subject");

  let body = pick("plain", "text", "TextBody", "reply_plain");
  if (!body) body = stripHtml(pick("html", "HtmlBody"));

  // Gather every address we can see, to match against a client.
  const addresses = new Set<string>();
  for (const a of extractAddresses(fromField)) addresses.add(a);
  for (const a of extractAddresses(toField)) addresses.add(a);
  for (const a of extractAddresses(ccField)) addresses.add(a);
  const envFrom = typeof envelope.from === "string" ? envelope.from : "";
  for (const a of extractAddresses(envFrom)) addresses.add(a);
  if (Array.isArray(envelope.recipients)) {
    for (const r of envelope.recipients) {
      if (typeof r === "string") for (const a of extractAddresses(r)) addresses.add(a);
    }
  }

  const from = extractAddresses(fromField)[0] || fromField;

  if (!body && !subject) {
    throw new Error("Could not read email body or subject from payload");
  }

  return { from, addresses: [...addresses], subject, body };
}

/** Pull bare email addresses out of a header value like `Name <a@b.com>, c@d.com`. */
function extractAddresses(value: string): string[] {
  if (!value) return [];
  const matches = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}
