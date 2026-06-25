import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

type Hit = {
  file: string;
  line: number;
  text: string;
};

const ROOTS = ["src/app", "src/components", "src/features"];
const HARD_CODED_HINT =
  /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]|(?:\b(?:Carregar|Buscar|Voltar|Assistir|Assistido|Temporada|Episódio|Título|Usuários|Catálogo|Biblioteca|Sorteio|Radar|Provedores|Permissões|Salvar|Reverter|Atualizar|Entrar|Idioma|Região|Próxim|Histórico|Favoritos|Preferências|Comentários|Sinopse)\b)/;
const USER_FACING_PROPS = new Set([
  "aria-label",
  "aria-description",
  "alt",
  "caption",
  "copy",
  "cta",
  "description",
  "emptyMessage",
  "emptyTitle",
  "eyebrow",
  "heading",
  "helperText",
  "hint",
  "label",
  "message",
  "name",
  "placeholder",
  "subheading",
  "subtitle",
  "text",
  "title",
  "tooltip",
]);
const TECHNICAL_VALUE =
  /^(?:use client|GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS|movie|show|tv|all|none|idle|loading|success|error|warning|info|primary|secondary|subscription|rent|buy|cinema|free|BR|US|pt-BR|en-US)$/i;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...walk(full));
    } else if (
      entry.name.endsWith(".tsx") ||
      (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
    ) {
      files.push(full);
    }
  }
  return files;
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasHardcodedText(text: string): boolean {
  const clean = normalizedText(text);
  if (!clean || clean.length === 1) return false;
  if (/^[A-Z0-9_:-]+$/.test(clean)) return false;
  return HARD_CODED_HINT.test(clean);
}

function hasUserFacingText(text: string): boolean {
  const clean = normalizedText(text);
  if (!clean || clean.length === 1) return false;
  if (TECHNICAL_VALUE.test(clean)) return false;
  if (/^[\w./:@#?&=%{}[\](),-]+$/.test(clean) && !/\s/.test(clean)) return false;
  return /[A-Za-zÀ-ÿ]/.test(clean);
}

function nodeNameText(name: ts.PropertyName | ts.JsxAttributeName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText();
}

function isUserFacingProperty(name: ts.PropertyName | ts.JsxAttributeName): boolean {
  return USER_FACING_PROPS.has(nodeNameText(name));
}

function isUiMessageCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && current.expression.getText() === "uiMessage") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function shouldSkipString(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  if (isUiMessageCall(node)) return true;
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAccessExpression(parent)) return true;
  if (ts.isJsxAttribute(parent)) return false;
  return false;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function auditFile(file: string): Hit[] {
  const sourceText = fs.readFileSync(file, "utf8");

  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relative = path.relative(process.cwd(), file).replace(/\\/g, "/");
  const hits: Hit[] = [];

  function add(node: ts.Node, text: string) {
    hits.push({
      file: relative,
      line: lineOf(source, node),
      text: normalizedText(text).slice(0, 180),
    });
  }

  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const text = node.initializer.text;
      if ((isUserFacingProperty(node.name) ? hasUserFacingText(text) : hasHardcodedText(text))) {
        add(node.initializer, text);
      }
      return;
    }

    if (
      ts.isPropertyAssignment(node) &&
      isUserFacingProperty(node.name) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      !isUiMessageCall(node.initializer)
    ) {
      if (hasUserFacingText(node.initializer.text)) add(node.initializer, node.initializer.text);
      return;
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !shouldSkipString(node)) {
      if (hasHardcodedText(node.text)) add(node, node.text);
      return;
    }

    if (ts.isTemplateExpression(node)) {
      const text = node.head.text +
        node.templateSpans
          .map((span, index) => `{v${index + 1}}${span.literal.text}`)
          .join("");
      const parent = node.parent;
      const visibleProperty =
        ts.isPropertyAssignment(parent) && isUserFacingProperty(parent.name);
      const visibleAttribute =
        ts.isJsxExpression(parent) &&
        ts.isJsxAttribute(parent.parent) &&
        isUserFacingProperty(parent.parent.name);
      if (!isUiMessageCall(node) && ((visibleProperty || visibleAttribute) ? hasUserFacingText(text) : hasHardcodedText(text))) {
        add(node, text);
      }
      return;
    }

    if (ts.isJsxText(node)) {
      const text = normalizedText(node.getFullText(source));
      if (hasUserFacingText(text)) add(node, text);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return hits;
}

function main() {
  const hits = ROOTS
    .flatMap((root) => walk(path.join(process.cwd(), root)))
    .flatMap(auditFile);
  const byFile = new Map<string, number>();
  for (const hit of hits) byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);

  const topFiles = Array.from(byFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));

  console.log("[i18n-audit]", {
    scannedRoots: ROOTS,
    hardcodedCandidates: hits.length,
    filesWithCandidates: byFile.size,
    topFiles,
  });

  for (const hit of hits.slice(0, 80)) {
    console.log(`${hit.file}:${hit.line} ${hit.text}`);
  }

  if (process.argv.includes("--fail-on-hardcoded") && hits.length > 0) {
    process.exitCode = 1;
  }
}

main();
