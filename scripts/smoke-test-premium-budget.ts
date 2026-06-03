/**
 * Smoke test para o fluxo de reserva/conclusao de budget premium via premium-api-budget.ts.
 *
 * Testa com POPLOG_LOCAL_API_USAGE_ENABLED=true para validar o roteamento local.
 * Nao requer Supabase configurado.
 *
 * Uso:
 *   tsx -r tsconfig-paths/register scripts/smoke-test-premium-budget.ts
 */

// Forca flag local antes de qualquer import que leia process.env
process.env.POPLOG_LOCAL_API_USAGE_ENABLED = "true";

import { db } from "@/server/db/client";
import {
  completePremiumApiBudget,
  reservePremiumApiBudget,
} from "@/server/rate-limits/premium-api-budget";
import { deletePremiumApiUsage } from "@/server/repositories/premium-api-usage.repository";

const smokeIds: string[] = [];

async function assertOk(label: string, cond: boolean) {
  if (!cond) throw new Error(`${label} failed`);
  console.log(`[smoke:budget] ${label}: ok`);
}

async function main() {
  // Sanidade: flag esta ligada
  const { isLocalApiUsageEnabled } = await import("@/server/runtime/local-db-flags");
  await assertOk("flag POPLOG_LOCAL_API_USAGE_ENABLED=true lida", isLocalApiUsageEnabled());

  // --- reserve success ---
  const reserveSuccess = await reservePremiumApiBudget("omdb", {
    endpoint: "/smoke-test-budget",
    tmdbId: 987655099,
    mediaType: "movie",
    action: "smoke_test",
    reason: "smoke-test-reserve-success",
  });
  await assertOk("reserve success: ok=true", reserveSuccess.ok === true);
  if (!reserveSuccess.ok) throw new Error("reserve success returned ok=false");
  await assertOk("reserve success: reservation.id nao nulo", reserveSuccess.reservation.id !== null);
  await assertOk("reserve success: api=omdb", reserveSuccess.reservation.api === "omdb");
  await assertOk("reserve success: dailyUsed >= 1", reserveSuccess.reservation.dailyUsed >= 1);
  if (reserveSuccess.reservation.id) smokeIds.push(reserveSuccess.reservation.id);

  // --- complete success ---
  await completePremiumApiBudget(reserveSuccess.reservation, "success");
  console.log("[smoke:budget] complete success: ok");

  // --- reserve + complete failed ---
  const reserveFailed = await reservePremiumApiBudget("omdb", {
    endpoint: "/smoke-test-budget",
    tmdbId: 987655099,
    mediaType: "movie",
    action: "smoke_test",
    reason: "smoke-test-reserve-failed",
  });
  await assertOk("reserve failed path: ok=true", reserveFailed.ok === true);
  if (!reserveFailed.ok) throw new Error("reserve failed path returned ok=false");
  if (reserveFailed.reservation.id) smokeIds.push(reserveFailed.reservation.id);
  await completePremiumApiBudget(reserveFailed.reservation, "failed", "smoke-test-simulated-error");
  console.log("[smoke:budget] complete failed: ok");

  // --- reserve + complete empty ---
  const reserveEmpty = await reservePremiumApiBudget("watchmode", {
    endpoint: "/smoke-test-budget",
    tmdbId: 987655099,
    mediaType: "movie",
    action: "smoke_test",
    reason: "smoke-test-reserve-empty",
  });
  await assertOk("reserve empty path: ok=true", reserveEmpty.ok === true);
  if (!reserveEmpty.ok) throw new Error("reserve empty path returned ok=false");
  if (reserveEmpty.reservation.id) smokeIds.push(reserveEmpty.reservation.id);
  await completePremiumApiBudget(reserveEmpty.reservation, "empty", "Response=False");
  console.log("[smoke:budget] complete empty: ok");

  // --- completePremiumApiBudget com reservation null nao lanca erro ---
  await completePremiumApiBudget(null, "success");
  console.log("[smoke:budget] complete null reservation: ok (noop)");

  // --- cleanup ---
  for (const id of smokeIds) {
    await deletePremiumApiUsage(id);
  }
  // Limpa quaisquer registros blocked do smoke que possam ter sido criados
  await db.poplog3PremiumApiUsage.deleteMany({
    where: {
      action: "smoke_test",
      tmdbId: 987655099,
    },
  });
  console.log("[smoke:budget] cleanup: ok");

  console.log("[smoke:budget] premium budget smoke completed (local path)");
}

main().catch((error) => {
  console.error("[smoke:budget] premium budget smoke failed", error);
  process.exitCode = 1;
});
