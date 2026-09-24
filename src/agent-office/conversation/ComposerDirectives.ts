import type { AgentProfile } from '../types.js';

export type ExecutionPolicy='auto'|'plan'|'research'|'build'|'review'|'test'|'until_done';
export interface ParsedComposerInput{
  message:string;
  target?:string;
  execution_policy:ExecutionPolicy;
  tool_hint?:string;
  directives:string[];
}
const COMMANDS=[
  {token:'/plan',label:'Planejar antes de executar'},
  {token:'/research',label:'Pesquisar profundamente'},
  {token:'/build',label:'Construir e validar entrega'},
  {token:'/review',label:'Revisar criticamente'},
  {token:'/test',label:'Executar validações e testes'},
  {token:'/until-done',label:'Só encerrar quando estiver concluído'},
];
const escapeRe=(value:string)=>value.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
export function composerSuggestions(value:string,agents:AgentProfile[]){
  const match=/(^|\s)([@/][^\s]*)$/.exec(value);if(!match)return[];
  const query=match[2].toLowerCase();
  const base=query.startsWith('/')
    ? COMMANDS
    : [{token:'@Google',label:'Pesquisa web / navegador'},...agents.filter(a=>a.enabled).map(a=>({token:'@'+a.name.replace(/\s+/g,''),label:a.role||'Agent',target:a.id}))];
  return base.filter(item=>item.token.toLowerCase().startsWith(query)).slice(0,8);
}
export function applyComposerSuggestion(value:string,token:string){
  return value.replace(/(^|\s)([@/][^\s]*)$/,(_,space)=>space+token+' ');
}
export function parseComposerInput(value:string,agents:AgentProfile[]):ParsedComposerInput{
  let message=value.trim(),target:string|undefined,tool_hint:string|undefined,execution_policy:ExecutionPolicy='auto';
  const directives:string[]=[];
  const commandMap:Record<string,ExecutionPolicy>={
    '/plan':'plan','/research':'research','/build':'build','/review':'review','/test':'test','/until-done':'until_done',
  };
  for(const [token,policy] of Object.entries(commandMap)){
    const re=new RegExp('(^|\\s)'+escapeRe(token)+'(?=\\s|$)','ig');
    if(re.test(message)){directives.push(token);execution_policy=policy;message=message.replace(re,' ').replace(/\s+/g,' ').trim()}
  }
  const google=/(^|\s)@google(?=\s|$)/ig;
  if(google.test(message)){directives.push('@Google');tool_hint='web_search';message=message.replace(google,' ').replace(/\s+/g,' ').trim()}
  for(const agent of agents){
    const aliases=[agent.name.replace(/\s+/g,''),agent.slug].filter(Boolean);
    const found=aliases.find(alias=>new RegExp('(^|\\s)@'+escapeRe(alias)+'(?=\\s|$)','i').test(message));
    if(found){
      const re=new RegExp('(^|\\s)@'+escapeRe(found)+'(?=\\s|$)','ig');
      directives.push('@'+found);target=agent.id;message=message.replace(re,' ').replace(/\s+/g,' ').trim();break;
    }
  }
  return{message:message||value.trim(),target,execution_policy,tool_hint,directives};
}
