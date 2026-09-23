import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Database } from 'better-sqlite3';
import { getAgentOfficeConfig } from './config.js';

export type ResourceOwnerType='chat'|'project'|'agent'|'subagent'|'skill';
export type KnowledgeScopeType='project'|'agent'|'subagent';
export interface ResourceRecord{id:string;project_id:string|null;owner_type:ResourceOwnerType;owner_id:string|null;file_name:string;mime_type:string;size_bytes:number;storage_path:string;text_content:string;status:'ready'|'stored'|'error';metadata:Record<string,unknown>;created_at:string}
export interface KnowledgeItem{id:string;scope_type:KnowledgeScopeType;scope_id:string;resource_id:string;title:string;enabled:boolean;metadata:Record<string,unknown>;created_at:string;updated_at:string;resource?:ResourceRecord}
export interface SkillRecord{id:string;name:string;slug:string;description:string;instructions:string;source_path:string|null;enabled:boolean;metadata:Record<string,unknown>;created_at:string;updated_at:string}
export const MAX_UPLOAD_BYTES=100*1024*1024;
const TEXT_EXTENSIONS=new Set(['.txt','.md','.markdown','.json','.jsonl','.csv','.tsv','.xml','.html','.htm','.css','.scss','.less','.js','.jsx','.ts','.tsx','.mjs','.cjs','.py','.rb','.php','.java','.kt','.go','.rs','.c','.h','.cpp','.hpp','.cs','.swift','.sql','.sh','.bash','.zsh','.ps1','.bat','.cmd','.yaml','.yml','.toml','.ini','.env','.log']);
const MAX_TEXT_BYTES=2*1024*1024;
const INLINE_MEDIA_BYTES=18*1024*1024;

function decodeXml(value:string){return value.replace(/<[^>]+>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()}
function commandText(command:string,args:string[]){try{const run=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024});return run.status===0?String(run.stdout||'').trim():''}catch{return''}}
function officeText(storage:string,name:string):string{
  if(process.platform!=='win32'||!/\.(docx|xlsx|pptx)$/i.test(name))return'';
  const temp=path.join(path.dirname(storage),'office-unpacked');
  try{
    fs.rmSync(temp,{recursive:true,force:true});
    const script=`Expand-Archive -LiteralPath '${storage.replace(/'/g,"''")}' -DestinationPath '${temp.replace(/'/g,"''")}' -Force`;
    const run=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:20000});
    if(run.status!==0)return'';
    const candidates:string[]=[];
    const walk=(dir:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.xml$/i.test(entry.name)&&(/word[\\/]document\.xml$/i.test(p)||/ppt[\\/]slides[\\/]slide\d+\.xml$/i.test(p)||/xl[\\/]worksheets[\\/]sheet\d+\.xml$/i.test(p)||/xl[\\/]sharedStrings\.xml$/i.test(p)))candidates.push(p)}};
    walk(temp);
    return candidates.sort().map(p=>decodeXml(fs.readFileSync(p,'utf8'))).filter(Boolean).join('\n').slice(0,MAX_TEXT_BYTES);
  }catch{return''}finally{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}
}
function enrichBinary(storage:string,mime:string,name:string):{text:string;metadata:Record<string,unknown>}{
  const ext=path.extname(name).toLowerCase();let text='';
  if(ext==='.pdf'){text=commandText('pdftotext',[storage,'-']).slice(0,MAX_TEXT_BYTES)}
  else if(/\.(docx|xlsx|pptx)$/i.test(ext)){text=officeText(storage,name)}
  const metadata:Record<string,unknown>={};
  if(mime.startsWith('audio/')||mime.startsWith('video/')){
    const probe=commandText('ffprobe',['-v','quiet','-print_format','json','-show_format','-show_streams',storage]);
    if(probe){try{metadata.media_probe=JSON.parse(probe)}catch{}}
    if(mime.startsWith('video/')){
      const thumb=path.join(path.dirname(storage),'preview.jpg');
      try{const run=spawnSync('ffmpeg',['-y','-ss','00:00:01','-i',storage,'-frames:v','1','-vf','scale=640:-2',thumb],{encoding:'utf8',windowsHide:true,timeout:25000});if(run.status===0&&fs.existsSync(thumb))metadata.preview_path=thumb}catch{}
    }
  }
  return{text,metadata};
}
function parseSkillMarkdown(content:string,fallback:string){const front=/^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);let body=content,meta:Record<string,string>={};if(front){body=content.slice(front[0].length);for(const line of front[1].split(/\r?\n/)){const idx=line.indexOf(':');if(idx>0)meta[line.slice(0,idx).trim()]=line.slice(idx+1).trim().replace(/^["']|["']$/g,'')}}const heading=/^#\s+(.+)$/m.exec(body)?.[1]?.trim();return{name:meta.name||heading||fallback,description:meta.description||'',instructions:body.trim(),metadata:{activation:meta.activation||meta.when||'',tools:meta.tools||'',tags:meta.tags||'',version:meta.version||'1'}}}

export function sanitizeUploadName(value:string){const base=path.basename(value||'arquivo').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/^\.+/,'').trim();return(base||'arquivo').slice(0,180)}
export function resourceKind(mime:string,name:string):'image'|'video'|'audio'|'document'|'code'|'archive'|'other'{const m=mime.toLowerCase(),ext=path.extname(name).toLowerCase();if(m.startsWith('image/'))return'image';if(m.startsWith('video/'))return'video';if(m.startsWith('audio/'))return'audio';if(['.zip','.rar','.7z','.tar','.gz','.tgz'].includes(ext))return'archive';if(TEXT_EXTENSIONS.has(ext))return /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|php|java|kt|go|rs|c|h|cpp|hpp|cs|swift|sql|sh|bash|zsh|ps1|bat|cmd|css|scss|less)$/i.test(ext)?'code':'document';if(/pdf|word|officedocument|spreadsheet|presentation|rtf|epub|opendocument/.test(m)||/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|epub)$/i.test(ext))return'document';return'other'}
export function extractTextContent(buffer:Buffer,mime:string,name:string){const ext=path.extname(name).toLowerCase();const textual=mime.startsWith('text/')||mime.includes('json')||mime.includes('xml')||TEXT_EXTENSIONS.has(ext);if(!textual)return'';return buffer.subarray(0,Math.min(buffer.length,MAX_TEXT_BYTES)).toString('utf8').replace(/\u0000/g,'').trim()}
function readJson(value:string){try{return JSON.parse(value||'{}') as Record<string,unknown>}catch{return{}}}
function rowResource(row:any):ResourceRecord{return{...row,metadata:readJson(row.metadata_json)}}
function slugify(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'skill'}

export class ResourceService{
  constructor(private readonly db:Database){}
  createUpload(input:{project_id?:string|null;owner_type?:ResourceOwnerType;owner_id?:string|null;file_name:string;mime_type?:string;buffer:Buffer;metadata?:Record<string,unknown>}):ResourceRecord{
    if(!input.buffer.length)throw new Error('RESOURCE_EMPTY');if(input.buffer.length>MAX_UPLOAD_BYTES)throw new Error('RESOURCE_TOO_LARGE');
    if(input.project_id&&!this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(input.project_id))throw new Error('RESOURCE_PROJECT_NOT_FOUND');
    const id=crypto.randomUUID(),name=sanitizeUploadName(input.file_name),mime=input.mime_type||'application/octet-stream',root=path.join(getAgentOfficeConfig().dataDir,'resources',input.project_id||'global',id);
    fs.mkdirSync(root,{recursive:true});const storage=path.join(root,name);fs.writeFileSync(storage,input.buffer,{flag:'wx'});
    const directText=extractTextContent(input.buffer,mime,name),enriched=directText?{text:'',metadata:{}}:enrichBinary(storage,mime,name);
    const text=(directText||enriched.text).slice(0,MAX_TEXT_BYTES),now=new Date().toISOString(),metadata={kind:resourceKind(mime,name),text_extracted:Boolean(text),inline_multimodal:input.buffer.length<=INLINE_MEDIA_BYTES,...enriched.metadata,...input.metadata};
    this.db.prepare("INSERT INTO resources(id,project_id,owner_type,owner_id,file_name,mime_type,size_bytes,storage_path,text_content,status,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,'ready',?,?)").run(id,input.project_id??null,input.owner_type??'chat',input.owner_id??null,name,mime,input.buffer.length,storage,text,JSON.stringify(metadata),now);
    return this.get(id)!;
  }
  get(id:string):ResourceRecord|null{const row=this.db.prepare('SELECT * FROM resources WHERE id=?').get(id);return row?rowResource(row):null}
  listProject(projectId:string,limit=200){return(this.db.prepare('SELECT * FROM resources WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId,limit) as any[]).map(rowResource)}
  attachments(ids:string[]){if(!ids.length)return[] as ResourceRecord[];const q=ids.map(()=>'?').join(',');return(this.db.prepare(`SELECT * FROM resources WHERE id IN (${q})`).all(...ids) as any[]).map(rowResource)}
  linkMessage(messageId:string,ids:string[]){const s=this.db.prepare('INSERT OR IGNORE INTO message_resources(message_id,resource_id,created_at) VALUES(?,?,?)'),now=new Date().toISOString();for(const id of ids)if(this.get(id))s.run(messageId,id,now)}
  addKnowledge(input:{scope_type:KnowledgeScopeType;scope_id:string;resource_id:string;title?:string;metadata?:Record<string,unknown>}):KnowledgeItem{const r=this.get(input.resource_id);if(!r)throw new Error('RESOURCE_NOT_FOUND');if(!input.scope_id)throw new Error('KNOWLEDGE_SCOPE_REQUIRED');const id=crypto.randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO knowledge_items(id,scope_type,scope_id,resource_id,title,enabled,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)').run(id,input.scope_type,input.scope_id,r.id,(input.title||r.file_name).trim(),JSON.stringify(input.metadata??{}),now,now);return this.getKnowledge(id)!}
  getKnowledge(id:string):KnowledgeItem|null{const row=this.db.prepare('SELECT * FROM knowledge_items WHERE id=?').get(id) as any;if(!row)return null;return{...row,enabled:Boolean(row.enabled),metadata:readJson(row.metadata_json),resource:this.get(row.resource_id)??undefined}}
  listKnowledge(type:KnowledgeScopeType,id:string){return(this.db.prepare('SELECT id FROM knowledge_items WHERE scope_type=? AND scope_id=? ORDER BY updated_at DESC').all(type,id) as Array<{id:string}>).map(x=>this.getKnowledge(x.id)!).filter(Boolean)}
  deleteKnowledge(id:string){return this.db.prepare('DELETE FROM knowledge_items WHERE id=?').run(id).changes>0}
  listSkills():SkillRecord[]{return(this.db.prepare('SELECT * FROM skills ORDER BY name').all() as any[]).map(x=>({...x,enabled:Boolean(x.enabled),metadata:readJson(x.metadata_json)}))}
  saveSkill(input:{id?:string;name:string;slug?:string;description?:string;instructions?:string;source_path?:string|null;enabled?:boolean;metadata?:Record<string,unknown>}):SkillRecord{const name=String(input.name||'').trim();if(!name)throw new Error('SKILL_NAME_REQUIRED');const now=new Date().toISOString(),slug=input.slug||slugify(name);if(input.id){this.db.prepare('UPDATE skills SET name=?,slug=?,description=?,instructions=?,source_path=?,enabled=?,metadata_json=?,updated_at=? WHERE id=?').run(name,slug,input.description||'',input.instructions||'',input.source_path??null,input.enabled===false?0:1,JSON.stringify(input.metadata??{}),now,input.id)}else{input.id=crypto.randomUUID();this.db.prepare('INSERT INTO skills(id,name,slug,description,instructions,source_path,enabled,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.id,name,slug,input.description||'',input.instructions||'',input.source_path??null,input.enabled===false?0:1,JSON.stringify(input.metadata??{}),now,now)}const found=this.listSkills().find(x=>x.id===input.id);if(!found)throw new Error('SKILL_NOT_FOUND');return found}
  deleteSkill(id:string){return this.db.prepare('DELETE FROM skills WHERE id=?').run(id).changes>0}
  assignSkill(skillId:string,type:'agent'|'subagent',id:string){this.db.prepare('INSERT INTO skill_assignments(skill_id,assignee_type,assignee_id,enabled,created_at) VALUES(?,?,?,?,?) ON CONFLICT(skill_id,assignee_type,assignee_id) DO UPDATE SET enabled=1').run(skillId,type,id,1,new Date().toISOString())}
  unassignSkill(skillId:string,type:'agent'|'subagent',id:string){this.db.prepare('DELETE FROM skill_assignments WHERE skill_id=? AND assignee_type=? AND assignee_id=?').run(skillId,type,id)}
  assignedSkills(type:'agent'|'subagent',id:string):SkillRecord[]{return(this.db.prepare('SELECT s.* FROM skills s JOIN skill_assignments a ON a.skill_id=s.id WHERE a.assignee_type=? AND a.assignee_id=? AND a.enabled=1 AND s.enabled=1 ORDER BY s.name').all(type,id) as any[]).map(x=>({...x,enabled:Boolean(x.enabled),metadata:readJson(x.metadata_json)}))}
  multimodalAttachments(ids:string[]){return this.attachments(ids).filter(r=>Boolean(r.metadata.inline_multimodal)).map(r=>({kind:String(r.metadata.kind||'other'),mime_type:r.mime_type,file_name:r.file_name,size_bytes:r.size_bytes,data_base64:fs.readFileSync(r.storage_path).toString('base64')}))}
  syncFilesystemSkills(projectId?:string|null):SkillRecord[]{
    const roots=[path.join(process.cwd(),'.agents','skills')];
    if(projectId){const project=this.db.prepare('SELECT root_path FROM projects WHERE id=?').get(projectId) as {root_path:string}|undefined;if(project?.root_path)roots.push(path.join(project.root_path,'.agents','skills'))}
    const saved:SkillRecord[]=[];
    for(const root of [...new Set(roots)]){if(!fs.existsSync(root))continue;const walk=(dir:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(!entry.isDirectory())continue;const folder=path.join(dir,entry.name),skillPath=path.join(folder,'SKILL.md');if(fs.existsSync(skillPath)){const parsed=parseSkillMarkdown(fs.readFileSync(skillPath,'utf8'),entry.name);const existing=(this.db.prepare('SELECT id FROM skills WHERE source_path=?').get(skillPath) as {id:string}|undefined)?.id;try{saved.push(this.saveSkill({id:existing,name:parsed.name,description:parsed.description,instructions:parsed.instructions,source_path:skillPath,metadata:{...parsed.metadata,origin:'filesystem'}}))}catch{} } else walk(folder)}};walk(root)}
    return saved;
  }
  context(input:{projectId:string;agentId?:string;subagentId?:string;query?:string;attachmentIds?:string[]}){const blocks:string[]=[];const files=this.attachments(input.attachmentIds??[]);if(files.length)blocks.push('Files attached to the current request:\n'+files.map(r=>`- ${r.file_name} [${r.mime_type}] path=${r.storage_path}${r.text_content?'\n'+r.text_content.slice(0,12000):'\nBinary/media file. Use an available file/media-capable tool to inspect it when needed.'}`).join('\n'));let knowledge=[...this.listKnowledge('project',input.projectId)];if(input.agentId)knowledge.push(...this.listKnowledge('agent',input.agentId));if(input.subagentId)knowledge.push(...this.listKnowledge('subagent',input.subagentId));const terms=(input.query||'').toLowerCase().split(/\W+/).filter(x=>x.length>2);knowledge=knowledge.filter(x=>x.enabled&&x.resource).sort((a,b)=>terms.reduce((n,t)=>n+((b.title+' '+b.resource!.text_content).toLowerCase().includes(t)?1:0),0)-terms.reduce((n,t)=>n+((a.title+' '+a.resource!.text_content).toLowerCase().includes(t)?1:0),0)).slice(0,6);if(knowledge.length)blocks.push('Persistent knowledge:\n'+knowledge.map(x=>`- ${x.title}: ${x.resource!.text_content?x.resource!.text_content.slice(0,9000):'stored at '+x.resource!.storage_path}`).join('\n'));const skills=input.subagentId?this.assignedSkills('subagent',input.subagentId):input.agentId?this.assignedSkills('agent',input.agentId):[];if(skills.length)blocks.push('Active Skills:\n'+skills.map(s=>`## ${s.name}\n${s.description}\n${s.instructions}`).join('\n\n'));return blocks.join('\n\n').slice(0,36000)}
}
