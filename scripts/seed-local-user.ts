import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";

  await prisma.user.upsert({
    where: { id: localUserId },
    update: {
      updatedAt: new Date(),
    },
    create: {
      id: localUserId,
      email: "local@poplog.dev",
      name: "POPLOG Local User",
    },
  });

  console.log(`[seed] Local user ready: ${localUserId}`);
}

main()
  .catch((error) => {
    console.error("[seed] Failed to seed local user", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
