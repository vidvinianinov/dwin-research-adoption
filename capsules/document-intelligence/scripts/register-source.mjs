import { registerSource } from "../lib/store.mjs";
const [id, path, ...rest] = process.argv.slice(2);
if (!id || !path || rest.length) throw new Error("Usage: register-source.mjs SOURCE_ID ABSOLUTE_PDF_PATH");
process.stdout.write(`${JSON.stringify(registerSource(id, path))}\n`);
