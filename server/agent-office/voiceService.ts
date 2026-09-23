import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Database } from 'better-sqlite3';
import { getAgentOfficeConfig } from './config.js';
import { DevelopmentSecretStore } from './secretStore.js';
import { ProviderRepositoryV2, type Provider } from './v2DataModel.js';

export interface VoiceStatus {
  local_ready:boolean;
  local_binary:string|null;
  local_model:string|null;
  cloud_ready:boolean;
  cloud_provider:string|null;
  mode:'local'|'cloud'|'unavailable';
}

function firstExisting(paths:string[]){return paths.find(value=>value&&fs.existsSync(value))??null}
function pathBinary(name:string){
  const cmd=process.platform==='win32'?'where.exe':'which';
  try{
    const run=spawnSync(cmd,[name],{encoding:'utf8',windowsHide:true,timeout:3000});
    if(run.status!==0)return null;
    return String(run.stdout||'').split(/\r?\n/).map(x=>x.trim()).find(Boolean)??null;
  }catch{return null}
}
function localRuntime(){
  const dataDir=getAgentOfficeConfig().dataDir;
  const binary=firstExisting([
    process.env.AGENT_OFFICE_WHISPER_BIN||'',
    path.join(dataDir,'voice','whisper-cli.exe'),
    path.join(dataDir,'voice','whisper-cli'),
  ])||pathBinary(process.platform==='win32'?'whisper-cli.exe':'whisper-cli')||pathBinary('whisper-cli');
  const model=firstExisting([
    process.env.AGENT_OFFICE_WHISPER_MODEL||'',
    path.join(dataDir,'voice','models','ggml-small.bin'),
    path.join(dataDir,'voice','models','ggml-base.bin'),
    path.join(dataDir,'voice','models','ggml-small-q5_1.bin'),
    path.join(dataDir,'voice','models','ggml-base-q5_1.bin'),
  ]);
  return{binary,model};
}
function trimSlash(value:string){return value.replace(/\/+$/,'')}
function cloudProvider(db:Database):Provider|null{
  const providers=new ProviderRepositoryV2(db).list().filter(p=>p.enabled&&p.secret_ref&&/^https?:\/\//i.test(p.base_url));
  return providers.find(p=>typeof p.protocol_config.transcription_path==='string')
    ??providers.find(p=>/api\.openai\.com/i.test(p.base_url))
    ??providers.find(p=>/api\.groq\.com/i.test(p.base_url))
    ??null;
}
function cloudConfig(provider:Provider){
  const configuredPath=typeof provider.protocol_config.transcription_path==='string'?String(provider.protocol_config.transcription_path):'';
  const isGroq=/api\.groq\.com/i.test(provider.base_url);
  const isOpenAI=/api\.openai\.com/i.test(provider.base_url);
  const pathValue=configuredPath||(isGroq||isOpenAI?'/v1/audio/transcriptions':'');
  const model=typeof provider.protocol_config.transcription_model==='string'
    ?String(provider.protocol_config.transcription_model)
    :isGroq?'whisper-large-v3-turbo':isOpenAI?'gpt-4o-mini-transcribe':'';
  return{url:pathValue?trimSlash(provider.base_url)+(pathValue.startsWith('/')?pathValue:'/'+pathValue):'',model};
}

export class VoiceService{
  constructor(private readonly db:Database){}
  status():VoiceStatus{
    const local=localRuntime(),cloud=cloudProvider(this.db);
    return{
      local_ready:Boolean(local.binary&&local.model),
      local_binary:local.binary,
      local_model:local.model,
      cloud_ready:Boolean(cloud&&cloudConfig(cloud).url&&cloudConfig(cloud).model),
      cloud_provider:cloud?.name??null,
      mode:local.binary&&local.model?'local':cloud&&cloudConfig(cloud).url&&cloudConfig(cloud).model?'cloud':'unavailable',
    };
  }
  private localTranscribe(buffer:Buffer,language:string){
    const runtime=localRuntime();if(!runtime.binary||!runtime.model)throw new Error('VOICE_LOCAL_UNAVAILABLE');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-office-voice-')),wav=path.join(dir,'input.wav');
    try{
      fs.writeFileSync(wav,buffer);
      const threads=Math.max(2,Math.min(8,os.cpus().length-1));
      const run=spawnSync(runtime.binary,['-m',runtime.model,'-f',wav,'-l',language||'pt','-nt','-np','-t',String(threads)],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
      if(run.status!==0)throw new Error(String(run.stderr||'VOICE_LOCAL_FAILED').trim());
      const text=String(run.stdout||'').replace(/\[[^\]]+\]\s*/g,'').trim();
      if(!text)throw new Error('VOICE_EMPTY_TRANSCRIPT');
      return{text,engine:'whisper.cpp' as const};
    }finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
  }
  private async cloudTranscribe(buffer:Buffer,language:string){
    const provider=cloudProvider(this.db);if(!provider||!provider.secret_ref)throw new Error('VOICE_PROVIDER_UNAVAILABLE');
    const config=cloudConfig(provider);if(!config.url||!config.model)throw new Error('VOICE_PROVIDER_UNSUPPORTED');
    const secret=await new DevelopmentSecretStore(getAgentOfficeConfig().dataDir).get(provider.secret_ref);if(!secret)throw new Error('VOICE_PROVIDER_SECRET_MISSING');
    const form=new FormData();
    form.append('file',new Blob([buffer],{type:'audio/wav'}),'voice.wav');
    form.append('model',config.model);
    form.append('language',language||'pt');
    const headers:Record<string,string>={...provider.headers};
    if(provider.auth_driver==='x-api-key')headers['x-api-key']=secret;
    else if(provider.auth_driver==='custom_header'){const name=typeof provider.auth_config.header_name==='string'?provider.auth_config.header_name:'Authorization';headers[name]=secret}
    else headers.Authorization='Bearer '+secret;
    const response=await fetch(config.url,{method:'POST',headers,body:form,signal:AbortSignal.timeout(Math.max(provider.timeout_ms,120000))});
    const raw=await response.text();if(!response.ok)throw new Error('VOICE_PROVIDER_FAILED_'+response.status);
    let text='';try{const json=JSON.parse(raw) as Record<string,unknown>;text=typeof json.text==='string'?json.text:''}catch{text=raw}
    if(!text.trim())throw new Error('VOICE_EMPTY_TRANSCRIPT');
    return{text:text.trim(),engine:provider.name};
  }
  async transcribe(buffer:Buffer,language='pt'){
    if(!buffer.length)throw new Error('VOICE_AUDIO_EMPTY');
    if(buffer.length>25*1024*1024)throw new Error('VOICE_AUDIO_TOO_LARGE');
    const status=this.status();
    if(status.local_ready){try{return await Promise.resolve(this.localTranscribe(buffer,language))}catch(error){if(!status.cloud_ready)throw error}}
    if(status.cloud_ready)return this.cloudTranscribe(buffer,language);
    throw new Error('VOICE_TRANSCRIPTION_UNAVAILABLE');
  }
}
