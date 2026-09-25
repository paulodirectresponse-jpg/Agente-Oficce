import { useEffect, useMemo, useState } from 'react';
import type { ResourceFile } from '../types.js';
import { api } from '../api.js';

function kindLabel(type:string,name:string){
  if(type.startsWith('image/'))return'Imagem'; if(type.startsWith('video/'))return'Vídeo'; if(type.startsWith('audio/'))return'Áudio';
  if(type==='application/pdf'||/\.pdf$/i.test(name))return'PDF'; return'Arquivo';
}
function PendingMedia({file}:{file:File}){
  const url=useMemo(()=>URL.createObjectURL(file),[file]);
  useEffect(()=>()=>URL.revokeObjectURL(url),[url]);
  if(file.type.startsWith('image/'))return <img src={url} alt=""/>;
  if(file.type.startsWith('video/'))return <video src={url} muted playsInline/>;
  if(file.type.startsWith('audio/'))return <audio src={url} controls preload="metadata"/>;
  return <span className="resource-preview-icon">{/\.pdf$/i.test(file.name)?'PDF':'DOC'}</span>;
}
function StoredMedia({file}:{file:ResourceFile}){
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true;void api.getResourceContentUrl(file.id).then(value=>{if(active)setUrl(value)});return()=>{active=false}},[file.id]);
  if(!url)return <span className="resource-preview-icon">…</span>;
  if(file.mime_type.startsWith('image/'))return <img src={url} alt=""/>;
  if(file.mime_type.startsWith('video/'))return <video src={url} controls preload="metadata"/>;
  if(file.mime_type.startsWith('audio/'))return <audio src={url} controls preload="metadata"/>;
  return <a className="resource-preview-icon" href={url} target="_blank" rel="noreferrer">{file.mime_type==='application/pdf'?'PDF':'DOC'}</a>;
}
export function PendingAttachmentCard({file,onRemove}:{file:File;onRemove:()=>void}){
  return <div className="resource-card pending"><div className="resource-media"><PendingMedia file={file}/></div><div className="resource-copy"><b>{kindLabel(file.type,file.name)}</b><span>{file.name}</span><small>{Math.max(1,Math.round(file.size/1024))} KB</small></div><button type="button" aria-label={'Remover '+file.name} onClick={onRemove}>×</button></div>;
}
export function StoredAttachmentCard({file}:{file:ResourceFile}){
  return <div className="resource-card"><div className="resource-media"><StoredMedia file={file}/></div><div className="resource-copy"><b>{kindLabel(file.mime_type,file.file_name)}</b><span>{file.file_name}</span><small>{Math.max(1,Math.round(file.size_bytes/1024))} KB</small></div></div>;
}
