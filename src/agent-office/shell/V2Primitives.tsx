import type { PropsWithChildren, ReactNode } from 'react';

export function V2PageHeader({title,subtitle,actions}:{title:string;subtitle?:string;actions?:ReactNode}){
  return <header className="v2-page-header"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="v2-page-actions">{actions}</div>}</header>;
}
export function V2Tabs<T extends string>({items,value,onChange,label}:{items:Array<{key:T;label:string;hidden?:boolean}>;value:T;onChange:(value:T)=>void;label:string}){
  return <div className="v2-tabs" role="tablist" aria-label={label}>{items.filter(x=>!x.hidden).map(item=><button type="button" role="tab" aria-selected={value===item.key} className={value===item.key?'active':''} key={item.key} onClick={()=>onChange(item.key)}>{item.label}</button>)}</div>;
}
export function V2Status({tone='neutral',children}:{tone?:'neutral'|'live'|'success'|'warning'|'danger';children:ReactNode}){
  return <span className={'v2-status '+tone}><span aria-hidden="true" className="v2-status-dot"/>{children}</span>;
}
export function V2EmptyState({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="v2-empty-state"><strong>{title}</strong>{description&&<p>{description}</p>}{action&&<div>{action}</div>}</div>;
}
export function V2Drawer({open,title,onClose,children,className='' }:PropsWithChildren<{open:boolean;title:string;onClose:()=>void;className?:string}>){
  if(!open)return null;
  return <div className={'v2-drawer '+className} role="dialog" aria-modal="false" aria-label={title}><header><strong>{title}</strong><button type="button" onClick={onClose} aria-label={'Fechar '+title}>×</button></header><div className="v2-drawer-body">{children}</div></div>;
}
