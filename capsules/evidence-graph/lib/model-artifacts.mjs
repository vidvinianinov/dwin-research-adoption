import {readFileSync,statSync,lstatSync,realpathSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {FACTORY_DATA} from "../../../src/paths.mjs";
export const EP=JSON.parse(readFileSync(new URL("../contracts/embedding-policy.json",import.meta.url),"utf8"));
export const digest=value=>createHash("sha256").update(value).digest("hex");
export const MODEL_DIR=join(FACTORY_DATA,"models","multilingual-e5-small",EP.revision);
export function verifyModel(directory=MODEL_DIR){
  try{
    const root=realpathSync(directory);
    if(lstatSync(directory).isSymbolicLink())throw new Error("Model root symlink");
    for(const file of EP.files){
      const path=join(directory,file.path);
      if(lstatSync(path).isSymbolicLink()||realpathSync(path)!==join(root,file.path)||statSync(path).size!==file.bytes||digest(readFileSync(path))!==file.sha256)throw new Error(`Model integrity failure: ${file.path}`);
    }
    return {status:"LOCAL_READY",files:EP.files.length,bytes:EP.files.reduce((n,f)=>n+f.bytes,0)};
  }catch(error){return {status:error.code==="ENOENT"?"MODEL_MISSING":"MODEL_INVALID",files:0,bytes:0};}
}
export function assertModel(directory=MODEL_DIR){const r=verifyModel(directory);if(r.status!=="LOCAL_READY")throw new Error(`${r.status}: run scripts/download-model.mjs explicitly; inference never downloads weights`);return r;}
export function allowedModelURL(value){const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")&&["huggingface.co","cas-bridge.xethub.hf.co","cdn-lfs.huggingface.co","cdn-lfs-us-1.hf.co","cdn-lfs-eu-1.hf.co","us.aws.cdn.hf.co","eu.aws.cdn.hf.co"].includes(u.hostname);}
