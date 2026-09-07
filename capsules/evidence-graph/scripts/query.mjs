import { z } from "zod";
import { EvidenceStore,SEARCH,REOPEN,NEIGHBORS } from "../lib/store.mjs";
import {HYBRID} from "../lib/hybrid-contracts.mjs";
const [operation,raw="{}"] = process.argv.slice(2);
const schema={status:z.object({}).strict(),search:SEARCH,reopen:REOPEN,neighbors:NEIGHBORS,"embedding-status":z.object({}).strict(),hybrid:HYBRID}[operation];
if(!schema) throw new Error("Use status, search, reopen, neighbors, embedding-status or hybrid");
const input=schema.parse(JSON.parse(raw)), store=new EvidenceStore();
try {
  let result;
  if(operation==="status") result=store.status();
  else if(operation==="search") result=store.search(input);
  else if(operation==="reopen") result=store.reopen(input.chunk_id,{verify_live:input.verify_live??true});
  else if(operation==="neighbors") {const {node_id,...options}=input;result=store.neighbors(node_id,options);}
  else if(operation==="embedding-status"||operation==="hybrid"){
    const {SemanticStore}=await import("../lib/semantic-store.mjs"),{LocalEmbedder}=await import("../lib/embedding-runtime.mjs");
    const semantic=new SemanticStore(),runtime=new LocalEmbedder();
    try{result=operation==="embedding-status"?semantic.status(store):await semantic.search(store,input,runtime);}finally{await runtime.close();semantic.close();}
  }
  else throw new Error("Use status, search, reopen, neighbors, embedding-status or hybrid");
  process.stdout.write(JSON.stringify(result)+"\n");
} finally {store.close();}
