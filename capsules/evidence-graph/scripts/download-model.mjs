// Explicit operator provisioning, never called by index/search or a scheduled job.
import {mkdirSync,readFileSync,renameSync,writeFileSync,lstatSync,existsSync,createWriteStream} from "node:fs";
import {dirname,join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {EP,MODEL_DIR,digest,allowedModelURL,assertModel} from "../lib/model-artifacts.mjs";
if(process.argv.length>2)throw new Error("No arguments: only the committed model pin can be provisioned");
mkdirSync(MODEL_DIR,{recursive:true,mode:0o700});
if(lstatSync(MODEL_DIR).isSymbolicLink())throw new Error("Model directory symlink forbidden");
let requests=0;
for(const file of EP.files){
 const target=join(MODEL_DIR,file.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});
 if(lstatSync(dirname(target)).isSymbolicLink()||(existsSync(target)&&lstatSync(target).isSymbolicLink()))throw new Error("Symlink forbidden");
 if(existsSync(target)&&digest(readFileSync(target))===file.sha256){process.stdout.write(JSON.stringify({file:file.path,status:"already-verified"})+"\n");continue;}
 if(existsSync(target))throw new Error(`Corrupt existing artifact ${file.path}; inspect or quarantine it before provisioning again`);
 let url=`https://huggingface.co/${EP.model}/resolve/${EP.revision}/${file.path}`,response;
 for(let hop=0;hop<8;hop++){
  if(!allowedModelURL(url))throw new Error("Model download host rejected");
  response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(120000)});requests++;
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get("location");await response.body?.cancel();if(!location)throw new Error("Missing redirect");url=new URL(location,url).href;continue;}break;
 }
 if(!response?.ok)throw new Error(`Model download failed: ${response?.status}`);
 const partial=target+".partial-"+randomUUID(),hash=createHash("sha256");let bytes=0;
 async function* bounded(){for await(const data of response.body){bytes+=data.length;if(bytes>file.bytes)throw new Error("Model size exceeded pin");hash.update(data);yield data;}}
 await pipeline(Readable.from(bounded()),createWriteStream(partial,{flags:"wx",mode:0o600}));
 if(bytes!==file.bytes||hash.digest("hex")!==file.sha256)throw new Error("Model artifact hash mismatch; partial retained for inspection");
 renameSync(partial,target);process.stdout.write(JSON.stringify({file:file.path,status:"downloaded-verified",bytes})+"\n");
}
const report={schema_version:"dwin.model-provisioning/v1",model:EP.model,revision:EP.revision,...assertModel(),requests,private_text_sent:false,created_at:new Date().toISOString()};
writeFileSync(join(MODEL_DIR,"provisioning.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
process.stdout.write(JSON.stringify(report)+"\n");
