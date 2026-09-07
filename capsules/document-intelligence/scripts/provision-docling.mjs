import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { platform, arch } from "node:os";
import { FACTORY_DATA } from "../../../src/paths.mjs";

const VERSION = "2.126.0", OCRMAC_VERSION = "1.0.1", root = join(FACTORY_DATA, "runtimes", "document-intelligence"), venv = join(root, "venv"), models = join(root, "models");
const bootstrap = process.env.DWIN_PYTHON_BOOTSTRAP || "python3";
function run(command, args) { const result = spawnSync(command, args, { stdio: "inherit", shell: false }); if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`); }
function files(dir) { const result = []; const walk = current => { for (const entry of readdirSync(current, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name,"en"))) { const path = join(current, entry.name); if (entry.isSymbolicLink()) throw new Error("Symlink in model artifacts is forbidden"); if (entry.isDirectory()) walk(path); else if (entry.isFile()) result.push(path); } }; walk(dir); return result; }
function treeHash(dir) { const hash = createHash("sha256"); for (const path of files(dir)) { hash.update(relative(dir,path)); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); } return hash.digest("hex"); }

mkdirSync(root, { recursive: true, mode: 0o700 });
if (!existsSync(join(venv, "bin", "python"))) run(bootstrap, ["-m", "venv", venv]);
const python = join(venv, "bin", "python"), tools = join(venv, "bin", "docling-tools");
run(python, ["-m", "pip", "install", `docling==${VERSION}`, `ocrmac==${OCRMAC_VERSION}`]);
mkdirSync(models, { recursive: true, mode: 0o700 });
run(tools, ["models", "download", "-o", models, "layout", "tableformer", "code_formula"]);
const version = spawnSync(python, ["-c", "import docling, importlib.metadata; print(docling.__version__); print(importlib.metadata.version('ocrmac'))"], { encoding: "utf8", shell: false });
if (version.status !== 0 || version.stdout.trim() !== `${VERSION}\n${OCRMAC_VERSION}`) throw new Error("Pinned Docling/OcrMac version verification failed");
const manifest = { schema_version: "dwin.document-runtime/v1", docling_version: VERSION, ocrmac_version: OCRMAC_VERSION, python_version: spawnSync(python,["--version"],{encoding:"utf8",shell:false}).stdout.trim(), platform: platform(), arch: arch(), model_tree_sha256: treeHash(models), model_file_count: files(models).length, model_bytes: files(models).reduce((sum,path)=>sum+statSync(path).size,0), provisioned_at: new Date().toISOString(), note: "Model tree hash covers prefetched layout, tableformer and code_formula artifacts. OCR uses pinned OcrMac with local macOS Vision." };
writeFileSync(join(root, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(manifest)}\n`);
