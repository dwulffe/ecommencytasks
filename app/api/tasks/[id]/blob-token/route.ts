import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getTask, getCurrentUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues a short-lived token for a direct browser→Blob upload. The image bytes
 * never pass through this function, so there's no serverless body-size limit.
 * Access: an admin, or the employee the task is assigned to.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as HandleUploadBody;

  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const task = await getTask(params.id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (me.role !== "admin" && task.assigneeId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
        addRandomSuffix: true,
        maximumSizeInBytes: 25 * 1024 * 1024,
      }),
      // The DB record is written by the client via POST /screenshots after the
      // upload resolves, so this can be a no-op.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
