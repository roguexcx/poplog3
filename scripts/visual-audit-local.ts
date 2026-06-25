import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type BrowserFactory = {
  launch: (options?: Record<string, unknown>) => Promise<Browser>;
};

type Browser = {
  newContext: (options?: Record<string, unknown>) => Promise<BrowserContext>;
  close: () => Promise<void>;
};

type BrowserContext = {
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
};

type Page = {
  on: (event: "console" | "pageerror", handler: (...args: unknown[]) => void) => void;
  goto: (url: string, options?: Record<string, unknown>) => Promise<{ status: () => number } | null>;
  textContent: (selector: string) => Promise<string | null>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (options: { path: string; fullPage?: boolean }) => Promise<Buffer>;
  close: () => Promise<void>;
};

type AuditTarget = {
  name: string;
  path: string;
};

type AuditContext = {
  name: string;
  browser: "chromium" | "firefox" | "webkit";
  launchOptions?: Record<string, unknown>;
  contextOptions?: Record<string, unknown>;
  optional?: boolean;
};

type AuditResult = {
  context: string;
  target: string;
  status: "pass" | "fail" | "skip";
  httpStatus?: number | null;
  screenshot?: string;
  errors?: string[];
};

const baseUrl = (process.env.LOCAL_VISUAL_AUDIT_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const outputDir = path.join(process.cwd(), "artifacts", "visual-audit", new Date().toISOString().replace(/[:.]/g, "-"));
const allowMissingPlaywright = process.argv.includes("--allow-missing-playwright");

const targets: AuditTarget[] = [
  { name: "home", path: "/" },
  { name: "search", path: "/buscar?q=superman" },
  { name: "title-movie", path: "/the-wolf-of-wall-street-2013" },
  { name: "title-series", path: "/title/tv/tt0903747" },
  { name: "library", path: "/library" },
  { name: "sorteio", path: "/sorteio" },
  { name: "admin", path: "/admin" },
  { name: "radar-basic", path: "/radar" },
  { name: "og-image", path: "/api/og/title?mediaType=movie&id=tt0993846&language=pt-BR&region=BR" },
];

const contexts: AuditContext[] = [
  { name: "chromium-desktop", browser: "chromium", contextOptions: { viewport: { width: 1440, height: 1000 } } },
  { name: "chromium-wide", browser: "chromium", contextOptions: { viewport: { width: 1920, height: 1080 } } },
  { name: "chromium-small", browser: "chromium", contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "chromium-android", browser: "chromium", contextOptions: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36" } },
  { name: "firefox-desktop", browser: "firefox", contextOptions: { viewport: { width: 1366, height: 900 } } },
  { name: "webkit-desktop", browser: "webkit", contextOptions: { viewport: { width: 1440, height: 1000 } } },
  { name: "webkit-iphone", browser: "webkit", contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" } },
  { name: "edge-channel", browser: "chromium", launchOptions: { channel: "msedge" }, contextOptions: { viewport: { width: 1440, height: 1000 } }, optional: true },
  { name: "chrome-channel", browser: "chromium", launchOptions: { channel: "chrome" }, contextOptions: { viewport: { width: 1440, height: 1000 } }, optional: true },
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fullUrl(target: AuditTarget): string {
  return `${baseUrl}${target.path.startsWith("/") ? "" : "/"}${target.path}`;
}

async function loadPlaywright(): Promise<Record<AuditContext["browser"], BrowserFactory> | null> {
  try {
    return await import("playwright") as Record<AuditContext["browser"], BrowserFactory>;
  } catch {
    return null;
  }
}

async function auditContext(
  playwright: Record<AuditContext["browser"], BrowserFactory>,
  contextDef: AuditContext,
): Promise<AuditResult[]> {
  let browser: Browser | null = null;
  const results: AuditResult[] = [];
  try {
    browser = await playwright[contextDef.browser].launch({ headless: true, ...(contextDef.launchOptions ?? {}) });
  } catch (error) {
    if (contextDef.optional) {
      return targets.map((target) => ({
        context: contextDef.name,
        target: target.name,
        status: "skip",
        errors: [`browser channel indisponivel: ${error instanceof Error ? error.message : String(error)}`],
      }));
    }
    throw error;
  }

  const context = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    ...(contextDef.contextOptions ?? {}),
  });

  for (const target of targets) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message: unknown) => {
      const typed = message as { type?: () => string; text?: () => string };
      if (typed.type?.() === "error") errors.push(typed.text?.() ?? "console error");
    });
    page.on("pageerror", (error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    });

    try {
      const response = await page.goto(fullUrl(target), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(750);
      const httpStatus = response?.status() ?? null;
      const bodyText = target.name === "og-image" ? "image" : (await page.textContent("body").catch(() => "")) ?? "";
      if (httpStatus !== null && httpStatus >= 500) errors.push(`HTTP ${httpStatus}`);
      if (target.name !== "og-image" && bodyText.trim().length < 80) errors.push("pagina com pouco conteudo visivel");
      const screenshot = path.join(outputDir, `${slug(contextDef.name)}__${slug(target.name)}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({
        context: contextDef.name,
        target: target.name,
        status: errors.length ? "fail" : "pass",
        httpStatus,
        screenshot,
        errors: errors.length ? errors : undefined,
      });
    } catch (error) {
      results.push({
        context: contextDef.name,
        target: target.name,
        status: "fail",
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  return results;
}

async function main() {
  const playwright = await loadPlaywright();
  await mkdir(outputDir, { recursive: true });

  if (!playwright) {
    const report = {
      status: "missing_playwright",
      baseUrl,
      note: "Instale Playwright e browsers para executar auditoria visual automatizada.",
    };
    await writeFile(path.join(outputDir, "visual-audit.json"), JSON.stringify(report, null, 2));
    console.log("[audit:visual] Playwright indisponivel", report);
    if (!allowMissingPlaywright) process.exitCode = 1;
    return;
  }

  const health = await fetch(`${baseUrl}/api/debug/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Servidor local indisponivel em ${baseUrl}. Inicie o localhost antes da auditoria visual.`);
  }

  const results: AuditResult[] = [];
  for (const context of contexts) {
    console.log(`[audit:visual] ${context.name}`);
    results.push(...await auditContext(playwright, context));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    outputDir,
    results,
    summary: {
      pass: results.filter((item) => item.status === "pass").length,
      fail: results.filter((item) => item.status === "fail").length,
      skip: results.filter((item) => item.status === "skip").length,
    },
    realDeviceGap: [
      "Safari real em macOS/iOS precisa ser validado em aparelho ou serviço externo.",
      "Android/iPhone físicos precisam de rodada manual ou device farm antes de produção.",
    ],
  };

  await writeFile(path.join(outputDir, "visual-audit.json"), JSON.stringify(report, null, 2));
  console.table(results.map(({ context, target, status, httpStatus }) => ({ context, target, status, httpStatus })));
  console.log("[audit:visual] report", path.join(outputDir, "visual-audit.json"));
  if (report.summary.fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[audit:visual] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
