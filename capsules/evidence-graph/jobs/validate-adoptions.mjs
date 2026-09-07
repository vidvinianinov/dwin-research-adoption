import{writeFileSync}from"node:fs";
import{join}from"node:path";
import{EvidenceStore}from"../lib/store.mjs";
import{validateAdoptionCollection}from"../lib/adoption-records.mjs";
if(!process.env.DWIN_RUN_OUTPUT)throw new Error("DWIN_RUN_OUTPUT required");
const store=new EvidenceStore();
try{const report=validateAdoptionCollection(store);writeFileSync(join(process.env.DWIN_RUN_OUTPUT,"adoption-integrity.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});process.stdout.write(JSON.stringify({records_checked:report.records_checked,scientific_verification:false})+"\n");}finally{store.close();}
