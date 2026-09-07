import { readFileSync,existsSync } from "node:fs";
import { join } from "node:path";
import { EvidenceStore } from "../lib/store.mjs";
if(existsSync(join(process.env.DWIN_RUN_OUTPUT,"retrieval-arms-evaluation.json"))){
  const {z}=await import("zod");
  const report=JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT,"retrieval-arms-evaluation.json"),"utf8"));
  const hash=z.string().regex(/^[a-f0-9]{64}$/),checks=[
    {id:"retrieval-experiment-identity",passed:[report.experiment_fingerprint,report.cases_hash,report.embedding_fingerprint,report.generation,report.experiment_dependencies?.policy_hash,report.experiment_dependencies?.retrieval_fingerprint].every(value=>hash.safeParse(value).success)},
    {id:"retrieval-not-promoted",passed:report.promoted===false&&report.human_reviewed===false&&report.default_search==="bm25"&&report.promotion_status==="BLOCKED_FRESH_HUMAN_REVIEWED_HOLDOUT_REQUIRED"},
    {id:"retrieval-offline-citations",passed:report.integrity?.passed===true&&report.integrity?.offline_js_fetch_attempts===0&&report.integrity?.citations_verified>0},
    {id:"retrieval-four-arms",passed:["bm25","exact_dense","existing_rrf","union_dense_rescore"].every(arm=>report.aggregate?.[arm])}
  ];
  const result={passed:checks.every(c=>c.passed),checks};process.stdout.write(JSON.stringify(result)+"\n");if(!result.passed)process.exitCode=1;
}else if(existsSync(join(process.env.DWIN_RUN_OUTPUT,"adoption-integrity.json"))){
  const {validateAdoptionCollection,canonical}=await import("../lib/adoption-records.mjs");
  const report=JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT,"adoption-integrity.json"),"utf8"));
  const store=new EvidenceStore();
  try{
    const independent=validateAdoptionCollection(store);
    const checks=[{id:"adoption-references-reopened",passed:canonical(independent)===canonical(report)},
      {id:"adoption-no-scientific-promotion",passed:report.scientific_verification===false&&report.authority==="candidate-only"},
      {id:"adoption-no-network",passed:report.network_requests===0}];
    const result={passed:checks.every(c=>c.passed),checks};process.stdout.write(JSON.stringify(result)+"\n");if(!result.passed)process.exitCode=1;
  }finally{store.close();}
}else if(existsSync(join(process.env.DWIN_RUN_OUTPUT,"embedding-report.json"))){
  const {SemanticStore}=await import("../lib/semantic-store.mjs");
  const {EMBEDDING_FINGERPRINT}=await import("../lib/embedding-runtime.mjs");
  const report=JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT,"embedding-report.json"),"utf8"));
  const evidence=new EvidenceStore(),semantic=new SemanticStore();
  try{
    evidence.assertSnapshot();
    const checks=[
      {id:"embedding-generation",passed:report.generation===evidence.meta("generation")&&report.fingerprint===EMBEDDING_FINGERPRINT},
      {id:"embedding-counts",passed:report.computed+report.cache_hits+report.pending===report.chunks&&report.chunks===evidence.status().counts.chunks},
      {id:"offline-candidate-only",passed:report.network_requests===0&&report.authority==="candidate-only"&&report.default_search==="bm25"&&report.privacy==="local-private-no-export"},
      {id:"vector-integrity",passed:report.status==="READY"?report.pending===0&&semantic.integrity(evidence).passed:report.status==="PARTIAL"&&report.pending>0}
    ];
    const result={passed:checks.every(x=>x.passed),checks};process.stdout.write(JSON.stringify(result)+"\n");if(!result.passed)process.exitCode=1;
  }finally{semantic.close();evidence.close();}
}else{
const report=JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT,"evidence-index-report.json"),"utf8"));
const graph=JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT,"private-evidence-graph.json"),"utf8"));
const store=new EvidenceStore();
try {
  const integrity=store.integrity();
  const checks=[
    {id:"source-spans-reopen",passed:integrity.passed},
    {id:"report-generation-matches",passed:report.generation===store.status().generation},
    {id:"no-authority-promotion",passed:report.authority==="candidate-only"&&integrity.invalid_edges===0},
    {id:"no-network",passed:report.network_requests===0},
    {id:"private-no-export",passed:report.privacy==="local-private-no-export"&&!JSON.stringify(report).includes("/Users/")},
    {id:"graph-snapshot-matches",passed:graph.generation===report.generation&&graph.nodes.length===report.counts.nodes&&graph.edges.length===report.counts.edges&&graph.edges.every(e=>["DERIVED_FROM","MENTIONS","REFERENCES"].includes(e.type))}
  ];
  const result={passed:checks.every(x=>x.passed),checks};
  process.stdout.write(JSON.stringify(result)+"\n");
  if(!result.passed) process.exitCode=1;
} finally {store.close();}
}
