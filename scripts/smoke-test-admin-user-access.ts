import { db } from "@/server/db/client";
import {
  adminContextFromRequest,
  assertAdminPermission,
  recordAdminAction,
} from "@/server/admin/admin-actions";

const USER_ID = "smoke-admin-user-access";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  console.log(`[smoke:admin-user-access] ${message}: ok`);
}

async function run() {
  await db.adminActionLog.deleteMany({ where: { entityId: USER_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });

  await db.user.create({
    data: {
      id: USER_ID,
      email: `${USER_ID}@poplog.dev`,
      name: "Admin User Access Smoke",
    },
  });

  const context = await adminContextFromRequest(new Request("http://localhost", {
    headers: {
      "x-admin-user-id": process.env.ADMIN_MASTER_USER_ID || "admin-secret",
      "x-admin-permissions": "*",
    },
  }));
  assertAdminPermission(context, "user:write");

  const before = await db.user.findUniqueOrThrow({ where: { id: USER_ID } });
  const blocked = await db.user.update({
    where: { id: USER_ID },
    data: {
      accessStatus: "blocked",
      blockedAt: new Date(),
      blockedReason: "Smoke bloqueio",
      lastAdminActionAt: new Date(),
    },
  });
  await recordAdminAction({
    context,
    entityType: "user",
    entityId: USER_ID,
    action: "user.block",
    previousJson: before,
    nextJson: blocked,
    reason: "Smoke bloqueio",
  });

  assert(blocked.accessStatus === "blocked", "bloqueio persistido");

  const promoted = await db.user.update({
    where: { id: USER_ID },
    data: {
      role: "admin",
      adminPermissions: ["catalog:read", "user:read"],
      accessStatus: "active",
      blockedAt: null,
      blockedReason: null,
      lastAdminActionAt: new Date(),
    },
  });
  await recordAdminAction({
    context,
    entityType: "user",
    entityId: USER_ID,
    action: "user.reactivate+role",
    previousJson: blocked,
    nextJson: promoted,
    reason: "Smoke reativação e role",
  });

  assert(promoted.accessStatus === "active", "reativação persistida");
  assert(promoted.role === "admin", "role admin persistida");

  const logs = await db.adminActionLog.count({ where: { entityId: USER_ID } });
  assert(logs >= 2, "auditoria gerada");

  await db.adminActionLog.deleteMany({ where: { entityId: USER_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });
  await db.$disconnect();
}

run().catch(async (error) => {
  console.error("[smoke:admin-user-access] FAILED", error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
