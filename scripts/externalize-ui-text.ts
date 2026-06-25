import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

type Catalog = Record<string, { "pt-BR": string; "en-US": string }>;

const ROOTS = ["src/app", "src/components", "src/features"];
const CATALOG_PATH = path.join(process.cwd(), "src/lib/i18n/generated-ui-messages.json");
const UI_IMPORT = "@/lib/i18n/ui-message";
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

const f = ts.factory;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...walk(full));
    } else if (entry.name.endsWith(".tsx") || (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))) {
      files.push(full);
    }
  }
  return files;
}

function hasHardcodedText(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  if (clean.length === 1) return false;
  if (/^[A-Z0-9_:-]+$/.test(clean)) return false;
  return HARD_CODED_HINT.test(clean);
}

function hasUserFacingText(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
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

function keyFor(text: string): string {
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
  return `ui.${hash}`;
}

function catalogKey(catalog: Catalog, text: string): string {
  const key = keyFor(text);
  catalog[key] ??= { "pt-BR": text, "en-US": text };
  return key;
}

function callUiMessage(key: string, replacements?: Array<{ name: string; expression: ts.Expression }>) {
  const args: ts.Expression[] = [f.createStringLiteral(key)];
  if (replacements?.length) {
    args.push(
      f.createObjectLiteralExpression(
        replacements.map(({ name, expression }) =>
          f.createPropertyAssignment(f.createIdentifier(name), expression),
        ),
        false,
      ),
    );
  }
  return f.createCallExpression(f.createIdentifier("uiMessage"), undefined, args);
}

function isExistingUiMessageCall(node: ts.Node): boolean {
  return ts.isCallExpression(node.parent) &&
    node.parent.expression.getText() === "uiMessage";
}

function shouldSkipString(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  if (isExistingUiMessageCall(node)) return true;
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAccessExpression(parent)) return true;
  if (ts.isJsxAttribute(parent)) return true;
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) return true;
  return false;
}

function templateParts(node: ts.TemplateExpression): {
  text: string;
  replacements: Array<{ name: string; expression: ts.Expression }>;
} {
  let text = node.head.text;
  const replacements: Array<{ name: string; expression: ts.Expression }> = [];
  node.templateSpans.forEach((span, index) => {
    const name = `v${index + 1}`;
    replacements.push({ name, expression: span.expression });
    text += `{${name}}${span.literal.text}`;
  });
  return { text, replacements };
}

function hasUiImport(source: ts.SourceFile): boolean {
  return source.statements.some((statement) =>
    ts.isImportDeclaration(statement) &&
    statement.moduleSpecifier.getText(source).replaceAll("\"", "").replaceAll("'", "") === UI_IMPORT,
  );
}

function addUiImport(source: ts.SourceFile): ts.SourceFile {
  if (hasUiImport(source)) return source;
  const importDecl = f.createImportDeclaration(
    undefined,
    f.createImportClause(
      false,
      undefined,
      f.createNamedImports([f.createImportSpecifier(false, undefined, f.createIdentifier("uiMessage"))]),
    ),
    f.createStringLiteral(UI_IMPORT),
  );
  const statements = [...source.statements];
  let insertAt = 0;
  while (
    insertAt < statements.length &&
    ts.isExpressionStatement(statements[insertAt]) &&
    ts.isStringLiteral(statements[insertAt].expression) &&
    statements[insertAt].expression.text.startsWith("use ")
  ) {
    insertAt += 1;
  }
  return f.updateSourceFile(source, [
    ...statements.slice(0, insertAt),
    importDecl,
    ...statements.slice(insertAt),
  ]);
}

function transformFile(file: string, catalog: Catalog): boolean {
  const sourceText = fs.readFileSync(file, "utf8");

  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let changed = false;

  const result = ts.transform(source, [
    (context) => {
      const visitor: ts.Visitor = (node) => {
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
          const text = node.initializer.text;
          if ((isUserFacingProperty(node.name) ? hasUserFacingText(text) : hasHardcodedText(text))) {
            changed = true;
            const key = catalogKey(catalog, text);
            return f.updateJsxAttribute(
              node,
              node.name,
              f.createJsxExpression(undefined, callUiMessage(key)),
            );
          }
        }

        if (
          ts.isPropertyAssignment(node) &&
          isUserFacingProperty(node.name) &&
          (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
          hasUserFacingText(node.initializer.text)
        ) {
          changed = true;
          const key = catalogKey(catalog, node.initializer.text);
          return f.updatePropertyAssignment(node, node.name, callUiMessage(key));
        }

        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !shouldSkipString(node)) {
          const text = node.text;
          if (hasHardcodedText(text)) {
            changed = true;
            const key = catalogKey(catalog, text);
            return callUiMessage(key);
          }
        }

        if (ts.isTemplateExpression(node)) {
          const { text, replacements } = templateParts(node);
          const parent = node.parent;
          const visibleProperty =
            ts.isPropertyAssignment(parent) && isUserFacingProperty(parent.name);
          const visibleAttribute =
            ts.isJsxExpression(parent) &&
            ts.isJsxAttribute(parent.parent) &&
            isUserFacingProperty(parent.parent.name);
          if ((visibleProperty || visibleAttribute) ? hasUserFacingText(text) : hasHardcodedText(text)) {
            changed = true;
            const key = catalogKey(catalog, text);
            return callUiMessage(key, replacements);
          }
        }

        if (ts.isJsxText(node)) {
          const raw = node.getFullText(source);
          const clean = raw.replace(/\s+/g, " ").trim();
          if (hasUserFacingText(clean)) {
            changed = true;
            const key = catalogKey(catalog, clean);
            return f.createJsxExpression(undefined, callUiMessage(key));
          }
        }

        return ts.visitEachChild(node, visitor, context);
      };

      return (root) => ts.visitNode(root, visitor);
    },
  ]);

  const visited = result.transformed[0] as ts.SourceFile;
  if (!changed) return false;

  const withImport = addUiImport(visited);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  fs.writeFileSync(file, `${printer.printFile(withImport)}\n`, "utf8");
  result.dispose();
  return true;
}

function main() {
  const catalog = fs.existsSync(CATALOG_PATH)
    ? JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) as Catalog
    : {};
  const files = ROOTS.flatMap((root) => walk(path.join(process.cwd(), root)));
  const changedFiles = files.filter((file) => transformFile(file, catalog));

  const sortedCatalog = Object.fromEntries(
    Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(sortedCatalog, null, 2)}\n`, "utf8");

  console.log("[externalize-ui-text]", {
    scanned: files.length,
    changed: changedFiles.length,
    messages: Object.keys(sortedCatalog).length,
  });
  for (const file of changedFiles.slice(0, 80)) {
    console.log(path.relative(process.cwd(), file).replace(/\\/g, "/"));
  }
}

main();
