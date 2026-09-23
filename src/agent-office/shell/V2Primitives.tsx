import { useEffect, useRef } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';

export function V2PageHeader({title,subtitle,actions}:{title:string;subtitle?:string;actions?:ReactNode}){
  return <header className="v2-page-header"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="v2-page-actions">{actions}</div>}</header>;
}

export function V2Tabs<T extends string>({items,value,onChange,label}:{items:Array<{key:T;label:string;hidden?:boolean}>;value:T;onChange:(value:T)=>void;label:string}){
  const visible=items.filter(x=>!x.hidden);
  const onKeyDown=(event:React.KeyboardEvent<HTMLButtonElement>,index:number)=>{
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%visible.length;
    else if(event.key==='ArrowLeft')next=(index-1+visible.length)%visible.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=visible.length-1;
    else return;
    event.preventDefault();
    onChange(visible[next].key);
    const root=event.currentTarget.parentElement;
    window.requestAnimationFrame(()=>root?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus());
  };
  return <div className="v2-tabs" role="tablist" aria-label={label}>{visible.map((item,index)=><button type="button" role="tab" aria-selected={value===item.key} tabIndex={value===item.key?0:-1} className={value===item.key?'active':''} key={item.key} onClick={()=>onChange(item.key)} onKeyDown={event=>onKeyDown(event,index)}>{item.label}</button>)}</div>;
}

export function V2Status({tone='neutral',children}:{tone?:'neutral'|'live'|'success'|'warning'|'danger';children:ReactNode}){
  return <span className={'v2-status '+tone}><span aria-hidden="true" className="v2-status-dot"/>{children}</span>;
}

export function V2EmptyState({title,description,action}:{title:string;description?:string;action?:ReactNode}){
  return <div className="v2-empty-state"><strong>{title}</strong>{description&&<p>{description}</p>}{action&&<div>{action}</div>}</div>;
}

export function V2Drawer({open,title,onClose,children,className='' }:PropsWithChildren<{open:boolean;title:string;onClose:()=>void;className?:string}>){
  const closeRef=useRef<HTMLButtonElement|null>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!open)return;
    previousFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const timer=window.setTimeout(()=>closeRef.current?.focus(),0);
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}};
    document.addEventListener('keydown',onKeyDown);
    return()=>{window.clearTimeout(timer);document.removeEventListener('keydown',onKeyDown);previousFocusRef.current?.focus()};
  },[open,onClose]);
  if(!open)return null;
  return <div className={'v2-drawer '+className} role="dialog" aria-modal="false" aria-label={title}><header><strong>{title}</strong><button ref={closeRef} type="button" onClick={onClose} aria-label={'Fechar '+title}>×</button></header><div className="v2-drawer-body">{children}</div></div>;
}
