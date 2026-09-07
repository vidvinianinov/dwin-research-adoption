import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function hashFile(path) {
  return sha256(readFileSync(path));
}

export function listFiles(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output.sort();
}

export function hashTree(root) {
  const hash = createHash("sha256");
  for (const path of listFiles(root)) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function describeArtifacts(root) {
  return listFiles(root).map((path) => ({
    path: relative(root, path),
    sha256: hashFile(path),
    bytes: statSync(path).size,
  }));
}
