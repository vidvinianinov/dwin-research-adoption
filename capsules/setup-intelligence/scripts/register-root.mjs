#!/usr/bin/env node
import { registerRoot } from "../lib/store.mjs";
const [id, path] = process.argv.slice(2); if (!id || !path) throw new Error("Usage: register-root.mjs <id> <absolute-file-or-directory>");
process.stdout.write(`${JSON.stringify(registerRoot(id, path))}\n`);
