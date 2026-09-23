import { Fragment, type ReactNode } from 'react';

export function safeHref(value:string){
  const href=value.trim();
  if(/^https?:\/\//i.test(href)||/^mailto:/i.test(href))return href;
  return undefined;
}

function inline(text:string,keyPrefix='i'):ReactNode[]{
  const tokens:ReactNode[]=[];
  const pattern=/(\`[^\`\n]+\`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g;
  let last=0,index=0,match:RegExpExecArray|null;
  while((match=pattern.exec(text))){
    if(match.index>last)tokens.push(text.slice(last,match.index));
    const raw=match[0],key=keyPrefix+(index++);
    if(raw.startsWith('\`'))tokens.push(<code key={key}>{raw.slice(1,-1)}</code>);
    else if(raw.startsWith('**')||raw.startsWith('__'))tokens.push(<strong key={key}>{raw.slice(2,-2)}</strong>);
    else if(raw.startsWith('*')||raw.startsWith('_'))tokens.push(<em key={key}>{raw.slice(1,-1)}</em>);
    else{
      const parts=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
      const href=parts?safeHref(parts[2]):undefined;
      tokens.push(href?<a key={key} href={href} target="_blank" rel="noreferrer">{parts![1]}</a>:<span key={key}>{parts?.[1]??raw}</span>);
    }
    last=match.index+raw.length;
  }
  if(last<text.length)tokens.push(text.slice(last));
  return tokens;
}

export function isJson(value:string){
  const v=value.trim();
  if(!((v.startsWith('{')&&v.endsWith('}'))||(v.startsWith('[')&&v.endsWith(']'))))return false;
  try{JSON.parse(v);return true}catch{return false}
}

function copy(text:string){void navigator.clipboard?.writeText(text)}

export function MessageContent({content,streaming=false}:{content:string;streaming?:boolean}){
  const source=content.replace(/\r\n/g,'\n');
  if(isJson(source)){
    return <div className="message-rich"><CodeBlock code={source} language="json"/>{streaming&&<i className="work-v2-caret">▍</i>}</div>;
  }
  const lines=source.split('\n');
  const nodes:ReactNode[]=[];
  let i=0,serial=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^\`\`\`/.test(line)){
      const language=line.replace(/^\`\`\`/,'').trim();
      const body:string[]=[];i++;
      while(i<lines.length&&!/^\`\`\`/.test(lines[i])){body.push(lines[i]);i++}
      if(i<lines.length)i++;
      nodes.push(<CodeBlock key={'code'+serial++} code={body.join('\n')} language={language}/>);
      continue;
    }
    if(!line.trim()){i++;continue}
    const heading=/^(#{1,4})\s+(.+)$/.exec(line);
    if(heading){
      const level=heading[1].length;
      const Tag=(level===1?'h2':level===2?'h3':'h4') as 'h2'|'h3'|'h4';
      nodes.push(<Tag key={'h'+serial++}>{inline(heading[2],'h')}</Tag>);i++;continue;
    }
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){nodes.push(<hr key={'hr'+serial++}/>);i++;continue}
    if(/^>\s?/.test(line)){
      const block:string[]=[];
      while(i<lines.length&&/^>\s?/.test(lines[i])){block.push(lines[i].replace(/^>\s?/,''));i++}
      nodes.push(<blockquote key={'q'+serial++}>{block.map((x,n)=><Fragment key={n}>{inline(x,'q')}{n<block.length-1&&<br/>}</Fragment>)}</blockquote>);continue;
    }
    if(/^\s*[-+*]\s+/.test(line)){
      const items:string[]=[];
      while(i<lines.length&&/^\s*[-+*]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*[-+*]\s+/,''));i++}
      nodes.push(<ul key={'ul'+serial++}>{items.map((x,n)=><li key={n}>{inline(x,'u'+n)}</li>)}</ul>);continue;
    }
    if(/^\s*\d+[.)]\s+/.test(line)){
      const items:string[]=[];
      while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*\d+[.)]\s+/,''));i++}
      nodes.push(<ol key={'ol'+serial++}>{items.map((x,n)=><li key={n}>{inline(x,'o'+n)}</li>)}</ol>);continue;
    }
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      const parse=(v:string)=>v.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
      const head=parse(line);i+=2;const rows:string[][]=[];
      while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){rows.push(parse(lines[i]));i++}
      nodes.push(<div className="message-table-wrap" key={'t'+serial++}><table><thead><tr>{head.map((x,n)=><th key={n}>{inline(x,'th'+n)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{head.map((_,c)=><td key={c}>{inline(row[c]??'','td'+r+c)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const paragraph:string[]=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!/^\`\`\`/.test(lines[i])&&!/^(#{1,4})\s+/.test(lines[i])&&!/^>\s?/.test(lines[i])&&!/^\s*[-+*]\s+/.test(lines[i])&&!/^\s*\d+[.)]\s+/.test(lines[i])&&!/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lines[i])){paragraph.push(lines[i]);i++}
    nodes.push(<p key={'p'+serial++}>{paragraph.map((x,n)=><Fragment key={n}>{inline(x,'p'+n)}{n<paragraph.length-1&&<br/>}</Fragment>)}</p>);
  }
  return <div className="message-rich" aria-live={streaming?'polite':undefined}>{nodes}{streaming&&<i className="work-v2-caret" aria-hidden="true">▍</i>}</div>;
}

function CodeBlock({code,language}:{code:string;language?:string}){
  const label=(language||'texto').toLowerCase();
  return <div className="message-code"><div className="message-code-head"><span>{label}</span><button type="button" onClick={()=>copy(code)} aria-label="Copiar bloco de código">Copiar</button></div><pre><code>{code}</code></pre></div>;
}
