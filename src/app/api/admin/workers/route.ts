import { NextRequest, NextResponse } from "next/server";
import type { MediaType } from "@prisma/client";

import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import {
  adminContextFromRequest,
  assertAdminPermission,
  recordAdminAction,
} from "@/server/admin/admin-actions";
import { db } from "@/server/db/client";
import {
  claimRefreshJobs,
  completeRefreshJob,
  enqueueRefreshJob,
  getRefreshQueueStats,
  serializeRefreshJob,
} from "@/server/workers/refresh-queue";

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanMediaType(value: unknown): MediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "worker:read");

  const stats = await getRefreshQueueStats();
  return NextResponse.json(
    { ok: true, ...stats },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "worker:write");

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = cleanString(body.action) ?? "enqueue";

  if (action === "enqueue") {
    const job = await enqueueRefreshJob({
      kind: cleanString(body.kind) ?? "manual",
      cacheKey: cleanString(body.cacheKey),
      mediaType: cleanMediaType(body.mediaType),
      poplogId: cleanString(body.poplogId),
      imdbId: cleanString(body.imdbId),
      slug: cleanString(body.slug),
      traktId: cleanString(body.traktId),
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
    });

    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: job.id.toString(),
      action: "worker.enqueue",
      nextJson: serializeRefreshJob(job),
      metadata: { route: "/api/admin/workers" },
    });

    return NextResponse.json(
      { ok: true, job: serializeRefreshJob(job) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "claim") {
    const jobs = await claimRefreshJobs({
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : undefined,
      kinds: Array.isArray(body.kinds)
        ? body.kinds.filter((kind: unknown): kind is string => typeof kind === "string")
        : undefined,
    });

    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: "refresh-queue",
      action: "worker.claim",
      nextJson: { claimed: jobs.map((job) => job.id.toString()) },
      metadata: { route: "/api/admin/workers" },
    });

    return NextResponse.json(
      { ok: true, jobs: jobs.map(serializeRefreshJob) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "complete") {
    const id = cleanString(body.id);
    if (!id) {
      return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    }
    const job = await completeRefreshJob(BigInt(id));

    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: job.id.toString(),
      action: "worker.complete",
      nextJson: serializeRefreshJob(job),
      metadata: { route: "/api/admin/workers" },
    });

    return NextResponse.json(
      { ok: true, job: serializeRefreshJob(job) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "retry-failed") {
    const result = await db.poplogRefreshQueue.updateMany({
      where: { status: "failed" },
      data: {
        status: "queued",
        lockedUntil: null,
        lastError: null,
        runAfter: new Date(),
      },
    });

    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: "refresh-queue",
      action: "worker.retry_failed",
      nextJson: { count: result.count },
      metadata: { route: "/api/admin/workers" },
    });

    return NextResponse.json(
      { ok: true, retried: result.count },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "clear-completed") {
    const result = await db.poplogRefreshQueue.deleteMany({ where: { status: "completed" } });

    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: "refresh-queue",
      action: "worker.clear_completed",
      nextJson: { count: result.count },
      metadata: { route: "/api/admin/workers" },
    });

    return NextResponse.json(
      { ok: true, cleared: result.count },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: false, error: `Unknown action: ${action}` },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
