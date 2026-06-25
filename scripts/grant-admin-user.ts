import "dotenv/config";

import { db } from "@/server/db/client";

const DEFAULT_ADMIN_PERMISSIONS = [
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
];

function emailArg(): string {
  const explicit = process.argv.find((arg) => arg.startsWith("--email="))?.split("=")[1]?.trim();
  const positional = process.argv.find((arg) => arg.includes("@"))?.trim();
  return (explicit || positional || "psatheler@gmail.com").toLowerCase();
}

async function main() {
  const email = emailArg();
  const now = new Date();

  const user = await db.user.upsert({
    where: { email },
    update: {
      role: "admin",
      accessStatus: "active",
      blockedAt: null,
      blockedReason: null,
      adminPermissions: DEFAULT_ADMIN_PERMISSIONS,
      lastAdminActionAt: now,
    },
    create: {
      email,
      name: email.split("@")[0],
      role: "admin",
      accessStatus: "active",
      adminPermissions: DEFAULT_ADMIN_PERMISSIONS,
      lastAdminActionAt: now,
    },
    select: {
      id: true,
      email: true,
      role: true,
      accessStatus: true,
      adminPermissions: true,
    },
  });

  await db.adminActionLog.create({
    data: {
      actorUserId: process.env.ADMIN_MASTER_USER_ID ?? "local-script",
      entityType: "user",
      entityId: user.id,
      action: "user.grant_admin",
      nextJson: user,
      reason: "Grant admin access from local maintenance script.",
      metadata: { email },
    },
  }).catch(() => null);

  console.log("[grant-admin-user] ok", user);
}

main()
  .catch((error) => {
    console.error("[grant-admin-user] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
