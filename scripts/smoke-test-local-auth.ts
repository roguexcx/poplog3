/**
 * Smoke test: Fase 8 — Auth local
 *
 * Valida a resolução de usuário local via POPLOG_LOCAL_AUTH_ENABLED.
 * Não depende de Supabase. Limpa o usuário de smoke ao final.
 */
import "dotenv/config";
import { db } from "@/server/db/client";

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:local-auth] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:local-auth] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertValue<T>(label: string, value: T | null | undefined): void {
  assert(label, value !== null && value !== undefined, `got ${String(value)}`);
}

// ── Importar helpers do auth local ────────────────────────────────────────────

import { getLocalUserId, getLocalAuthUser } from "@/server/auth/local-user";
import { isLocalAuthEnabled } from "@/server/runtime/local-db-flags";

// ── Setup ─────────────────────────────────────────────────────────────────────

// Usuário de smoke separado para não contaminar o local-user de dev
const SMOKE_SUFFIX = "-auth-smoke";
const BASE_ID = process.env.LOCAL_USER_ID?.trim() || "local-user";
const SMOKE_USER_ID = `${BASE_ID}${SMOKE_SUFFIX}`;

async function cleanup() {
  await db.user.deleteMany({ where: { id: { endsWith: SMOKE_SUFFIX } } });
}

// ── Testes ────────────────────────────────────────────────────────────────────

async function testFlagEnabled() {
  const orig = process.env.POPLOG_LOCAL_AUTH_ENABLED;

  process.env.POPLOG_LOCAL_AUTH_ENABLED = "true";
  assert("flag POPLOG_LOCAL_AUTH_ENABLED=true é reconhecida", isLocalAuthEnabled());

  process.env.POPLOG_LOCAL_AUTH_ENABLED = "false";
  assert("flag POPLOG_LOCAL_AUTH_ENABLED=false é reconhecida", !isLocalAuthEnabled());

  // Restaurar
  process.env.POPLOG_LOCAL_AUTH_ENABLED = orig ?? "false";
}

async function testGetLocalUserId() {
  const orig = process.env.LOCAL_USER_ID;

  process.env.LOCAL_USER_ID = "meu-user-teste";
  assert(
    "getLocalUserId() lê LOCAL_USER_ID do env",
    getLocalUserId() === "meu-user-teste",
    `got: ${getLocalUserId()}`,
  );

  delete process.env.LOCAL_USER_ID;
  assert(
    "getLocalUserId() usa 'local-user' como fallback quando LOCAL_USER_ID não definido",
    getLocalUserId() === "local-user",
    `got: ${getLocalUserId()}`,
  );

  process.env.LOCAL_USER_ID = orig ?? BASE_ID;
}

async function testResolveExistingUser() {
  // Garantir que o usuário de smoke existe
  await db.user.upsert({
    where: { id: SMOKE_USER_ID },
    update: { updatedAt: new Date() },
    create: { id: SMOKE_USER_ID, email: "auth-smoke@poplog.dev", name: "Auth Smoke" },
  });

  const origId = process.env.LOCAL_USER_ID;
  process.env.LOCAL_USER_ID = SMOKE_USER_ID;

  const user = await getLocalAuthUser();
  assertValue("getLocalAuthUser() retorna usuário existente", user);
  assert(
    "getLocalAuthUser() retorna id correto",
    user?.id === SMOKE_USER_ID,
    `got: ${user?.id}`,
  );

  process.env.LOCAL_USER_ID = origId ?? BASE_ID;
}

async function testAutoCreateUser() {
  const autoId = `auto-create-${Date.now()}${SMOKE_SUFFIX}`;

  // Garantir que não existe
  await db.user.deleteMany({ where: { id: autoId } });

  const origId = process.env.LOCAL_USER_ID;
  process.env.LOCAL_USER_ID = autoId;

  const user = await getLocalAuthUser();
  assertValue("getLocalAuthUser() cria usuário automaticamente quando ausente", user);
  assert(
    "getLocalAuthUser() retorna id correto após autocriação",
    user?.id === autoId,
    `got: ${user?.id}`,
  );

  const inDb = await db.user.findUnique({ where: { id: autoId } });
  assert("usuário autocriado existe no banco", !!inDb, `id: ${autoId}`);

  process.env.LOCAL_USER_ID = origId ?? BASE_ID;
}

async function testSafeWithEmptyLocalUserId() {
  const origId = process.env.LOCAL_USER_ID;

  // Simular LOCAL_USER_ID em branco — deve usar fallback "local-user"
  process.env.LOCAL_USER_ID = "   ";
  const id = getLocalUserId();
  assert(
    "getLocalUserId() usa fallback 'local-user' quando LOCAL_USER_ID está em branco",
    id === "local-user",
    `got: "${id}"`,
  );

  process.env.LOCAL_USER_ID = origId ?? BASE_ID;
}

async function testFlagDisabledDoesNotBreakSupabasePath() {
  // Com a flag desligada, getCurrentUser() NÃO deve chamar getLocalAuthUser()
  // Verificamos que isLocalAuthEnabled() retorna false no env padrão
  const orig = process.env.POPLOG_LOCAL_AUTH_ENABLED;
  process.env.POPLOG_LOCAL_AUTH_ENABLED = "false";

  assert(
    "com flag desligada, isLocalAuthEnabled() retorna false (caminho Supabase preservado)",
    !isLocalAuthEnabled(),
  );

  process.env.POPLOG_LOCAL_AUTH_ENABLED = orig ?? "false";
}

async function testLocalUserCompatibility() {
  // O retorno de getLocalAuthUser() deve ter campo .id compatível com user.id nos endpoints
  const origId = process.env.LOCAL_USER_ID;
  process.env.LOCAL_USER_ID = SMOKE_USER_ID;

  const user = await getLocalAuthUser();
  assert("retorno tem campo 'id'", typeof user?.id === "string", `type: ${typeof user?.id}`);
  assert(
    "campo 'id' é string não vazia",
    (user?.id?.length ?? 0) > 0,
    `id: "${user?.id}"`,
  );

  process.env.LOCAL_USER_ID = origId ?? BASE_ID;
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n[smoke:local-auth] Iniciando smoke test — Fase 8 Auth Local\n");

  try {
    await testFlagEnabled();
    await testGetLocalUserId();
    await testSafeWithEmptyLocalUserId();
    await testFlagDisabledDoesNotBreakSupabasePath();
    await testResolveExistingUser();
    await testAutoCreateUser();
    await testLocalUserCompatibility();
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\n[smoke:local-auth] Resultado: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[smoke:local-auth] Erro fatal:", err);
  process.exitCode = 1;
});
