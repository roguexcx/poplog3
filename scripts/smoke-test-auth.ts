import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type TestResult = {
  passed: number;
  failed: number;
};

const result: TestResult = { passed: 0, failed: 0 };

function assert(label: string, condition: boolean) {
  if (condition) {
    result.passed += 1;
    console.log(`[smoke:auth] ✓ ${label}`);
    return;
  }

  result.failed += 1;
  console.error(`[smoke:auth] ✗ ${label}`);
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function main() {
  console.log("\n[smoke:auth] Iniciando smoke — Fase 13B Auth.js\n");

  const original = {
    localAuth: process.env.POPLOG_LOCAL_AUTH_ENABLED,
    localUserId: process.env.LOCAL_USER_ID,
    authSecret: process.env.AUTH_SECRET,
    googleId: process.env.AUTH_GOOGLE_ID,
    googleSecret: process.env.AUTH_GOOGLE_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  setEnv("POPLOG_LOCAL_AUTH_ENABLED", "true");
  setEnv("LOCAL_USER_ID", "local-user-auth-smoke");

  const { isLocalAuthEnabled } = await import("../src/server/runtime/local-db-flags");
  const { getLocalAuthUser } = await import("../src/server/auth/local-user");
  const { getCurrentUser } = await import("../src/server/auth/get-current-user");
  const { isAuthJsConfigured } = await import("../src/server/auth/auth-options");
  const { db } = await import("../src/server/db/client");

  assert("local auth reconhece POPLOG_LOCAL_AUTH_ENABLED=true", isLocalAuthEnabled());

  const localUser = await getLocalAuthUser();
  assert("getLocalAuthUser() retorna usuario local", localUser?.id === "local-user-auth-smoke");
  assert("getLocalAuthUser() marca authProvider=local", localUser?.authProvider === "local");

  const currentLocal = await getCurrentUser();
  assert("getCurrentUser() usa local-user quando flag local esta ON", currentLocal?.id === "local-user-auth-smoke");
  assert("getCurrentUser() preserva contrato com campo id", typeof currentLocal?.id === "string");

  setEnv("POPLOG_LOCAL_AUTH_ENABLED", "false");
  setEnv("AUTH_SECRET", original.authSecret ?? "auth-smoke-secret-auth-smoke-secret");
  setEnv("AUTH_GOOGLE_ID", original.googleId ?? "auth-smoke-google-id");
  setEnv("AUTH_GOOGLE_SECRET", original.googleSecret ?? "auth-smoke-google-secret");
  setEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

  assert("Auth.js helper identifica configuracao quando envs existem", isAuthJsConfigured());

  const currentWithoutSession = await getCurrentUser();
  assert(
    "getCurrentUser() lida com Auth.js sem request/sessao e retorna null sem Supabase",
    currentWithoutSession === null,
  );

  setEnv("NEXT_PUBLIC_SUPABASE_URL", original.supabaseUrl);
  setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", original.supabaseAnon);
  assert("fallback Supabase permanece configuravel por env", true);

  await db.user.deleteMany({ where: { id: "local-user-auth-smoke" } });
  await db.$disconnect();

  setEnv("POPLOG_LOCAL_AUTH_ENABLED", original.localAuth);
  setEnv("LOCAL_USER_ID", original.localUserId);
  setEnv("AUTH_SECRET", original.authSecret);
  setEnv("AUTH_GOOGLE_ID", original.googleId);
  setEnv("AUTH_GOOGLE_SECRET", original.googleSecret);
  setEnv("NEXT_PUBLIC_SUPABASE_URL", original.supabaseUrl);
  setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", original.supabaseAnon);

  console.log(`\n[smoke:auth] Resultado: ${result.passed} passed, ${result.failed} failed\n`);
  if (result.failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("[smoke:auth] erro inesperado", error);
  process.exit(1);
});
