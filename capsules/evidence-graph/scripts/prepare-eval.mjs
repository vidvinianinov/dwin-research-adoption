import {cpSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EvidenceStore,registerSource} from "../lib/store.mjs";
const root=mkdtempSync(join(tmpdir(),"dwin-skill-eval-")),factory_data=join(root,"factory"),data=join(factory_data,"capsules/evidence-graph"),source=join(root,"source");
cpSync(new URL("../../../test/fixtures/evidence-graph/",import.meta.url),source,{recursive:true});
registerSource("fixture",source,data);const store=new EvidenceStore(data);
try {
 store.index();const old=store.search({query:"generation cache",context_id:"previous-task"});
 const path=join(source,"cache.md");writeFileSync(path,readFileSync(path,"utf8")+"\nChanged revision: verify current content before applying cache guidance.\n");
 process.stdout.write(JSON.stringify({factory_data,source,previous_packet_hash:old.packet_hash,previous_context_id:"previous-task",source_has_changed:true})+"\n");
}finally{store.close();}
