import { rm } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = process.cwd();
const target = resolve(root, ".next");
const relativeTarget = relative(root, target);

if (relativeTarget.startsWith("..") || relativeTarget === "") {
  throw new Error(`Refusing to remove unsafe path: ${target}`);
}

await rm(target, { recursive: true, force: true });
console.log(`[dev:clean] removed ${target}`);
