import {join} from "node:path";

if(!process.env.DWIN_RUN_OUTPUT)throw new Error("DWIN_RUN_OUTPUT is required");
process.argv[2]=join(process.env.DWIN_RUN_OUTPUT,"retrieval-arms-evaluation.json");
await import("../scripts/evaluate-retrieval-arms.mjs");
