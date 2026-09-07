import {readFileSync} from "node:fs";
import {EP,MODEL_DIR,assertModel,digest} from "./model-artifacts.mjs";
export const EMBEDDING_FINGERPRINT=digest(JSON.stringify(EP)+readFileSync(new URL(import.meta.url))+readFileSync(new URL("./model-artifacts.mjs",import.meta.url))+readFileSync(new URL("../../../package.json",import.meta.url))+process.version+process.arch);
export function vectorBytes(vector){
  const values=Float32Array.from(vector);
  if(values.length!==EP.dimensions||values.some(x=>!Number.isFinite(x)))throw new Error("INVALID_VECTOR_DIMENSION_OR_VALUE");
  const norm=Math.sqrt(values.reduce((n,x)=>n+x*x,0));
  if(Math.abs(norm-1)>0.001)throw new Error("VECTOR_NOT_NORMALIZED");
  return Buffer.from(values.buffer);
}
export function normalized(values){const norm=Math.sqrt(values.reduce((n,x)=>n+x*x,0));if(!Number.isFinite(norm)||norm<=0)throw new Error("INVALID_VECTOR_NORM");return Float32Array.from(values,x=>x/norm);}
export function embeddingKey(text,role,fingerprint=EMBEDDING_FINGERPRINT){
  if(!["query","passage"].includes(role)||typeof text!=="string"||!text.length||text.length>5000)throw new Error("INVALID_EMBEDDING_INPUT");
  return digest(JSON.stringify({text_hash:digest(text),role,fingerprint}));
}
// Split exact text without dropping tails or silently truncating model inputs.
export function textWindows(text,role,countTokens){
  const prefix=EP.prefixes[role];if(!prefix)throw new Error("INVALID_ROLE");
  if(role==="query"){if(countTokens(prefix+text)>EP.windowing.max_tokens)throw new Error("QUERY_TOKEN_LIMIT");return [prefix+text];}
  const windows=[];let start=0;
  while(start<text.length){
    let end=Math.min(text.length,start+EP.windowing.max_characters);
    if(end<text.length&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
    while(countTokens(prefix+text.slice(start,end))>EP.windowing.max_tokens){
      end=start+Math.floor((end-start)/2);if(end<=start)throw new Error("UNENCODABLE_TEXT");
      if(/[\uDC00-\uDFFF]/.test(text[end]))end--;
    }
    windows.push(prefix+text.slice(start,end));if(windows.length>EP.windowing.max_windows)throw new Error("WINDOW_LIMIT");
    if(end===text.length)break;
    start=Math.max(start+1,end-Math.min(EP.windowing.overlap_characters,Math.floor((end-start)/4)));
    if(/[\uDC00-\uDFFF]/.test(text[start]))start++;
  }
  return windows;
}
export class LocalEmbedder{
  constructor(directory=MODEL_DIR){this.directory=directory;this.modelCalls=0;this.windowCalls=0;this.pending=null;}
  async init(){
    if(!this.pending)this.pending=(async()=>{
      assertModel(this.directory);
      const {pipeline,env}=await import("@huggingface/transformers");
      env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;
      return pipeline("feature-extraction",this.directory,{local_files_only:true,dtype:EP.dtype,device:EP.device,session_options:{intraOpNumThreads:EP.threads,interOpNumThreads:1}});
    })().catch(error=>{this.pending=null;throw error;});
    return this.pending;
  }
  async embed(text,role){
    embeddingKey(text,role);const extractor=await this.init();
    const windows=textWindows(text,role,t=>extractor.tokenizer(t,{truncation:false,padding:false}).input_ids.dims[1]);
    const sum=new Float64Array(EP.dimensions);
    for(const window of windows){const output=await extractor(window,{pooling:EP.pooling,normalize:true});
      if(output.data.length!==EP.dimensions)throw new Error("MODEL_DIMENSION_CHANGED");
      for(let i=0;i<sum.length;i++)sum[i]+=output.data[i];this.windowCalls++;
    }
    const vector=normalized(sum);vectorBytes(vector);this.modelCalls++;return {vector,windows:windows.length};
  }
  async close(){if(this.pending){const model=await this.pending;await model.dispose();this.pending=null;}}
}
