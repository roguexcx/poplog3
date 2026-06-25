import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type Finding = {
  kind: "forbidden_runtime_client" | "legacy_reference" | "direct_external_call";
  file: string;
  line: number;
  text: string;
};

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "storage"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sql", ".prisma"]);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      files.push(...await walk(path.join(dir, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    if (TEXT_EXTENSIONS.has(path.extname(filePath))) files.push(filePath);
  }
  return files;
}

function rel(file: string) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

async function inspectFile(file: string): Promise<Finding[]> {
  if ((await stat(file)).size > 2_000_000) return [];
  const relative = rel(file);
  const content = await readFile(file, "utf8").catch(() => "");
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((text, index) => {
    const line = index + 1;
    const lower = text.toLowerCase();
    if (
      relative.startsWith("src/") &&
      /server\/api-clients\/(omdb|tvdb)|api4\.thetvdb\.com|omdbapi\.com/.test(lower)
    ) {
      findings.push({ kind: "forbidden_runtime_client", file: relative, line, text: text.trim() });
      return;
    }
    if (/(omdb|thetvdb|tvdb)/i.test(text)) {
      findings.push({ kind: "legacy_reference", file: relative, line, text: text.trim() });
    }
    if (
      relative.startsWith("src/app/") &&
      /traktGet|fetchBalloonerismm|fetch\(\s*["']https?:|graphql/i.test(text) &&
      !relative.includes("/api/")
    ) {
      findings.push({ kind: "direct_external_call", file: relative, line, text: text.trim() });
    }
  });

  return findings;
}

async function main() {
  const allFindings = (await Promise.all((await walk(ROOT)).map(inspectFile))).flat();
  const forbidden = allFindings.filter((finding) => finding.kind === "forbidden_runtime_client");
  const direct = allFindings.filter((finding) => finding.kind === "direct_external_call");
  const legacy = allFindings.filter((finding) => finding.kind === "legacy_reference");

  console.log("[audit-poplog-v2] forbidden runtime clients:", forbidden.length);
  console.log("[audit-poplog-v2] direct external calls outside API routes:", direct.length);
  console.log("[audit-poplog-v2] legacy metadata/doc references:", legacy.length);

  if (forbidden.length > 0 || direct.length > 0) {
    for (const finding of [...forbidden, ...direct].slice(0, 60)) {
      console.log(`${finding.kind} ${finding.file}:${finding.line} ${finding.text}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[audit-poplog-v2] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
