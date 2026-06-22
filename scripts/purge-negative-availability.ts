/**
 * Purga as sentinelas negativas (`__none__`) de catalog_availability.
 *
 * Use quando providers estiverem sendo escondidos por cache negativo stale
 * (ex.: inconsistência BR da API que gravou "sem providers" para títulos que existem).
 * Os títulos re-resolvem na próxima carga da Biblioteca.
 *
 * Run: npx tsx -r tsconfig-paths/register -r dotenv/config scripts/purge-negative-availability.ts dotenv_config_path=.env.local
 */

import { db } from "@/server/db/client";

async function main() {
  const before = await db.catalogAvailability.count({ where: { providerName: "__none__" } });
  const res = await db.catalogAvailability.deleteMany({ where: { providerName: "__none__" } });
  console.log(`[purge-negative-availability] sentinelas __none__ removidas: ${res.count} (havia ${before})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[purge-negative-availability] FAILED", err);
    process.exit(1);
  });
