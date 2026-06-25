import { NextRequest, NextResponse } from "next/server";

import {
  adminContextFromRequest,
  assertAdminPermission,
  recordAdminAction,
} from "@/server/admin/admin-actions";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { db } from "@/server/db/client";

const ADMIN_PERMISSION_OPTIONS = new Set([
  "catalog:read",
  "override:write",
  "override:rollback",
  "asset:write",
  "cache:write",
  "user:read",
  "user:write",
  "provider:write",
  "worker:read",
  "worker:write",
]);

function parsePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item === "*" || ADMIN_PERMISSION_OPTIONS.has(item)),
    ),
  );
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "user:read");

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      image: true,
      role: true,
      accessStatus: true,
      blockedAt: true,
      blockedReason: true,
      adminPermissions: true,
      lastAdminActionAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          accounts: true,
          sessions: true,
          userTitles: true,
          userEvents: true,
          userStreamingPreferences: true,
        },
      },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      admin: {
        actorUserId: context.actorUserId,
        master: Boolean(process.env.ADMIN_SECRET),
        role: context.role ?? null,
        permissions: [...context.permissions],
      },
      capabilities: {
        listUsers: true,
        blockUsers: true,
        roles: ["user", "admin", "master"],
        permissions: [...ADMIN_PERMISSION_OPTIONS],
      },
      users: users.map((user) => ({
        ...user,
        blockedAt: user.blockedAt?.toISOString() ?? null,
        lastAdminActionAt: user.lastAdminActionAt?.toISOString() ?? null,
        adminPermissions: parsePermissions(user.adminPermissions),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "user:write");

  const body = await request.json().catch(() => ({})) as {
    userId?: string;
    action?: "block" | "reactivate" | "setRole" | "setPermissions";
    reason?: string | null;
    role?: "user" | "admin" | "master";
    permissions?: unknown;
  };

  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "userId obrigatório." }, { status: 400 });
  }

  const previous = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      accessStatus: true,
      blockedAt: true,
      blockedReason: true,
      adminPermissions: true,
    },
  });
  if (!previous) {
    return NextResponse.json({ ok: false, error: "Usuário não encontrado." }, { status: 404 });
  }

  const now = new Date();
  let action = body.action;
  let data: Parameters<typeof db.user.update>[0]["data"];

  if (action === "block") {
    data = {
      accessStatus: "blocked",
      blockedAt: now,
      blockedReason: body.reason?.trim() || "Bloqueado pelo painel administrativo.",
      lastAdminActionAt: now,
    };
  } else if (action === "reactivate") {
    data = {
      accessStatus: "active",
      blockedAt: null,
      blockedReason: null,
      lastAdminActionAt: now,
    };
  } else if (action === "setRole") {
    if (!body.role || !["user", "admin", "master"].includes(body.role)) {
      return NextResponse.json({ ok: false, error: "Role inválida." }, { status: 400 });
    }
    data = {
      role: body.role,
      lastAdminActionAt: now,
    };
  } else if (action === "setPermissions") {
    data = {
      adminPermissions: parsePermissions(body.permissions),
      lastAdminActionAt: now,
    };
  } else {
    return NextResponse.json({ ok: false, error: "Ação inválida." }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      role: true,
      accessStatus: true,
      blockedAt: true,
      blockedReason: true,
      adminPermissions: true,
      lastAdminActionAt: true,
    },
  });

  await recordAdminAction({
    context,
    entityType: "user",
    entityId: userId,
    action: `user.${action}`,
    previousJson: previous,
    nextJson: updated,
    reason: body.reason ?? null,
    metadata: {
      role: updated.role,
      accessStatus: updated.accessStatus,
      permissions: parsePermissions(updated.adminPermissions),
    },
  });

  return NextResponse.json({
    ok: true,
    user: {
      ...updated,
      blockedAt: updated.blockedAt?.toISOString() ?? null,
      lastAdminActionAt: updated.lastAdminActionAt?.toISOString() ?? null,
      adminPermissions: parsePermissions(updated.adminPermissions),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
