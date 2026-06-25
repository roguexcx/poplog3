import { Prisma } from "@prisma/client";

import { db } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
  titleCacheKey,
} from "@/server/source-engine/locale";

export type AdminContext = {
  actorUserId: string;
  ip: string | null;
  permissions: Set<string>;
  role?: string | null;
};

function envAdminContextFromRequest(request: Request): AdminContext {
  const actorUserId =
    request.headers.get("x-admin-user-id")?.trim() ||
    process.env.ADMIN_MASTER_USER_ID ||
    "admin-secret";
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const permissionsRaw =
    request.headers.get("x-admin-permissions") ??
    process.env.ADMIN_PERMISSIONS ??
    "catalog:read,override:write,override:rollback,asset:write,cache:write,user:read,provider:write,worker:read,worker:write";

  return {
    actorUserId,
    ip: forwardedFor || null,
    permissions: new Set(
      permissionsRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  };
}

function permissionsFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function adminContextFromRequest(request: Request): Promise<AdminContext> {
  const context = envAdminContextFromRequest(request);

  const actorUserId =
    context.actorUserId !== "admin-secret"
      ? context.actorUserId
      : (await getCurrentUser().catch(() => null))?.id ?? context.actorUserId;

  if (actorUserId === "admin-secret") return context;

  const user = await db.user.findUnique({
    where: { id: actorUserId },
    select: {
      role: true,
      accessStatus: true,
      adminPermissions: true,
    },
  }).catch(() => null);

  if (!user || user.accessStatus === "blocked") return context;

  const permissions = new Set(context.permissions);
  if (user.role === "master") {
    permissions.add("*");
  } else if (user.role === "admin") {
    for (const permission of permissionsFromJson(user.adminPermissions)) {
      permissions.add(permission);
    }
  }

  return {
    ...context,
    actorUserId,
    role: user.role,
    permissions,
  };
}

export function assertAdminPermission(context: AdminContext, permission: string) {
  if (context.permissions.has("*") || context.permissions.has(permission)) return;
  throw new Error(`Missing admin permission: ${permission}`);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function buildOverrideCacheKey(input: {
  imdbId: string;
  language?: string | null;
  region?: string | null;
}) {
  return titleCacheKey(input.imdbId, {
    catalogLanguage: normalizeCatalogLanguage(input.language),
    region: normalizeCatalogRegion(input.region),
  });
}

export async function invalidateCatalogCaches(input: {
  imdbId: string;
  language?: string | null;
  region?: string | null;
}) {
  const cacheKey = buildOverrideCacheKey(input);
  const result = await db.continuitySectionCache.deleteMany({
    where: {
      OR: [
        { sectionKey: { contains: input.imdbId } },
        { sectionKey: { startsWith: "home" } },
        { sectionKey: { startsWith: "hero" } },
        { sectionKey: { startsWith: "radar" } },
        { sectionKey: { startsWith: "sorteio" } },
        { sectionKey: { startsWith: "for-you" } },
      ],
    },
  }).catch(() => ({ count: 0 }));

  await import("@/server/cache/redis-client")
    .then(({ redisDeleteByPattern }) =>
      Promise.all([
        redisDeleteByPattern(`continuity:section:*${input.imdbId}*`),
        redisDeleteByPattern("continuity:section:home*"),
        redisDeleteByPattern("continuity:section:hero*"),
        redisDeleteByPattern("continuity:section:radar*"),
        redisDeleteByPattern("continuity:section:sorteio*"),
        redisDeleteByPattern("continuity:section:for-you*"),
      ]),
    )
    .catch(() => []);

  return { cacheKey, invalidated: result.count };
}

export async function recordAdminAction(input: {
  context: AdminContext;
  entityType: string;
  entityId: string;
  action: string;
  field?: string | null;
  language?: string | null;
  region?: string | null;
  previousJson?: unknown;
  nextJson?: unknown;
  reason?: string | null;
  cacheKey?: string | null;
  cacheInvalidated?: boolean;
  metadata?: unknown;
}) {
  return db.adminActionLog.create({
    data: {
      actorUserId: input.context.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field ?? null,
      language: input.language ?? null,
      region: input.region ?? null,
      previousJson: input.previousJson === undefined ? undefined : jsonValue(input.previousJson),
      nextJson: input.nextJson === undefined ? undefined : jsonValue(input.nextJson),
      action: input.action,
      reason: input.reason ?? null,
      cacheKey: input.cacheKey ?? null,
      cacheInvalidated: Boolean(input.cacheInvalidated),
      metadata: input.metadata === undefined ? undefined : jsonValue(input.metadata),
      ip: input.context.ip,
    },
  });
}

export async function saveTitleOverride(input: {
  context: AdminContext;
  imdbId: string;
  field: string;
  language?: string | null;
  region?: string | null;
  value: unknown;
  reason?: string | null;
}) {
  assertAdminPermission(input.context, "override:write");

  const language = input.language ? normalizeCatalogLanguage(input.language) : null;
  const region = input.region ? normalizeCatalogRegion(input.region) : null;
  const active = await db.titleOverride.findFirst({
    where: {
      imdbId: input.imdbId,
      field: input.field,
      language,
      region,
      active: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (active) {
    await db.titleOverride.update({
      where: { id: active.id },
      data: { active: false },
    });
  }

  const { cacheKey, invalidated } = await invalidateCatalogCaches({
    imdbId: input.imdbId,
    language,
    region,
  });

  const override = await db.titleOverride.create({
    data: {
      imdbId: input.imdbId,
      field: input.field,
      language,
      region,
      valueJson: jsonValue(input.value),
      previousJson: active?.valueJson === undefined ? undefined : jsonValue(active?.valueJson),
      reason: input.reason ?? null,
      actorUserId: input.context.actorUserId,
      active: true,
      cacheKey,
    },
  });

  await recordAdminAction({
    context: input.context,
    entityType: "title",
    entityId: input.imdbId,
    action: "override.save",
    field: input.field,
    language,
    region,
    previousJson: active?.valueJson ?? null,
    nextJson: input.value,
    reason: input.reason ?? null,
    cacheKey,
    cacheInvalidated: invalidated > 0,
    metadata: { overrideId: override.id, invalidated },
  });

  return { override, cacheKey, invalidated };
}

export async function rollbackTitleOverride(input: {
  context: AdminContext;
  overrideId: string;
  reason?: string | null;
}) {
  assertAdminPermission(input.context, "override:rollback");

  const override = await db.titleOverride.findUnique({ where: { id: input.overrideId } });
  if (!override) throw new Error("Override not found.");

  await db.titleOverride.update({
    where: { id: override.id },
    data: { active: false },
  });

  const { cacheKey, invalidated } = await invalidateCatalogCaches({
    imdbId: override.imdbId,
    language: override.language,
    region: override.region,
  });

  let restoredId: string | null = null;
  if (override.previousJson !== null && override.previousJson !== undefined) {
    const restored = await db.titleOverride.create({
      data: {
        imdbId: override.imdbId,
        field: override.field,
        language: override.language,
        region: override.region,
        valueJson: jsonValue(override.previousJson),
        previousJson: jsonValue(override.valueJson),
        reason: input.reason ?? `Rollback de ${override.id}`,
        actorUserId: input.context.actorUserId,
        active: true,
        cacheKey,
      },
    });
    restoredId = restored.id;
  }

  await recordAdminAction({
    context: input.context,
    entityType: "title",
    entityId: override.imdbId,
    action: "override.rollback",
    field: override.field,
    language: override.language,
    region: override.region,
    previousJson: override.valueJson,
    nextJson: override.previousJson ?? null,
    reason: input.reason ?? null,
    cacheKey,
    cacheInvalidated: invalidated > 0,
    metadata: { overrideId: override.id, restoredId, invalidated },
  });

  return { rolledBack: override.id, restoredId, cacheKey, invalidated };
}
