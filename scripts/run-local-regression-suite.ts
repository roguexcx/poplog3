import "dotenv/config";

import { spawn } from "node:child_process";

type Step = {
  name: string;
  command: string;
  args: string[];
  optional?: boolean;
  when?: () => boolean;
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const baseUrl = process.env.LOCAL_REGRESSION_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const skipHttp = process.argv.includes("--skip-http");
const destructiveReset = process.argv.includes("--destructive-reset");

function npmRun(script: string, extraArgs: string[] = []): Step {
  return {
    name: script,
    command: npmCmd,
    args: ["run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])],
  };
}

function windowsCommand(step: Step): { command: string; args: string[] } {
  const commandLine = [step.command, ...step.args]
    .map((arg) => (/[\s&()^|<>"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
}

function runStep(step: Step): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    console.log(`\n[regression:local] ▶ ${step.name}`);
    const command = process.platform === "win32" ? windowsCommand(step) : { command: step.command, args: step.args };
    const child = spawn(command.command, command.args, {
      stdio: "inherit",
      env: {
        ...process.env,
        LOCAL_REGRESSION_BASE_URL: baseUrl,
        NEXT_PUBLIC_BASE_URL: baseUrl,
        POPLOG_SEO_SMOKE_BASE_URL: baseUrl,
        POPLOG_LOCAL_AUTH_ENABLED: process.env.POPLOG_LOCAL_AUTH_ENABLED ?? "true",
        LOCAL_USER_ID: process.env.LOCAL_USER_ID ?? "local-user",
      },
      shell: false,
    });
    child.on("close", (code) => resolve({ ok: code === 0, code }));
  });
}

async function main() {
  const steps: Step[] = [
    npmRun("db:seed"),
    destructiveReset ? npmRun("db:reset:catalog") : npmRun("db:reset:catalog:dry"),
    npmRun("sorteio:seed-minimum"),
    npmRun("db:smoke:sorteio-minimum-pool"),
    npmRun("db:smoke:sorteio-local-draw"),
    npmRun("db:smoke:library-state"),
    npmRun("smoke:library-identity"),
    npmRun("db:smoke:episode-progress"),
    npmRun("db:smoke:admin-user-access"),
    npmRun("smoke:providers:commercial-fixtures"),
    npmRun("smoke:provider-normalization"),
    npmRun("db:smoke:availability"),
    npmRun("smoke:availability-stale"),
    npmRun("smoke:assets-local"),
    npmRun("smoke:cold-series"),
    npmRun("db:smoke:refresh-queue"),
    npmRun("workers:cron:smoke"),
    npmRun("cache:smoke:redis"),
    npmRun("audit:i18n", ["--fail-on-hardcoded"]),
    npmRun("smoke:ads-placement"),
    npmRun("smoke:seo:title"),
    npmRun("smoke:local-http"),
    npmRun("perf:local"),
  ].map((step) =>
    ["smoke:seo:title", "smoke:local-http", "perf:local"].includes(step.name)
      ? { ...step, when: () => !skipHttp }
      : step,
  );

  const results: Array<{ name: string; ok: boolean; code: number | null; skipped?: boolean }> = [];
  for (const step of steps) {
    if (step.when && !step.when()) {
      console.log(`[regression:local] ○ ${step.name} pulado por flag`);
      results.push({ name: step.name, ok: true, code: 0, skipped: true });
      continue;
    }
    const result = await runStep(step);
    results.push({ name: step.name, ...result });
    if (!result.ok && !step.optional) break;
  }

  console.log("\n[regression:local] resumo");
  console.table(results);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
    console.error("[regression:local] falhou", failed.map((item) => item.name).join(", "));
    return;
  }

  console.log("[regression:local] ok", {
    steps: results.length,
    destructiveReset,
    http: !skipHttp,
    baseUrl,
  });
}

main().catch((error) => {
  console.error("[regression:local] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
