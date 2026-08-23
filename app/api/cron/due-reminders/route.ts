import { NextRequest, NextResponse } from "next/server";
import { listTasks, listClients } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Placeholder endpoint for due-date email reminders.
 *
 * Email is intentionally NOT wired up yet. This route already computes the
 * tasks that are due today or overdue, so adding email later is a small step:
 * see README → "Adding email reminders". Wire this to Vercel Cron and drop an
 * email provider call where indicated below.
 *
 * Protect it with a CRON_SECRET so only Vercel Cron (or you) can trigger it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const [tasks, clients] = await Promise.all([listTasks(), listClients()]);
    const clientName = new Map(clients.map((c) => [c.id, c.name]));
    const today = new Date().toISOString().slice(0, 10);

    const dueOrOverdue = tasks
      .filter((t) => !t.done && t.dueDate && t.dueDate <= today)
      .map((t) => ({
        task: t.title,
        client: clientName.get(t.clientId) ?? "Unknown",
        priority: t.priority,
        dueDate: t.dueDate,
        overdue: t.dueDate < today,
      }));

    // TODO(email): send `dueOrOverdue` to your team here.
    // e.g. await sendReminderEmail(dueOrOverdue);

    return NextResponse.json({ count: dueOrOverdue.length, dueOrOverdue });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
