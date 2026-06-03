/**
 * Smoke test: Fase 11 — Export/Import
 *
 * Valida:
 *   1. db:export gera arquivo JSON válido
 *   2. JSON tem campos obrigatórios (schemaVersion, exportedAt, app, tables, counts)
 *   3. counts bate com tamanhos reais das arrays de tabelas
 *   4. BigInt de catalog_availability serializado como string
 *   5. db:import --dry-run executa sem erros
 *   6. db:import em modo seguro (skipDuplicates) não gera erros com dados já existentes
 *
 * Não modifica dados permanentes.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:export-import] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:export-import] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const isWindows = process.platform === "win32";

function runScript(script: string, extraArgs: string[] = []): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  // No Windows, npx é um .cmd e precisa de cmd.exe para executar.
  // Usar "cmd /c npx tsx ..." evita shell:true e o aviso de deprecação do Node.
  const [bin, args] = isWindows
    ? (["cmd", ["/c", "npx", "tsx", script, ...extraArgs]] as const)
    : (["npx", ["tsx", script, ...extraArgs]] as const);

  const result = spawnSync(bin, [...args], {
    encoding: "utf-8",
    cwd: path.resolve("."),
    env: { ...process.env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

function testExportRun(): string | null {
  console.log("\n[smoke:export-import] Executando db:export...");
  const result = runScript("scripts/db/export-local-data.ts");

  assert("db:export termina com exit 0", result.status === 0, `exit: ${result.status}`);
  assert(
    "db:export imprime 'Exportação concluída'",
    result.stdout.includes("Exportação concluída"),
    result.stdout.slice(-200),
  );

  // Extrair caminho do arquivo da saída
  const match = result.stdout.match(/Arquivo\s*:\s*(.+\.json)/);
  if (!match) {
    assert("db:export imprime o caminho do arquivo", false, result.stdout.slice(-300));
    return null;
  }

  const filePath = match[1].trim();
  assert("db:export: arquivo existe no disco", fs.existsSync(filePath), filePath);
  return filePath;
}

interface ExportPayload {
  schemaVersion: string;
  exportedAt: string;
  app: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

function testExportFormat(filePath: string): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  let payload: ExportPayload;
  try {
    payload = JSON.parse(raw) as ExportPayload;
  } catch (e) {
    assert("export JSON é válido", false, String(e));
    return;
  }

  assert("export JSON é válido", true);
  assert("campo 'schemaVersion' presente", payload.schemaVersion !== undefined);
  assert("campo 'schemaVersion' = '1'", payload.schemaVersion === "1", payload.schemaVersion);
  assert("campo 'exportedAt' presente", typeof payload.exportedAt === "string");
  assert("campo 'exportedAt' é ISO 8601", /^\d{4}-\d{2}-\d{2}T/.test(payload.exportedAt));
  assert("campo 'app' = 'poplog-v3'", payload.app === "poplog-v3", payload.app);
  assert("campo 'tables' presente", typeof payload.tables === "object");
  assert("campo 'counts' presente", typeof payload.counts === "object");

  // Tabelas obrigatórias
  const required = [
    "users",
    "accounts",
    "sessions",
    "verification_tokens",
    "user_titles",
    "user_title_state",
    "user_episodes",
    "user_ratings",
    "user_title_feedback",
    "user_events",
    "user_curadoria_preferences",
    "user_curadoria_signals",
    "user_curadoria_state",
    "user_streaming_preferences",
    "poplog3_titles",
    "poplog3_episodes",
    "title_seasons",
    "title_external_ids",
    "title_ratings",
    "streaming_providers",
    "catalog_availability",
    "continuity_section_cache",
    "ics_agenda_cache",
  ];

  for (const t of required) {
    assert(
      `tabela '${t}' presente no export`,
      t in payload.tables,
    );
    assert(
      `count de '${t}' bate com tamanho do array`,
      payload.counts[t] === (payload.tables[t]?.length ?? -1),
      `count=${payload.counts[t]} length=${payload.tables[t]?.length}`,
    );
  }

  // BigInt: catalog_availability.id deve ser string no JSON (não number)
  const catalogRows = payload.tables.catalog_availability ?? [];
  if (catalogRows.length > 0) {
    const firstId = (catalogRows[0] as Record<string, unknown>).id;
    assert(
      "catalog_availability.id serializado como string (BigInt)",
      typeof firstId === "string",
      `type: ${typeof firstId}, value: ${String(firstId)}`,
    );
  } else {
    console.log("[smoke:export-import]   catalog_availability vazia — skip BigInt check");
  }
}

function testImportDryRun(filePath: string): void {
  console.log("\n[smoke:export-import] Executando db:import --dry-run...");
  const result = runScript("scripts/db/import-local-data.ts", [
    "--file",
    filePath,
    "--dry-run",
  ]);

  assert(
    "db:import --dry-run termina com exit 0",
    result.status === 0,
    `exit: ${result.status}\nstderr: ${result.stderr.slice(0, 300)}`,
  );
  assert(
    "db:import --dry-run imprime 'dry-run'",
    result.stdout.toLowerCase().includes("dry-run"),
    result.stdout.slice(-200),
  );
  assert(
    "db:import --dry-run não altera dados (sem linha 'inseridos')",
    !result.stdout.includes("rows inseridos"),
    result.stdout.slice(-200),
  );
}

function testImportSafe(filePath: string): void {
  console.log("\n[smoke:export-import] Executando db:import (modo seguro)...");
  const result = runScript("scripts/db/import-local-data.ts", ["--file", filePath]);

  assert(
    "db:import seguro termina com exit 0",
    result.status === 0,
    `exit: ${result.status}\nstderr: ${result.stderr.slice(0, 300)}`,
  );
  assert(
    "db:import seguro imprime 'Import concluído'",
    result.stdout.includes("Import concluído"),
    result.stdout.slice(-200),
  );
  // Deve mencionar skipDuplicates / já existiam (dados já estão no DB)
  assert(
    "db:import seguro reporta rows (já existiam ou inseridos)",
    result.stdout.includes("já existiam") || result.stdout.includes("inseridos"),
    result.stdout.slice(-300),
  );
}

function testImportReplaceWithoutYesFails(): void {
  console.log("\n[smoke:export-import] Validando proteção de --replace sem --yes...");
  const latest = findLatestExport();
  if (!latest) {
    console.log("[smoke:export-import]   Sem export — skip");
    return;
  }

  const result = runScript("scripts/db/import-local-data.ts", [
    "--file",
    latest,
    "--replace",
    // Sem --yes
  ]);

  assert(
    "db:import --replace sem --yes falha com exit != 0",
    result.status !== 0,
    `exit: ${result.status}`,
  );
  assert(
    "db:import --replace sem --yes imprime mensagem de proteção",
    result.stderr.includes("--yes") || result.stdout.includes("--yes"),
    result.stderr.slice(0, 200),
  );
}

function findLatestExport(): string | null {
  const dir = path.resolve("exports");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("poplog-export-") && f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n[smoke:export-import] Iniciando smoke — Fase 11 Export/Import\n");

  const filePath = testExportRun();
  if (!filePath) {
    console.error("[smoke:export-import] Export falhou — abortando restante.\n");
    process.exitCode = 1;
    return;
  }

  testExportFormat(filePath);
  testImportDryRun(filePath);
  testImportSafe(filePath);
  testImportReplaceWithoutYesFails();

  console.log(
    `\n[smoke:export-import] Resultado: ${passed} passed, ${failed} failed\n`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[smoke:export-import] Erro fatal:", err);
  process.exitCode = 1;
});
